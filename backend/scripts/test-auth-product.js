(async () => {
  try {
    const base = 'http://localhost:5000'

    // 1) login
    const loginResp = await fetch(base + '/api/suppliers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test-unique-12345@example.com', password: 'password123' })
    })
    const loginJson = await loginResp.json()
    console.log('LOGIN STATUS:', loginResp.status)
    console.log(JSON.stringify(loginJson, null, 2))

    if (!loginJson.token) {
      console.error('No token received — aborting')
      process.exit(1)
    }

    const token = loginJson.token

    // 2) create product
    const productResp = await fetch(base + '/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        name: 'حذاء اختبار من سكربت',
        category: 'أحذية',
        price: 199,
        city: 'فاس',
        supplierId: loginJson.supplier.id,
        supplierPhone: '+212600000001',
        description: 'منتج اختبار مصدّر من سكربت'
      })
    })

    const prodJson = await productResp.json()
    console.log('CREATE PRODUCT STATUS:', productResp.status)
    console.log(JSON.stringify(prodJson, null, 2))

    process.exit(0)
  } catch (err) {
    console.error('ERROR:', err)
    process.exit(2)
  }
})()
