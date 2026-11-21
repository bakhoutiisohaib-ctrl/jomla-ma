// D2B synthetic production-build fixture. Loopback only, no project dotenv/data.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto')
module.paths.push(path.resolve(__dirname, '../backend/node_modules'))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-d2b-preview-'))
for (const dir of ['uploads', 'logs']) fs.mkdirSync(path.join(root, dir))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', BRAVE_SEARCH_API_KEY: '', DISABLE_REDIS: '1' })
require('dotenv').config = () => ({ parsed: {} })
const express = require('express'), mongoose = require('mongoose'), bcrypt = require('bcryptjs'), sharp = require('sharp')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../backend/server')
const Supplier = require('../backend/models/Supplier'), Organization = require('../backend/models/Organization'), Store = require('../backend/models/Store')
const Product = require('../backend/models/Product'), QuoteRequest = require('../backend/models/QuoteRequest'), Review = require('../backend/models/Review')
const { saveImage } = require('../backend/middleware/upload')
const evidence = path.resolve(__dirname, '../reports/phase-d2b-evidence', process.argv[2] === 'after' ? 'browser-after' : process.argv[2] === 'check' ? 'browser-check' : 'browser-before')
fs.mkdirSync(evidence, { recursive: true })
const controlFile = path.join(evidence, 'preview-control.json'), base = 'http://127.0.0.1:5064'
let mongo, server, timer, supplier, buyer, store, product, draft, busy = false, stopping = false
const history = []; let failNext = null; const cases = {}; let recovery, originalOfferUpdate, faultActive = true
const write = (name, data) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(data, null, 2))
async function probe(route, html = false) {
  const response = await fetch(base + route, { headers: { Accept: html ? 'text/html' : 'application/json' }, cache: 'no-store' })
  const buffer = Buffer.from(await response.arrayBuffer()), text = buffer.toString('utf8')
  return { route, status: response.status, contentType: response.headers.get('content-type'),
    title: /<title>([^<]+)<\/title>/.exec(text)?.[1], containsProductNameInRawHtml: html && text.includes(product.name),
    includesOgImage: html && /property=["']og:image/.test(text), bytes: buffer.length }
}
async function control() {
  if (busy || stopping || !fs.existsSync(controlFile)) return
  busy = true
  try {
    const { action } = JSON.parse(fs.readFileSync(controlFile, 'utf8')); fs.rmSync(controlFile)
    if (['failNextSave', 'failNextUpload'].includes(action)) { failNext = action; write('preview-control-result.json', {action, armed:true}); return }
    if (action === 'releaseDecision') { faultActive=false; write('preview-control-result.json',{action,released:true}); return }
    if (action === 'stop') { await shutdown(); return }
    const actions = {
      unpublish: () => Product.updateOne({ _id: product._id }, { $set: { isDraft: true } }),
      publish: () => Product.updateOne({ _id: product._id }, { $set: { isDraft: false } }),
      deleteProduct: () => Product.deleteOne({ _id: product._id }),
      suspendStore: () => Store.updateOne({ _id: store._id }, { $set: { adminSuspended: true } }),
      restoreStore: () => Store.updateOne({ _id: store._id }, { $set: { adminSuspended: false } }),
      suspendSupplier: () => Supplier.updateOne({ _id: supplier._id }, { $set: { isActive: false } }),
      restoreSupplier: () => Supplier.updateOne({ _id: supplier._id }, { $set: { isActive: true } })
    }
    if (!actions[action]) throw new Error('Unknown fixture control')
    await actions[action]()
    history.push({ action, at: new Date(), product: await probe('/api/products/' + product._id),
      store: await probe('/api/stores/' + store._id), logo: await probe('/api/media/' + path.basename(store.logoUrl)) })
    write('preview-control-history.json', history); write('preview-control-result.json', history.at(-1))
    console.log('D2B_FIXTURE_CONTROL ' + action)
  } catch { console.error('D2B fixture control failed') }
  finally { busy = false }
}
async function main() {
  fs.rmSync(controlFile, { force: true })
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'phase_d2b_browser', storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('phase_d2b_browser'))
  const password = await bcrypt.hash('D2B-LocalOnly123!', 4)
  supplier = await Supplier.create({ name: '[تجريبي D2B] مورد الأحذية / Fournisseur', role: 'supplier', email: 'supplier@d2b.test', password,
    city: 'الرباط', phone: '+212600000001', description: 'معلومات عامة اصطناعية / Profil public synthétique', verificationDoc: 'D2B_PRIVATE_DOCUMENT' })
  buyer = await Supplier.create({ name: '[تجريبي D2B] مشتري / Acheteur', role: 'buyer', email: 'buyer@d2b.test', password, phone: '+212600000010', city: 'الرباط' })
  const otherBuyer = await Supplier.create({ name: '[تجريبي D2B] مشتري آخر', role: 'buyer', email: 'buyer2@d2b.test', password, phone: '+212600000011' })
  const org = await Organization.create({ name: '[تجريبي D2B] شركة', ownerSupplierId: supplier._id })
  const identity = { id: String(supplier._id), ownerId: String(supplier._id), role: 'supplier', organizationId: String(org._id), permissions: ['all'] }
  const refs = []
  for (const color of ['#129b80', '#345fc4', '#e3a340', '#bc386b']) {
    const art = ['ceramics', 'hero', 'basket', 'textile'][refs.length]
    const buffer = await sharp(path.resolve(__dirname, '../design/phase-d0/assets/' + art + '.svg')).resize(720, 540, { fit: 'contain', background: color }).png().toBuffer()
    refs.push(await saveImage({ buffer, mimetype: 'image/png' }, identity))
  }
  store = await Store.create({ name: '[تجريبي D2B] متجر الجملة / Boutique de gros', slug: 'd2b-local', supplierId: supplier._id,
    organizationId: org._id, isActive: true, reviewStatus: 'approved', city: 'الرباط', address: 'عنوان عام تجريبي / Adresse de test',
    phone: '+212600000001', logoUrl: refs[2], description: 'متجر اصطناعي لفحص الروابط فقط. Boutique synthétique, sans vente réelle.', reviewReason: 'D2B_PRIVATE_STORE_NOTE' })
  const common = { supplierId: supplier._id, storeId: store._id, category: 'المنزل / Maison', city: 'الرباط', country: 'MA',
    price: 120, currency: 'MAD', unit: 'قطعة / pièce', moq: 10,
    description: 'منتج اصطناعي لفحص الصفحة والصور وشرائح الجملة، وليس عرض بيع حقيقياً. Produit de test uniquement.',
    isDraft: false, inStock: true, availability: 'in_stock', availabilityConfirmed: true, hasImageRights: true,
    imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() }, approvedBy: supplier._id, approvedAt: new Date() }
  product = await Product.create({ ...common, name: '[تجريبي D2B] كوب خزفي / Tasse en céramique', imageUrl: refs[0], images: [refs[1]],
    priceTiers: [{ minQty: 10, maxQty: 49, price: 110 }, { minQty: 50, price: 100 }] })
  for (let i = 1; i <= 3; i++) await Product.create({ ...common, name: '[تجريبي D2B] صنف ' + i + ' / Article ' + i, imageUrl: refs[1] })
  draft = await Product.create({ name: 'D2B_PRIVATE_DRAFT', supplierId: supplier._id, imageUrl: refs[3], isDraft: true })
  await sharp(path.resolve(__dirname, '../design/phase-d0/assets/ceramics.svg')).png().toFile(path.join(evidence, 'synthetic-upload.png'))
  const Notification = require('../backend/models/Notification')
  const resource = { resourceType: 'rfq', resourceId: new mongoose.Types.ObjectId() }
  await Notification.create([{ ...resource, userId: buyer._id, type: 'offer_received' }, { ...resource, userId: buyer._id, type: 'message_received' }, { ...resource, userId: supplier._id, type: 'rfq_created' }])
  const BackgroundJob = require('../backend/models/BackgroundJob')
  await BackgroundJob.create({type:'ai_product_draft',ownerId:supplier._id,requestedBy:supplier._id,organizationId:org._id,idempotencyKey:'d2b-failed',payloadHash:'synthetic',payload:{},status:'failed',attempts:3,finishedAt:new Date(),error:{code:'AI_UNAVAILABLE',message:'Synthetic failure'}})
  await Supplier.create({name:'[تجريبي D2B] مورد ب / Fournisseur B',role:'supplier',email:'supplier2@d2b.test',password,city:'فاس',phone:'+212600000099'})
  const request=await QuoteRequest.create({buyerId:buyer._id,supplierId:supplier._id,productId:product._id,buyerName:buyer.name,buyerPhone:buyer.phone,buyerCity:buyer.city,quantity:20,currency:'MAD',notes:'طلب اصطناعي فقط'})
  await Notification.updateMany({userId:supplier._id},{$set:{resourceId:request._id}})
  const pendingStore = await Store.create({ name: 'D2B_PRIVATE_PENDING_STORE', slug: 'd2b-pending', supplierId: supplier._id, reviewStatus: 'pending', isActive: false })
  await Review.create({ supplierId: supplier._id, productId: product._id, buyerId: buyer._id, userName: buyer.name, stars: 4, comment: 'تقييم اصطناعي / Avis synthétique' })
  await Review.create({ supplierId: supplier._id, productId: product._id, buyerId: otherBuyer._id, userName: otherBuyer.name, stars: 5, comment: 'اختبار فقط / Test uniquement' })
  const QuoteOffer = require('../backend/models/QuoteOffer'), MessageThread = require('../backend/models/MessageThread')
  // Match the real RFQ creation route: even a request without an offer has a thread.
  await MessageThread.create({rfqId:request._id,productId:product._id,supplierId:supplier._id,buyerId:buyer._id,buyerName:buyer.name,buyerPhone:buyer.phone,subject:product.name,messages:[]})
  const { captureOfferContext } = require('../backend/services/commercialAgreement')
  const { decide, createDecisionRecovery } = require('../backend/services/rfqDecision')
  cases.pending = { id: String(request._id), productId: String(product._id) }
  for (const [key, label] of [['accept','قبول / Accepter'],['reject','رفض / Refuser'],['recover','استكمال / Reprise'],['accepted','اتفاق مثبت / Accord figé']]) {
    const raw=product.toObject(); delete raw._id; delete raw.__v; delete raw.createdAt; delete raw.updatedAt;
    const p=await Product.create({...raw,name:'[D2B] '+label,unit:'صندوق / carton'})
    const q=await QuoteRequest.create({buyerId:buyer._id,supplierId:supplier._id,productId:p._id,buyerName:buyer.name,buyerPhone:buyer.phone,buyerCity:'الرباط',quantity:20,currency:'MAD',notes:'اختبار محلي فقط / Test local uniquement'})
    const context=await captureOfferContext(q)
    const old=await QuoteOffer.create({...context,rfqId:q._id,supplierId:supplier._id,unitPrice:25,totalPrice:500,quantity:20,currency:'MAD',deliveryDays:7,status:'superseded',paymentTerms:'شروط العرض السابق / Conditions précédentes'})
    const offer=await QuoteOffer.create({...context,rfqId:q._id,supplierId:supplier._id,unitPrice:19,totalPrice:380,quantity:20,currency:'MAD',deliveryDays:4,paymentTerms:'شروط اصطناعية دون دفع / Conditions de test sans paiement',notes:'تعريف العرض المثبت / Définition figée'})
    await MessageThread.create({rfqId:q._id,productId:p._id,supplierId:supplier._id,buyerId:buyer._id,buyerName:buyer.name,buyerPhone:buyer.phone,subject:p.name,messages:[{senderId:buyer._id,senderRole:'buyer',senderName:buyer.name,content:'هل تتوفر الكمية المطلوبة؟ / La quantité est-elle disponible ?',sentAt:new Date(Date.now()-180000)},{senderId:supplier._id,senderRole:'supplier',senderName:supplier.name,content:'هذا عرض اختباري فقط. / Ceci est une offre de test.',sentAt:new Date(Date.now()-120000)}]})
    await QuoteRequest.updateOne({_id:q._id},{$set:{status:'responded',currentOfferId:offer._id,revision:1,offer:{unitPrice:19,totalPrice:380,deliveryDays:4,productSnapshot:offer.productSnapshot}}})
    cases[key]={id:String(q._id),offerId:String(offer._id),oldOfferId:String(old._id),productId:String(p._id),name:p.name}
    if(key==='accepted') await decide({rfqId:q._id,buyerId:buyer._id,actor:{id:buyer._id,name:buyer.name,role:'buyer'},action:'accept',offerId:offer._id})
    await Product.updateOne({_id:p._id},{$set:{name:'[D2B] كتالوج تغير / Catalogue modifié '+key,unit:'وحدة جديدة / unité modifiée'}})
  }
  const foreign=await QuoteRequest.create({buyerId:otherBuyer._id,supplierId:supplier._id,productId:product._id,buyerName:otherBuyer.name,buyerPhone:otherBuyer.phone,quantity:10,currency:'MAD'})
  cases.foreign={id:String(foreign._id)}
  await Notification.deleteMany({userId:buyer._id})
  await Notification.create([{userId:buyer._id,type:'offer_received',resourceType:'rfq',resourceId:cases.accept.id},{userId:buyer._id,type:'message_received',resourceType:'rfq',resourceId:cases.recover.id},{userId:buyer._id,type:'offer_decision',resourceType:'rfq',resourceId:cases.accepted.id,readAt:new Date()},{userId:buyer._id,type:'message_received',resourceType:'rfq',resourceId:foreign._id}])
  originalOfferUpdate=QuoteOffer.updateOne
  QuoteOffer.updateOne=function(query,update,...rest){if(faultActive && String(query._id)===cases.recover.offerId && update.$set?.status==='accepted')return Promise.reject(new Error('Synthetic D2B offer projection failure'));return originalOfferUpdate.call(this,query,update,...rest)}
  recovery=createDecisionRecovery({pollMs:15000}).start()
  const web = express(), build = path.resolve(__dirname, '../frontend/build')
  web.use((req,res,next) => { if ((failNext === 'failNextSave' && /^\/api\/products(?:\/[^/]+)?$/.test(req.path) && ['POST','PUT'].includes(req.method)) || (failNext === 'failNextUpload' && req.path === '/api/product-ai/upload')) { failNext=null; return res.status(503).json({ message: 'تعذر الاتصال مؤقتاً — اختبار اصطناعي / Indisponibilité simulée' }) } next() })
  // Preserve API prefixes. Never serve index.html for API, media, uploads or a
  // missing static asset; only document routes receive the SPA shell.
  web.use((req, res, next) => {
    if (!/^\/(?:api|health|uploads)(?:\/|$)/i.test(req.path)) return next()
    app(req, res, err => err ? next(err) : res.status(404).json({ message: 'Not found' }))
  })
  web.use(express.static(build))
  web.get(/.*/, (req, res) => {
    if (!req.accepts('html') || path.extname(req.path)) return res.status(404).json({ message: 'Not found' })
    res.sendFile(path.join(build, 'index.html'))
  })
  server = web.listen(5064, '127.0.0.1', async () => {
    write('preview-runtime.json', { pid: process.pid, temporaryRoot: root, port: 5064, isolated: true, originalDatabaseUsed: false,
      cases, productId: product._id, storeId: store._id, draftId: draft._id, pendingStoreId: pendingStore._id,
      productUrl: base + '/products/' + product._id, storeUrl: base + '/stores/' + store._id })
    write('spa-http-probes.json', await Promise.all([
      probe('/products/' + product._id, true), probe('/stores/' + store._id, true), probe('/api/products/' + product._id),
      probe('/api/products/' + draft._id), probe('/api/stores/' + pendingStore._id), probe('/api/not-found', true),
      probe('/static/missing-d2b.js', true), probe(product.imageUrl, true), probe('/unknown-client-route', true) ]))
    console.log('PHASE_D2B_PREVIEW_READY ' + base)
  })
  server.on('error', () => shutdown(1))
  timer = setInterval(control, 200)
  process.on('SIGINT', () => shutdown()); process.on('SIGTERM', () => shutdown())
}
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true; clearInterval(timer)
  if (server?.listening) { const closed = new Promise(resolve => server.close(resolve)); server.closeIdleConnections?.(); await closed }
  if (mongoose.connection.readyState === 1 && buyer && product && draft) write('browser-db-result.json', { synthetic: true, originalDatabaseUsed: false,
    rfqCreatedByFixtureBuyer: await QuoteRequest.countDocuments({ buyerId: buyer._id, productId: product._id }),
    privateDraftUnpublished: (await Product.findById(draft._id).lean())?.isDraft === true, products: await Product.find({supplierId:supplier._id}).select('name isDraft price moq unit currency imageUrl hasImageRights approvedAt').lean() })
  if(recovery)await recovery.stop();
  if(originalOfferUpdate)require('../backend/models/QuoteOffer').updateOne=originalOfferUpdate
  if(mongoose.connection.readyState===1){ const result={};for(const [key,value] of Object.entries(cases)){const q=await QuoteRequest.findById(value.id).lean();const offer=q?.currentOfferId?await require('../backend/models/QuoteOffer').findById(q.currentOfferId).lean():null;const t=await require('../backend/models/MessageThread').findOne({rfqId:value.id}).lean();result[key]={status:q?.status,decision:q?.decision,offerStatus:offer?.status,threadStatus:t?.status,decisionMessages:t?.messages.filter(m=>String(m._id)===String(q?.decision?.id)).length,decisionNotifications:await require('../backend/models/Notification').countDocuments({resourceId:value.id,type:'offer_decision'})};}write('trade-db-result.json',{synthetic:true,originalDatabaseUsed:false,cases:result,orders:await mongoose.connection.collection('orders').countDocuments({})})}
  await mongoose.disconnect(); if (mongo) await mongo.stop()
  require('../backend/middleware/logger').logger.close()
  const checked = path.resolve(root)
  if (path.dirname(checked) === fs.realpathSync(os.tmpdir()) && path.basename(checked).startsWith('jomla-d2b-preview-')) {
    try { fs.rmSync(checked, { recursive: true, force: true }) } catch { /* temporary Windows log handle only */ }
  }
  fs.rmSync(controlFile, { force: true })
  write('preview-shutdown.json', { stopped: true, temporaryDirectoryRemoved: !fs.existsSync(root), originalDatabaseUsed: false })
  console.log('PHASE_D2B_PREVIEW_STOPPED'); process.exit(code)
}
main().catch(async () => { console.error('Isolated D2B preview failed'); await shutdown(1) })

