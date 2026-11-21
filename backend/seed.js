// Legacy destructive sample seeds are deliberately disabled.
if (require.main === module) {
  process.stderr.write('Legacy seed disabled: it deleted products and used invalid supplier references. Import only authorized, verified catalog data; use automated test fixtures for development.\n')
  process.exitCode = 1
}
