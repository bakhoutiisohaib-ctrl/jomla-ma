// Synthetic fixture only: callers must already be connected to MongoMemoryServer
// and must set UPLOADS_DIR to a disposable directory (pilotIsolation does this).
const Organization = require('../../models/Organization')
const { saveImage } = require('../../middleware/upload')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function mediaFixture(owner, { buffer = png, mimetype = 'image/png' } = {}) {
  const organization = await Organization.findOne({ ownerSupplierId: owner._id }).lean()
  return saveImage({ buffer, mimetype }, {
    id: String(owner._id), ownerId: String(owner._id), role: owner.role,
    organizationId: organization ? String(organization._id) : null, permissions: ['all']
  })
}

module.exports = { mediaFixture, png }
