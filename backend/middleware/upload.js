const multer = require('multer')
const path = require('path')
const fs = require('fs')

const uploadDir = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname)
    const name = file.fieldname + '-' + Date.now() + ext
    cb(null, name)
  }
})

const fileFilter = (req, file, cb) => {
  if (/image\/(jpeg|png|webp|gif)/.test(file.mimetype)) cb(null, true)
  else cb(new Error('Invalid file type'), false)
}

module.exports = multer({ storage, fileFilter })
