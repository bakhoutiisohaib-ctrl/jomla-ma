const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Product = require('../models/Product')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
const { generateToken } = require('../middleware/auth')

let mongoServer
let supplierToken
let testSupplier
let testProduct

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  await mongoose.connect(uri)

  testSupplier = await Supplier.create({
    name: 'مجموعة المتاجر المغربية',
    email: 'stores-test@jomla.ma',
    password: 'password123',
    city: 'الدار البيضاء',
    phone: '+212622334455',
    isVerified: true
  })
  supplierToken = generateToken(testSupplier)

  testProduct = await Product.create({
    name: 'جلابة مغربية رجالية',
    category: 'ملابس',
    price: 280,
    city: 'الدار البيضاء',
    moq: 15,
    unit: 'قطعة',
    supplierId: testSupplier._id,
    supplierPhone: testSupplier.phone
  })
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

describe('Standalone Store Entity & RFQ Message Threads', () => {
  let createdStoreId
  let createdRfqId

  test('POST /api/stores creates an independent B2B store for supplier', async () => {
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        name: 'متجر الأصالة للجلابة المغربية',
        description: 'متجر متخصص في بيع الجلابة المغربية التقليدية بالجملة',
        city: 'الدار البيضاء',
        address: 'درب عمر، زنقة التجارة، رقم 42',
        categories: ['ملابس', 'تقليدي']
      })

    expect(res.statusCode).toBe(201)
    expect(res.body).toHaveProperty('store')
    expect(res.body.store.name).toBe('متجر الأصالة للجلابة المغربية')
    expect(res.body.store.supplierId.toString()).toBe(testSupplier._id.toString())
    createdStoreId = res.body.store._id
  })

  test('GET /api/stores lists active B2B stores', async () => {
    const res = await request(app).get('/api/stores')

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data[0].name).toBe('متجر الأصالة للجلابة المغربية')
  })

  test('GET /api/stores/:id fetches store detail with populated products', async () => {
    const res = await request(app).get(`/api/stores/${createdStoreId}`)

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('store')
    expect(res.body).toHaveProperty('products')
    expect(res.body.store._id.toString()).toBe(createdStoreId.toString())
  })

  test('RFQ creation initializes MessageThread and supplier respond creates QuoteOffer', async () => {
    // 1. Create RFQ
    const rfqRes = await request(app)
      .post('/api/rfq')
      .send({
        productId: testProduct._id,
        buyerName: 'ياسين المشتري',
        buyerPhone: '+212644556677',
        quantity: 30,
        notes: 'المرجو إرسال أفضل سعر للتسليم في فاس'
      })

    expect(rfqRes.statusCode).toBe(201)
    expect(rfqRes.body).toHaveProperty('threadId')
    createdRfqId = rfqRes.body.rfq._id

    // 2. Check thread was created with initial buyer message
    const threadCheck = await MessageThread.findOne({ rfqId: createdRfqId })
    expect(threadCheck).not.toBeNull()
    expect(threadCheck.messages.length).toBe(1)
    expect(threadCheck.messages[0].senderRole).toBe('buyer')

    // 3. Supplier responds to RFQ
    const respondRes = await request(app)
      .put(`/api/rfq/${createdRfqId}/respond`)
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        unitPrice: 250,
        deliveryDays: 4,
        notes: 'عرض خاص للكمية، جاهز للشحن إلى فاس'
      })

    expect(respondRes.statusCode).toBe(200)

    // 4. Verify QuoteOffer was created
    const offerCheck = await QuoteOffer.findOne({ rfqId: createdRfqId })
    expect(offerCheck).not.toBeNull()
    expect(offerCheck.unitPrice).toBe(250)
    expect(offerCheck.totalPrice).toBe(250 * 30)

    // 5. Test thread messaging
    const msgRes = await request(app)
      .post(`/api/rfq/${createdRfqId}/messages`)
      .send({
        content: 'شكراً لكم، هل يمكن توفير الألوان الأزرق والرمادي؟',
        senderRole: 'buyer',
        senderName: 'ياسين المشتري'
      })

    expect(msgRes.statusCode).toBe(201)
    expect(msgRes.body.thread.messages.length).toBeGreaterThanOrEqual(3)

    // 6. Test GET thread and offers
    const getThreadRes = await request(app).get(`/api/rfq/${createdRfqId}/thread`)
    expect(getThreadRes.statusCode).toBe(200)
    expect(getThreadRes.body).toHaveProperty('thread')
    expect(getThreadRes.body).toHaveProperty('offers')
    expect(getThreadRes.body.offers.length).toBeGreaterThanOrEqual(1)
  })
})
