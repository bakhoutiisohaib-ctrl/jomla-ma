// Run locally: node scripts/create-admin.js --name "..." --email "..."
// The password is read from hidden terminal input (or stdin), never arguments.
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const fs = require('fs')
const Supplier = require('../models/Supplier')
const { auditedChange } = require('../utils/audit')

async function createFirstAdmin({ name, email, password }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Name, email, and a password of at least 12 characters and at most 72 UTF-8 bytes are required.')
  }
  const locks = mongoose.connection.collection('adminBootstrapLocks')
  try {
    await locks.insertOne({ _id: 'first-admin', startedAt: new Date() })
  } catch (error) {
    if (error.code === 11000) throw new Error('Administrator bootstrap is already complete or in progress.')
    throw error
  }
  let created = false
  try {
    if (await Supplier.exists({ role: 'admin' })) throw new Error('An administrator already exists.')
    const admin = new Supplier({
      name: name.trim(), email: email.trim().toLowerCase(),
      password: await bcrypt.hash(password, 12), role: 'admin', isActive: true,
      isVerified: true, verificationStatus: 'verified'
    })
    await auditedChange({
      action: 'ADMIN_BOOTSTRAPPED', targetType: 'Supplier', targetId: admin._id,
      actor: { name: 'Local administrator setup', role: 'system' }, details: { email: admin.email }
    }, async () => { await admin.save(); created = true })
    return { id: String(admin._id), email: admin.email }
  } finally {
    // A successful account write retains the one-use lock, including on audit finalization failure.
    if (!created) await locks.deleteOne({ _id: 'first-admin' })
  }
}

function readPassword() {
  if (!process.stdin.isTTY) return Promise.resolve(fs.readFileSync(0, 'utf8').replace(/[\r\n]+$/, ''))
  return new Promise((resolve, reject) => {
    let password = ''
    process.stdout.write('Administrator password (hidden): ')
    process.stdin.setRawMode(true)
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdout.write('\n')
    }
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') { cleanup(); reject(new Error('Cancelled.')); return }
        if (character === '\r' || character === '\n') { cleanup(); resolve(password); return }
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1)
        else if (password.length < 129) password += character
      }
    }
    process.stdin.on('data', onData)
  })
}

async function main() {
  const args = process.argv.slice(2)
  const value = flag => args[args.indexOf(flag) + 1]
  if (args.length !== 4 || !args.includes('--name') || !args.includes('--email')) throw new Error('Usage: node scripts/create-admin.js --name "Name" --email "email@example.com"')
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before creating an administrator.')
  const password = await readPassword()
  await mongoose.connect(process.env.MONGODB_URI)
  try {
    const admin = await createFirstAdmin({ name: value('--name'), email: value('--email'), password })
    process.stdout.write('Administrator created for ' + admin.email + '.\n')
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
module.exports = { createFirstAdmin }
