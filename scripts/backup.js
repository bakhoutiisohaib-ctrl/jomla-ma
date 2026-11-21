#!/usr/bin/env node
const path = require('path')
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../backend/.env'), quiet: true })
const { backupDatabase } = require('../backend/services/backup')

async function main() {
  const args = process.argv.slice(2), options = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help') { console.log('Usage: node scripts/backup.js --out NEW_DIRECTORY [--uploads DIRECTORY] [--no-media]\nConnection: MONGODB_URI environment variable. Pause application writes first.'); return }
    if (arg === '--no-media') { options.includeMedia = false; continue }
    const key = { '--out': 'output', '--uploads': 'uploads' }[arg]
    if (!key || !args[index + 1] || args[index + 1].startsWith('--') || options[key]) throw new Error('Invalid arguments. Use --help.')
    options[key] = args[++index]
  }
  if (!options.output) throw new Error('--out must name a new backup directory. Use --help.')
  const result = await backupDatabase(options)
  console.log(JSON.stringify({ status: 'complete', directory: result.output, collections: result.manifest.collections.length, documents: result.manifest.collections.reduce((sum, entry) => sum + entry.documents, 0), mediaFiles: result.manifest.media.files.length }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
