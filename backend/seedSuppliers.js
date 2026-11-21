// Legacy destructive sample seeds are deliberately disabled.
if (require.main === module) {
  process.stderr.write('Legacy supplier seed disabled: it deleted accounts and omitted required credentials. Create real accounts through registration; use scripts/create-admin.js for the first administrator.\n')
  process.exitCode = 1
}
