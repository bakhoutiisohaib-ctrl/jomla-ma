#!/usr/bin/env node
const path = require('path')
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../backend/.env'), quiet: true })
const { restoreDatabase } = require('../backend/services/backup')

async function main() {
  const args = process.argv.slice(2), options = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help') { console.log('Usage: node scripts/restore.js --archive DIRECTORY --target-db NEW_DATABASE --confirm-target NEW_DATABASE [--media-target NEW_DIRECTORY] [--outcome NEW_JSON_FILE]\nConnection: RESTORE_MONGODB_URI environment variable. Target database must be empty and differ from source and configured MONGODB_URI.'); return }
    const key = { '--archive': 'archive', '--target-db': 'targetDatabase', '--confirm-target': 'confirmTarget', '--media-target': 'mediaTarget', '--outcome': 'outcome' }[arg]
    if (!key || !args[index + 1] || args[index + 1].startsWith('--') || options[key]) throw new Error('Invalid arguments. Use --help.')
    options[key] = args[++index]
  }
  const result = await restoreDatabase(options)
  console.log(JSON.stringify({ status: result.outcome.status, targetDatabase: result.outcome.targetDatabase, documents: result.outcome.restoredDocuments, mediaFiles: result.outcome.restoredMediaFiles, outcome: result.outcomePath }))
}
main().catch(error => { console.error(error.message); if (error.outcomePath) console.error(`Outcome: ${error.outcomePath}`); process.exitCode = 1 })
