require('./helpers/pilotIsolation')
const request = require('supertest')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const Store = require('../models/Store')
const Product = require('../models/Product')
const Report = require('../models/Report')
const AuditLog = require('../models/AuditLog')
const { generateToken } = require('../middleware/auth')
const { createFirstAdmin } = require('../scripts/create-admin')
const { mediaFixture } = require('./helpers/mediaFixture')

let mongoServer
let hash
let sequence = 0
const auth = token => ({ Authorization: 'Bearer ' + token })
async function account(role = 'supplier', extra = {}) {
  const user = await Supplier.create({
    name: 'Account ' + ++sequence, email: 'security-' + sequence + '@test.ma',
    password: hash, role, city: 'الرباط', phone: '+212612345678', ...extra
  })
  return { user, token: generateToken(user) }
}
async function company(user) {
  const organization = await Organization.create({ ownerSupplierId: user._id, name: user.name, city: user.city })
  await Membership.create({
    organizationId: organization._id, userId: user._id, invitedEmail: user.email,
    role: 'owner', status: 'active', permissions: Membership.STAFF_PERMISSIONS, invitedBy: user._id
  })
  await Supplier.updateOne({ _id: user._id }, { $set: { organizationId: organization._id } })
  return organization
}
async function publishedProduct(user, store, extra = {}) {
  return Product.create({
    supplierId: user._id, storeId: store._id, name: 'منتج تجريبي موثوق', category: 'تجارب',
    price: 100, city: 'الرباط', moq: 5, unit: 'قطعة', description: 'وصف منتج مفصل للاختبار الفعلي',
    imageUrl: await mediaFixture(user), hasImageRights: true,
    imageRights: { source: 'owned', declaredBy: user._id, declaredAt: new Date() },
    approvedBy: user._id, approvedAt: new Date(), isDraft: false,
    inStock: true, availability: 'in_stock', availabilityConfirmed: true, ...extra
  })
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongoServer.getUri())
  await Promise.all([Supplier.init(), Organization.init(), Membership.init(), Store.init()])
  hash = await bcrypt.hash('password123', 4)
})
beforeEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})))
})
afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

test('anonymous profile writes, cross-account writes and privilege mass assignment are rejected', async () => {
  const first = await account()
  const second = await account()
  expect((await request(app).put('/api/suppliers/' + first.user._id).send({ role: 'admin' })).status).toBe(401)
  expect((await request(app).put('/api/suppliers/' + second.user._id).set(auth(first.token)).send({ name: 'intruder' })).status).toBe(403)
  for (const body of [{ role: 'admin' }, { password: 'replacement' }, { isVerified: true }, { permissions: ['all'] }, { $set: { role: 'admin' } }]) {
    expect((await request(app).put('/api/suppliers/' + first.user._id).set(auth(first.token)).send(body)).status).toBe(400)
  }
  const response = await request(app).put('/api/suppliers/' + first.user._id).set(auth(first.token)).send({ name: 'اسم جديد' })
  expect(response.status).toBe(200)
  expect(response.body.supplier.name).toBe('اسم جديد')
  expect(response.body.supplier).not.toHaveProperty('password')
  expect(response.body.supplier).not.toHaveProperty('tokenVersion')
  expect((await Supplier.findById(first.user._id)).role).toBe('supplier')
  expect(await AuditLog.countDocuments({ action: 'ACCOUNT_PROFILE_UPDATED', phase: 'completed' })).toBe(1)
})

test('public supplier profiles expose commercial fields only and never list private account roles', async () => {
  const owner = await account('supplier', { verificationDoc: 'https://private.example.com/doc', iceNumber: 'private-ice', rejectionReason: 'private-note' })
  await account('admin')
  await account('buyer')
  await account('staff')
  const response = await request(app).get('/api/suppliers')
  expect(response.status).toBe(200)
  expect(response.body.data).toHaveLength(1)
  for (const key of ['email', 'password', 'tokenVersion', 'verificationDoc', 'iceNumber', 'rejectionReason', 'permissions', 'organizationId', 'parentSupplierId', 'role']) {
    expect(response.body.data[0]).not.toHaveProperty(key)
  }
  const detail = await request(app).get('/api/suppliers/' + owner.user._id)
  expect(detail.body).not.toHaveProperty('verificationDoc')
  const own = await request(app).get('/api/suppliers/me/profile').set(auth(owner.token))
  expect(own.body.verificationDoc).toBe('https://private.example.com/doc')
  expect(own.body.id).toBe(own.body._id)
})

test('current database role, deleted and suspended accounts override old signed tokens', async () => {
  const admin = await account('admin')
  expect((await request(app).get('/api/admin/stats').set(auth(admin.token))).status).toBe(200)
  await Supplier.updateOne({ _id: admin.user._id }, { $set: { role: 'buyer' } })
  expect((await request(app).get('/api/admin/stats').set(auth(admin.token))).status).toBe(403)
  await Supplier.updateOne({ _id: admin.user._id }, { $set: { isActive: false } })
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(admin.token))).status).toBe(401)
  const deleted = await account()
  await Supplier.deleteOne({ _id: deleted.user._id })
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(deleted.token))).status).toBe(401)
})

test('logout revokes existing tokens and password changes require the current password', async () => {
  const owner = await account()
  expect((await request(app).put('/api/suppliers/me/password').set(auth(owner.token)).send({ currentPassword: 'wrong', newPassword: 'new-password123' })).status).toBe(403)
  expect((await request(app).post('/api/suppliers/logout').set(auth(owner.token))).status).toBe(200)
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(owner.token))).status).toBe(401)
  const login = await request(app).post('/api/suppliers/login').send({ email: owner.user.email, password: 'password123' })
  expect(login.status).toBe(200)
  expect(login.body.supplier).not.toHaveProperty('password')
  expect((await request(app).put('/api/suppliers/me/password').set(auth(login.body.token)).send({ currentPassword: 'password123', newPassword: 'new-password123' })).status).toBe(200)
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(login.body.token))).status).toBe(401)
  expect((await request(app).post('/api/suppliers/login').send({ email: owner.user.email, password: 'password123' })).status).toBe(401)
  expect((await request(app).post('/api/suppliers/login').send({ email: owner.user.email, password: 'new-password123' })).status).toBe(200)
})

test('HTTP admin bootstrap is retired; local bootstrap validates, hashes, audits and is one use', async () => {
  expect((await request(app).post('/api/admin/setup-first-admin').send({ name: 'attacker', email: 'attacker@test.ma', password: 'password123' })).status).toBe(410)
  expect(await Supplier.countDocuments({ role: 'admin' })).toBe(0)
  await expect(createFirstAdmin({ name: 'Admin', email: 'admin@test.ma', password: 'short' })).rejects.toThrow()
  const result = await createFirstAdmin({ name: 'Admin', email: 'admin@test.ma', password: 'strong-password123' })
  const admin = await Supplier.findById(result.id).select('+password')
  expect(admin.role).toBe('admin')
  expect(await bcrypt.compare('strong-password123', admin.password)).toBe(true)
  expect(await AuditLog.countDocuments({ action: 'ADMIN_BOOTSTRAPPED', phase: 'completed' })).toBe(1)
  await expect(createFirstAdmin({ name: 'Other', email: 'other@test.ma', password: 'strong-password123' })).rejects.toThrow(/already/)
})

test('registration creates an organization and owner membership but never grants self-selected permissions', async () => {
  const response = await request(app).post('/api/suppliers/register').send({
    name: 'شركة جديدة', city: 'فاس', phone: '+212612345678', email: 'new-owner@test.ma', password: 'password123', role: 'supplier', organization: 'شركة الأطلس'
  })
  expect(response.status).toBe(201)
  const organization = await Organization.findOne({ ownerSupplierId: response.body.supplier.id })
  expect(organization.name).toBe('شركة الأطلس')
  expect(await Membership.countDocuments({ organizationId: organization._id, role: 'owner', status: 'active' })).toBe(1)
  const malicious = await request(app).post('/api/suppliers/register').send({
    name: 'عضو', city: 'فاس', phone: '+212612345678', email: 'malicious@test.ma', password: 'password123', role: 'staff', permissions: ['all']
  })
  expect(malicious.status).toBe(400)
})

test('staff permissions require a real accepted invitation and isolate products to its organization', async () => {
  const owner = await account()
  const outsider = await account()
  const staff = await account('staff')
  const organization = await company(owner.user)
  expect((await request(app).get('/api/products/mine').set(auth(staff.token))).status).toBe(403)
  const invitationResponse = await request(app).post('/api/suppliers/me/staff-invitations').set(auth(owner.token))
    .send({ email: staff.user.email, permissions: ['manage_products'] })
  expect(invitationResponse.status).toBe(201)
  const invitation = invitationResponse.body.invitation
  const acceptanceToken = invitationResponse.body.acceptanceToken
  expect(invitation).not.toHaveProperty('invitationTokenHash')
  const invitations = await request(app).get('/api/suppliers/me/staff-invitations').set(auth(staff.token))
  expect(invitations.body.data).toHaveLength(1)
  expect(JSON.stringify(invitations.body)).not.toContain(acceptanceToken)
  expect(JSON.stringify(invitations.body)).not.toContain('invitationTokenHash')
  expect((await request(app).post('/api/suppliers/me/staff-invitations/' + invitation._id + '/accept').set(auth(staff.token)).send({ token: 'wrong' })).status).toBe(403)
  expect((await request(app).post('/api/suppliers/me/staff-invitations/' + invitation._id + '/accept').set(auth(staff.token)).send({ token: acceptanceToken })).status).toBe(200)
  const profile = await request(app).get('/api/suppliers/me/profile').set(auth(staff.token))
  expect(profile.body.ownerId).toBe(String(owner.user._id))
  expect(profile.body.organizationId).toBe(String(organization._id))
  expect(profile.body.permissions).toEqual(['manage_products'])
  expect((await request(app).get('/api/stores/mine').set(auth(staff.token))).status).toBe(200)
  expect((await request(app).post('/api/stores').set(auth(staff.token)).send({ name: 'ليس مفوضاً' })).status).toBe(403)
  expect((await request(app).put('/api/suppliers/me/organization').set(auth(staff.token)).send({ name: 'Intruder' })).status).toBe(403)
  const product = await request(app).post('/api/products').set(auth(staff.token)).send({ name: 'مسودة الموظف', isDraft: true })
  expect(product.status).toBe(201)
  expect(product.body.product.supplierId).toBe(String(owner.user._id))
  expect((await request(app).get('/api/products/mine').set(auth(outsider.token))).body.data).toHaveLength(0)
  expect((await request(app).put('/api/products/' + product.body.product._id).set(auth(outsider.token)).send({ name: 'Intruder' })).status).toBe(404)
  const revoke = await request(app).patch('/api/suppliers/me/memberships/' + invitation._id).set(auth(owner.token)).send({ status: 'revoked' })
  expect(revoke.status).toBe(200)
  expect((await request(app).get('/api/products/mine').set(auth(staff.token))).status).toBe(401)
  const freshStaff = await Supplier.findById(staff.user._id).select('+tokenVersion')
  expect((await request(app).get('/api/products/mine').set(auth(generateToken(freshStaff)))).status).toBe(403)
})

test('revoked permissions apply immediately and invitations cannot be accepted by a different account', async () => {
  const owner = await account()
  const staff = await account('staff')
  const otherStaff = await account('staff')
  const organization = await company(owner.user)
  const response = await request(app).post('/api/suppliers/me/staff-invitations').set(auth(owner.token))
    .send({ email: staff.user.email, permissions: ['manage_products', 'manage_store'] })
  const invitation = response.body.invitation
  expect((await request(app).post('/api/suppliers/me/staff-invitations/' + invitation._id + '/accept').set(auth(otherStaff.token)).send({ token: response.body.acceptanceToken })).status).toBe(404)
  await request(app).post('/api/suppliers/me/staff-invitations/' + invitation._id + '/accept').set(auth(staff.token)).send({ token: response.body.acceptanceToken })
  expect((await request(app).get('/api/products/mine').set(auth(staff.token))).status).toBe(200)
  expect((await request(app).patch('/api/suppliers/me/memberships/' + invitation._id).set(auth(owner.token)).send({ permissions: ['manage_store'] })).status).toBe(200)
  expect((await request(app).get('/api/products/mine').set(auth(staff.token))).status).toBe(403)
  expect((await request(app).get('/api/stores/mine').set(auth(staff.token))).status).toBe(200)
  expect(await Membership.countDocuments({ organizationId: organization._id, status: 'active', role: 'staff' })).toBe(1)
  const buyer = await account('buyer')
  expect((await request(app).post('/api/stores').set(auth(buyer.token)).send({ name: 'Buyer store' })).status).toBe(403)
})

test('stores require owner company and admin approval, enforce ownership and hide disabled details', async () => {
  const owner = await account()
  const other = await account()
  const admin = await account('admin')
  expect((await request(app).post('/api/stores').set(auth(owner.token)).send({ name: 'متجر جديد' })).status).toBe(409)
  expect((await request(app).put('/api/suppliers/me/organization').set(auth(owner.token)).send({ name: 'شركة المورد', country: 'MA' })).status).toBe(200)
  const creation = await request(app).post('/api/stores').set(auth(owner.token)).send({ name: 'متجر جديد' })
  expect(creation.status).toBe(201)
  const storeId = creation.body.store._id
  expect(creation.body.store.reviewStatus).toBe('pending')
  expect((await request(app).get('/api/stores/' + storeId)).status).toBe(404)
  expect((await request(app).put('/api/stores/' + storeId).set(auth(owner.token)).send({ isActive: true })).status).toBe(409)
  expect((await request(app).put('/api/stores/' + storeId).set(auth(other.token)).send({ name: 'Hijack' })).status).toBe(403)
  expect((await request(app).put('/api/stores/' + storeId).set(auth(owner.token)).send({ isVerified: true })).status).toBe(400)
  const approved = await request(app).put('/api/admin/stores/' + storeId + '/review').set(auth(admin.token)).send({ action: 'approve' })
  expect(approved.status).toBe(200)
  expect((await request(app).get('/api/stores/' + storeId)).status).toBe(200)
  const store = await Store.findById(storeId)
  const otherStore = await Store.create({ name: 'Second store', supplierId: owner.user._id, reviewStatus: 'approved', isActive: true })
  await publishedProduct(owner.user, store)
  await publishedProduct(owner.user, otherStore)
  const detail = await request(app).get('/api/stores/' + storeId)
  expect(detail.body.products).toHaveLength(1)
  expect(detail.body.products[0].storeId).toBe(storeId)
  await request(app).put('/api/admin/stores/' + storeId + '/status').set(auth(admin.token)).send({ isActive: false, reason: 'مراجعة المتجر' })
  expect((await request(app).get('/api/stores/' + storeId)).status).toBe(404)
  expect((await request(app).put('/api/stores/' + storeId).set(auth(owner.token)).send({ isActive: true })).status).toBe(409)
})

test('verification decisions update existing store badges and require pending requests', async () => {
  const owner = await account()
  const admin = await account('admin')
  const store = await Store.create({ name: 'Store', supplierId: owner.user._id, isVerified: false })
  const submit = await request(app).post('/api/suppliers/me/verify').set(auth(owner.token)).send({ iceNumber: '001234567890001' })
  expect(submit.status).toBe(200)
  const approval = await request(app).put('/api/admin/suppliers/' + owner.user._id + '/verify').set(auth(admin.token)).send({ action: 'approve', verificationRevision: submit.body.supplier.verificationRevision })
  expect(approval.status).toBe(200)
  expect((await Store.findById(store._id)).isVerified).toBe(true)
  expect((await request(app).put('/api/admin/suppliers/' + owner.user._id + '/verify').set(auth(admin.token)).send({ action: 'approve', verificationRevision: submit.body.supplier.verificationRevision })).status).toBe(409)
  expect(await AuditLog.countDocuments({ action: 'SUPPLIER_VERIFIED', phase: 'completed', 'performedBy.id': admin.user._id })).toBe(1)
})

test('report resolution applies product moderation and writes complete report and moderation audit entries', async () => {
  const owner = await account()
  const admin = await account('admin')
  const store = await Store.create({ name: 'Store', supplierId: owner.user._id, reviewStatus: 'approved', isActive: true })
  const product = await publishedProduct(owner.user, store)
  const submission = await request(app).post('/api/reports').send({
    targetType: 'product', targetId: String(product._id), reason: 'copyright_infringement', details: 'حقوق الصورة'
  })
  expect(submission.status).toBe(201)
  const reportId = submission.body.report._id
  expect(await AuditLog.countDocuments({ action: 'REPORT_SUBMITTED', targetId: reportId, phase: 'completed' })).toBe(1)
  expect((await request(app).get('/api/reports').set(auth(owner.token))).status).toBe(403)
  expect((await request(app).put('/api/reports/' + reportId + '/resolve').set(auth(admin.token)).send({ action: 'typo', resolutionNotes: 'test' })).status).toBe(400)
  expect((await Report.findById(reportId)).status).toBe('pending')
  const resolution = await request(app).put('/api/reports/' + reportId + '/resolve').set(auth(admin.token))
    .send({ action: 'resolved', resolutionNotes: 'تم التحقق من المخالفة', moderationAction: 'hide_product' })
  expect(resolution.status).toBe(200)
  expect((await Product.findById(product._id)).moderationStatus).toBe('hidden')
  expect((await Report.findById(reportId)).resolvedBy.toString()).toBe(String(admin.user._id))
  expect(await AuditLog.countDocuments({ action: 'REPORT_RESOLVED', phase: 'completed', targetId: reportId })).toBe(1)
  expect(await AuditLog.countDocuments({ action: 'PRODUCT_MODERATED', phase: 'completed', targetId: product._id })).toBe(1)
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
  expect((await request(app).put('/api/admin/products/' + product._id + '/moderate').set(auth(admin.token)).send({ action: 'restore', reason: 'الترخيص صحيح بعد المراجعة' })).status).toBe(200)
  expect((await request(app).get('/api/products')).body.data).toHaveLength(1)
})

test('supplier suspension from a report revokes access and removes its stores', async () => {
  const owner = await account()
  const admin = await account('admin')
  const store = await Store.create({ name: 'Store', supplierId: owner.user._id, reviewStatus: 'approved', isActive: true })
  const report = await request(app).post('/api/reports').send({ targetType: 'supplier', targetId: String(owner.user._id), reason: 'fraud' })
  expect(report.status).toBe(201)
  const response = await request(app).put('/api/reports/' + report.body.report._id + '/resolve').set(auth(admin.token))
    .send({ action: 'resolved', resolutionNotes: 'إيقاف لحين التحقق', moderationAction: 'suspend_supplier' })
  expect(response.status).toBe(200)
  expect((await Supplier.findById(owner.user._id)).isActive).toBe(false)
  expect((await Store.findById(store._id)).isActive).toBe(false)
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(owner.token))).status).toBe(401)
  expect((await request(app).get('/api/stores/' + store._id)).status).toBe(404)
})

test('audit storage failure prevents a profile change and never returns success', async () => {
  const owner = await account()
  jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit unavailable'))
  const response = await request(app).put('/api/suppliers/' + owner.user._id).set(auth(owner.token)).send({ name: 'Must not persist' })
  expect(response.status).toBe(500)
  expect((await Supplier.findById(owner.user._id)).name).toBe(owner.user.name)
})

test('concurrent acceptance consumes an invitation once and cannot grant two active organizations', async () => {
  const owner = await account()
  const otherOwner = await account()
  const staff = await account('staff')
  await company(owner.user)
  await company(otherOwner.user)
  const invitation = await request(app).post('/api/suppliers/me/staff-invitations').set(auth(owner.token))
    .send({ email: staff.user.email, permissions: ['manage_products'] })
  const accept = () => request(app).post('/api/suppliers/me/staff-invitations/' + invitation.body.invitation._id + '/accept')
    .set(auth(staff.token)).send({ token: invitation.body.acceptanceToken })
  const results = await Promise.all([accept(), accept()])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  expect(await Membership.countDocuments({ userId: staff.user._id, status: 'active' })).toBe(1)
  const second = await request(app).post('/api/suppliers/me/staff-invitations').set(auth(otherOwner.token))
    .send({ email: staff.user.email, permissions: ['manage_store'] })
  const secondAccept = await request(app).post('/api/suppliers/me/staff-invitations/' + second.body.invitation._id + '/accept')
    .set(auth(staff.token)).send({ token: second.body.acceptanceToken })
  expect(secondAccept.status).toBe(409)
  const current = await request(app).get('/api/suppliers/me/profile').set(auth(staff.token))
  expect(current.body.ownerId).toBe(String(owner.user._id))
})

test('concurrent logout revokes every old token while a later login gets a valid new version', async () => {
  const owner = await account()
  const olderToken = generateToken(owner.user)
  const logouts = await Promise.all([
    request(app).post('/api/suppliers/logout').set(auth(owner.token)),
    request(app).post('/api/suppliers/logout').set(auth(olderToken))
  ])
  expect(logouts.some(response => response.status === 200)).toBe(true)
  expect(logouts.every(response => [200, 401].includes(response.status))).toBe(true)
  for (const token of [owner.token, olderToken]) expect((await request(app).get('/api/suppliers/me/profile').set(auth(token))).status).toBe(401)
  const login = await request(app).post('/api/suppliers/login').send({ email: owner.user.email, password: 'password123' })
  expect(login.status).toBe(200)
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(login.body.token))).status).toBe(200)
})


test('pending dossiers are immutable, same replay is harmless and stale decisions cannot approve a newer submission', async () => {
  const owner = await account(), admin = await account('admin'), buyer = await account('buyer')
  const store = await Store.create({ name: 'Verification store', supplierId: owner.user._id, reviewStatus:'approved', isActive:true })
  const submit = body => request(app).post('/api/suppliers/me/verify').set(auth(owner.token)).send(body)
  const decide = body => request(app).put('/api/admin/suppliers/' + owner.user._id + '/verify').set(auth(admin.token)).send(body)
  const original = { iceNumber:'001234567890001', verificationRevision:0 }
  expect((await request(app).post('/api/suppliers/me/verify').set(auth(buyer.token)).send(original)).status).toBe(403)
  expect((await submit({...original, isVerified:true})).status).toBe(400)
  expect((await submit({...original, verificationDoc:'https://user:pass@example.test/file'})).status).toBe(400)
  const first=await submit(original);expect(first.status).toBe(200);expect(first.body.supplier.verificationRevision).toBe(1)
  expect((await submit(original)).body.replayed).toBe(true)
  expect((await submit({iceNumber:'changed',verificationRevision:1})).status).toBe(409)
  expect(await AuditLog.countDocuments({action:'SUPPLIER_VERIFICATION_SUBMITTED',phase:'completed',targetId:owner.user._id})).toBe(1)
  const rejected=await decide({action:'reject',verificationRevision:1,rejectionReason:'Correct dossier'});expect(rejected.status).toBe(200)
  const next=await submit({iceNumber:'001234567890002',verificationRevision:1});expect(next.status).toBe(200);expect(next.body.supplier.verificationRevision).toBe(2)
  expect((await decide({action:'approve',verificationRevision:1})).status).toBe(409)
  expect((await Supplier.findById(owner.user._id)).verificationStatus).toBe('pending')
  expect((await Store.findById(store._id)).isVerified).toBe(false)
  const decisions=await Promise.all([decide({action:'approve',verificationRevision:2}),decide({action:'reject',verificationRevision:2,rejectionReason:'Concurrent'})])
  expect(decisions.map(x=>x.status).sort()).toEqual([200,409])
  const final=await Supplier.findById(owner.user._id);expect(final.verificationRevision).toBe(2)
  expect((await Store.findById(store._id)).isVerified).toBe(final.isVerified)
  if(final.isVerified){expect((await submit({iceNumber:'001234567890002',verificationRevision:2})).body.replayed).toBe(true);expect((await Supplier.findById(owner.user._id)).isVerified).toBe(true)}
  expect((await request(app).get('/api/stores/'+store._id)).status).toBe(200)
})
