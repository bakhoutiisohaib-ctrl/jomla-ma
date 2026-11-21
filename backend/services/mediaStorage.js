const fs = require('fs')
const path = require('path')

// Mount this directory on persistent storage in production. A process restart or
// a fresh deployment must not replace it with an ephemeral application checkout.
function uploadsDirectory() {
  const configured = process.env.UPLOADS_DIR
  if (configured && !path.isAbsolute(configured)) throw new Error('UPLOADS_DIR must be absolute')
  return configured || path.resolve(__dirname, '../uploads')
}

function localImagePath(url) {
  if (typeof url !== 'string' || !/^\/uploads\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/.test(url)) return null
  const root = uploadsDirectory(), target = path.join(root, path.basename(url))
  if (fs.existsSync(root) && fs.realpathSync(root) !== path.resolve(root)) throw new Error('Uploads directory cannot be a symbolic link')
  if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isFile())) throw new Error('Invalid image storage entry')
  return target
}

module.exports = { uploadsDirectory, localImagePath }
