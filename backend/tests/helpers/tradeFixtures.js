const Supplier = require('../../models/Supplier')
const Product = require('../../models/Product')
const Store = require('../../models/Store')
const Organization = require('../../models/Organization')
const Membership = require('../../models/Membership')
const { generateToken } = require('../../middleware/auth')
const { mediaFixture } = require('./mediaFixture')
let serial = 0
module.exports = async function tradeFixtures() {
  serial += 1
  const create = (name, role) => Supplier.create({ name, role, email: role + serial + name.length + '@trade.test', password: 'fixture-password', phone: '+212612345678', city: 'الرباط' })
  const supplier = await create('المورد الأول', 'supplier')
  const otherSupplier = await create('المورد الآخر الثاني', 'supplier')
  const buyer = await create('المشتري الأول', 'buyer')
  const otherBuyer = await create('المشتري الآخر الثاني', 'buyer')
  const staff = await create('موظف المبيعات', 'staff')
  const organization = await Organization.create({ ownerSupplierId: supplier._id, name: supplier.name })
  const membership = await Membership.create({ organizationId: organization._id, userId: staff._id, invitedEmail: staff.email, role: 'staff', permissions: ['manage_rfq'], status: 'active', invitedBy: supplier._id })
  const store = await Store.create({ supplierId: supplier._id, name: 'متجر الاختبار', slug: 'trade-' + serial, reviewStatus: 'approved', isActive: true, city: 'الرباط' })
  const product = await Product.create({ name: 'أحذية جملة للاختبار', category: 'أحذية', price: 120, city: 'الرباط', moq: 10, unit: 'زوج',
    supplierId: supplier._id, supplierPhone: supplier.phone, storeId: store._id, imageUrl: await mediaFixture(supplier),
    description: 'منتج للاختبار بوصف واضح ومكتمل', isDraft: false, inStock: true, availability: 'in_stock', availabilityConfirmed: true,
    hasImageRights: true, imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() }, approvedBy: supplier._id, approvedAt: new Date() })
  const users = { supplier, otherSupplier, buyer, otherBuyer, staff }
  const tokens = Object.fromEntries(Object.entries(users).map(([name, user]) => [name, generateToken(user)]))
  return { ...users, tokens, organization, membership, store, product }
}
