process.env.JWT_SECRET = 'journey-test-secret-with-sufficient-length'
const request = require('supertest')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { deflateSync } = require('zlib')
const fs = require('fs')
const path = require('path')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Membership = require('../models/Membership')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const Report = require('../models/Report')
const AuditLog = require('../models/AuditLog')

let mongo
const uploadedFiles = []
const password = 'Journey-Password-2026'
const authorization = token => ({ Authorization: 'Bearer ' + token })

// A complete PNG with actual deflated pixel data and standard CRC-protected chunks.
function pngImage() {
  function chunk(type, content) {
    const label = Buffer.from(type)
    const bytes = Buffer.concat([label, content])
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(content.length)
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, bytes, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4)
  header[8] = 8; header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 150, 70, 40, 255]))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri())
  // Production has no public admin registration; this fixture is the only DB provisioning.
  await Supplier.create({
    name: 'مشرف اختبار الرحلة', role: 'admin', email: 'admin@journey.test',
    password: await bcrypt.hash(password, 4), city: 'الدار البيضاء', phone: '+212600000099'
  })
})
afterAll(async () => {
  for (const filename of uploadedFiles) {
    const uploadsRoot = require('../services/mediaStorage').uploadsDirectory()
    const absolute = path.resolve(uploadsRoot, filename)
    if (path.dirname(absolute) === uploadsRoot && fs.existsSync(absolute)) fs.unlinkSync(absolute)
  }
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
})

test('API journey: accounts, organization, reviewed store, real image, private draft, publication, staff, RFQ, notifications and audited moderation', async () => {
  async function register(role, name) {
    const result = await request(app).post('/api/suppliers/register').send({
      role, name, email: role + '@journey.test', password, city: 'الدار البيضاء',
      phone: role === 'buyer' ? '+212600000002' : '+212600000001'
    })
    expect(result.status).toBe(201)
    expect(result.body.supplier.role).toBe(role)
    expect(result.body.token).toEqual(expect.any(String))
    return { ...result.body.supplier, token: result.body.token }
  }
  const supplier = await register('supplier', 'شركة التوريد التجريبية')
  const buyer = await register('buyer', 'المشتري المهني التجريبي')
  const staff = await register('staff', 'موظف المبيعات التجريبي')
  const adminLogin = await request(app).post('/api/admin/login').send({ email: 'admin@journey.test', password })
  expect(adminLogin.status).toBe(200)
  const adminToken = adminLogin.body.token

  const company = await request(app).put('/api/suppliers/me/organization').set(authorization(supplier.token)).send({
    name: 'شركة جملة للتجربة', description: 'تجهيز وتوريد ملابس بالجملة للتجربة المغربية', city: 'الدار البيضاء', country: 'MA'
  })
  expect(company.status).toBe(200)
  const organizationId = company.body.organization._id
  expect(company.body.organization.ownerSupplierId).toBe(supplier._id)

  const storeCreated = await request(app).post('/api/stores').set(authorization(supplier.token)).send({
    name: 'متجر الجملة التجريبي', city: 'الدار البيضاء', address: 'درب عمر',
    description: 'متجر تجريبي لتجارة الجملة', categories: ['ملابس']
  })
  expect(storeCreated.status).toBe(201)
  const storeId = storeCreated.body.store._id
  expect(storeCreated.body.store.reviewStatus).toBe('pending')
  expect((await request(app).get('/api/stores/' + storeId)).status).toBe(404)
  const approved = await request(app).put('/api/admin/stores/' + storeId + '/review').set(authorization(adminToken)).send({ action: 'approve', reason: 'اعتماد متجر تجربة التكامل' })
  expect(approved.status).toBe(200)
  expect(approved.body.store.reviewStatus).toBe('approved')
  expect((await Store.findById(storeId)).isActive).toBe(true)

  const png = pngImage()
  const upload = await request(app).post('/api/product-ai/upload').set(authorization(supplier.token))
    .field('hasImageRights', 'true').attach('image', png, { filename: 'journey-owned.png', contentType: 'image/png' })
  expect(upload.status).toBe(201)
  const imageUrl = upload.body.imageUrl
  expect(imageUrl).toMatch(/^\/uploads\/product-[a-f0-9-]+\.png$/)
  uploadedFiles.push(path.basename(imageUrl))
  expect((await request(app).get(imageUrl)).status).toBe(404)
  const servedImage = await request(app).get('/api/media/' + path.basename(imageUrl)).set(authorization(supplier.token))
  expect(servedImage.status).toBe(200)
  expect(servedImage.headers['content-type']).toMatch(/image\/png/)
  expect(servedImage.body.equals(png)).toBe(true)

  const draftCreated = await request(app).post('/api/products').set(authorization(supplier.token)).send({
    name: 'قمصان قطنية للتجربة', category: 'ملابس', imageUrl, storeId, isDraft: true,
    hasImageRights: true, imageRights: { source: 'owned' }
  })
  expect(draftCreated.status).toBe(201)
  const productId = draftCreated.body.product._id
  expect(draftCreated.body.product.isDraft).toBe(true)
  expect(draftCreated.body.product.imageRights.declaredBy).toBe(supplier._id)
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
  const supplierDrafts = await request(app).get('/api/products/mine').set(authorization(supplier.token))
  expect(supplierDrafts.body.data.some(p => p._id === productId && p.isDraft)).toBe(true)
  expect((await request(app).get('/api/products/mine').set(authorization(buyer.token))).status).toBe(403)

  const published = await request(app).put('/api/products/' + productId).set(authorization(supplier.token)).send({
    name: 'قمصان قطنية للتجربة', category: 'ملابس', description: 'قمصان يقدم المورد بياناتها ويؤكد سعرها وكميتها وتوفرها بنفسه.',
    pricingMode: 'fixed', price: 60, currency: 'MAD', country: 'MA', unit: 'قطعة', moq: 10,
    city: 'الدار البيضاء', storeId, imageUrl, images: [imageUrl],
    priceTiers: [{ minQty: 10, maxQty: 49, price: 60 }, { minQty: 50, price: 55 }],
    availability: 'in_stock', inStock: true, availabilityConfirmed: true,
    hasImageRights: true, imageRights: { source: 'owned' }, publishApproved: true, isDraft: false
  })
  expect(published.status).toBe(200)
  expect(published.body.product.isDraft).toBe(false)
  expect(published.body.product.approvedBy).toBe(supplier._id)
  expect(published.body.product.organizationId).toBe(organizationId)
  const catalog = await request(app).get('/api/products/search').query({ q: 'قمصان', city: 'الدار البيضاء', quantity: 10 })
  expect(catalog.status).toBe(200)
  expect(catalog.body.data.some(p => p._id === productId && !p.isDraft)).toBe(true)
  const unavailableQuantity = await request(app).get('/api/products/search').query({ q: 'قمصان', quantity: 9 })
  expect(unavailableQuantity.body.data).toHaveLength(0)

  expect((await request(app).get('/api/rfq/supplier').set(authorization(staff.token))).status).toBe(403)
  const invitation = await request(app).post('/api/suppliers/me/staff-invitations').set(authorization(supplier.token)).send({
    email: staff.email, permissions: ['manage_rfq']
  })
  expect(invitation.status).toBe(201)
  const membershipId = invitation.body.invitation._id
  expect(invitation.body.acceptanceToken).toEqual(expect.any(String))
  const hiddenToken = await request(app).get('/api/suppliers/me/staff-invitations').set(authorization(staff.token))
  expect(hiddenToken.body.data[0].invitationTokenHash).toBeUndefined()
  const acceptedInvitation = await request(app).post('/api/suppliers/me/staff-invitations/' + membershipId + '/accept')
    .set(authorization(staff.token)).send({ token: invitation.body.acceptanceToken })
  expect(acceptedInvitation.status).toBe(200)
  expect((await Membership.findById(membershipId)).status).toBe('active')
  expect((await request(app).get('/api/products/mine').set(authorization(staff.token))).status).toBe(403)

  const belowMoq = await request(app).post('/api/rfq').set(authorization(buyer.token)).send({ productId, quantity: 9, buyerPhone: buyer.phone })
  expect(belowMoq.status).toBe(400)
  const requested = await request(app).post('/api/rfq').set(authorization(buyer.token)).send({
    productId, quantity: 10, buyerPhone: buyer.phone, buyerCity: 'الرباط', notes: 'التسليم إلى الرباط حسب الاتفاق'
  })
  expect(requested.status).toBe(201)
  const rfqId = requested.body.rfq._id
  expect(requested.body.rfq.buyerId).toBe(buyer._id)
  const staffRequests = await request(app).get('/api/rfq/supplier').set(authorization(staff.token))
  expect(staffRequests.status).toBe(200)
  expect(staffRequests.body.data.some(r => r._id === rfqId)).toBe(true)
  const response = await request(app).put('/api/rfq/' + rfqId + '/respond').set(authorization(supplier.token)).send({
    unitPrice: 58, deliveryDays: 4, paymentTerms: 'تحويل عند اعتماد الفاتورة', notes: 'العرض لكمية عشر قطع'
  })
  expect(response.status).toBe(200)
  const offerId = response.body.offer._id
  const history = await request(app).get('/api/rfq/' + rfqId + '/thread').set(authorization(buyer.token))
  expect(history.status).toBe(200)
  expect(history.body.offers[0]._id).toBe(offerId)
  const buyerMessage = await request(app).post('/api/rfq/' + rfqId + '/messages').set(authorization(buyer.token)).send({
    content: 'وافقنا على موعد التسليم، سنراجع العرض.', senderRole: 'admin', senderName: 'اسم متجاوز'
  })
  expect(buyerMessage.status).toBe(201)
  expect(buyerMessage.body.thread.messages.at(-1).senderRole).toBe('buyer')
  expect(buyerMessage.body.thread.messages.at(-1).senderName).toBe(buyer.name)
  const staffMessage = await request(app).post('/api/rfq/' + rfqId + '/messages').set(authorization(staff.token)).send({ content: 'موعد التسليم مؤكد في العرض.' })
  expect(staffMessage.status).toBe(201)
  expect(staffMessage.body.thread.messages.at(-1).senderId).toBe(staff._id)
  expect(staffMessage.body.thread.messages.at(-1).senderRole).toBe('supplier')
  const accepted = await request(app).put('/api/rfq/' + rfqId + '/action').set(authorization(buyer.token)).send({ action: 'accept', offerId })
  expect(accepted.status).toBe(200)
  expect((await QuoteRequest.findById(rfqId)).status).toBe('accepted')
  expect((await QuoteOffer.findById(offerId)).status).toBe('accepted')
  expect((await MessageThread.findOne({ rfqId })).status).toBe('closed')
  const inbox = await request(app).get('/api/notifications').set(authorization(buyer.token))
  expect(inbox.status).toBe(200)
  const offerNotice = inbox.body.data.find(n => n.type === 'offer_received' && n.resourceId === rfqId)
  expect(offerNotice).toBeDefined()
  expect(offerNotice.titleAr).toBeTruthy(); expect(offerNotice.titleFr).toBeTruthy()
  expect((await request(app).put('/api/notifications/' + offerNotice._id + '/read').set(authorization(buyer.token))).status).toBe(200)
  expect((await Notification.findById(offerNotice._id)).readAt).not.toBeNull()

  const reported = await request(app).post('/api/reports').set(authorization(buyer.token)).send({
    reporterName: buyer.name, targetType: 'product', targetId: productId,
    reason: 'incorrect_pricing', details: 'بلاغ تجريبي لاختبار المراجعة الإدارية'
  })
  expect(reported.status).toBe(201)
  const reportId = reported.body.report._id
  const resolved = await request(app).put('/api/reports/' + reportId + '/resolve').set(authorization(adminToken)).send({
    action: 'resolved', resolutionNotes: 'قرار تجربة التكامل: إخفاء المنتج للمراجعة', moderationAction: 'hide_product'
  })
  expect(resolved.status).toBe(200)
  expect((await Report.findById(reportId)).status).toBe('resolved')
  expect((await Product.findById(productId)).moderationStatus).toBe('hidden')
  const publicAfterHide = await request(app).get('/api/products')
  expect(publicAfterHide.body.data.some(p => p._id === productId)).toBe(false)
  expect((await request(app).get('/api/stores/' + storeId)).body.products).toHaveLength(0)
  const rejectedNewRfq = await request(app).post('/api/rfq').set(authorization(buyer.token)).send({ productId, quantity: 10, buyerPhone: buyer.phone })
  expect(rejectedNewRfq.status).toBe(404)
  expect((await request(app).get('/api/rfq/' + rfqId + '/thread').set(authorization(buyer.token))).body.offers[0].status).toBe('accepted')

  const revoked = await request(app).patch('/api/suppliers/me/memberships/' + membershipId).set(authorization(supplier.token)).send({ status: 'revoked' })
  expect(revoked.status).toBe(200)
  expect((await request(app).get('/api/rfq/supplier').set(authorization(staff.token))).status).toBe(401)
  const staffLogin = await request(app).post('/api/suppliers/login').send({ email: staff.email, password })
  expect(staffLogin.status).toBe(200)
  expect((await request(app).get('/api/rfq/supplier').set(authorization(staffLogin.body.token))).status).toBe(403)

  const logs = await AuditLog.find().lean()
  for (const action of ['ACCOUNT_REGISTERED', 'ORGANIZATION_UPDATED', 'STORE_CREATED', 'STORE_REVIEWED', 'STAFF_INVITED',
    'STAFF_INVITATION_ACCEPTED', 'MEMBERSHIP_UPDATED', 'REPORT_SUBMITTED', 'PRODUCT_MODERATED', 'REPORT_RESOLVED']) {
    expect(logs.some(event => event.action === action && event.phase === 'completed' && event.completedAt)).toBe(true)
  }
  expect(logs.every(event => event.phase === 'completed')).toBe(true)
  const moderation = logs.find(event => event.action === 'PRODUCT_MODERATED' && String(event.targetId) === productId)
  expect(String(moderation.performedBy.id)).toBe(adminLogin.body.admin._id)
  expect(moderation.details.reportId.toString()).toBe(reportId)
  const adminLogs = await request(app).get('/api/admin/audit-logs?limit=100').set(authorization(adminToken))
  expect(adminLogs.status).toBe(200)
  expect(adminLogs.body.data.every(event => event.phase === 'completed')).toBe(true)
}, 60000)
