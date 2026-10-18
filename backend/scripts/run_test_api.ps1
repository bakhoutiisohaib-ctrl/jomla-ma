$base = 'http://localhost:5000'
$email = 'test+bot@example.com'
$pass = 'password123'

try {
  $regBody = @{ name='Test Supplier Bot'; email=$email; password=$pass; city='فاس'; phone='+212600000001' } | ConvertTo-Json
  $reg = Invoke-RestMethod "$base/api/suppliers/register" -Method Post -ContentType 'application/json' -Body $regBody -ErrorAction Stop
  Write-Output "REGISTER_OK:"
  $reg | ConvertTo-Json -Depth 5 | Write-Output
} catch {
  Write-Output "REGISTER_FAILED:"
  Write-Output $_.Exception.Message
}

try {
  $loginBody = @{ email=$email; password=$pass } | ConvertTo-Json
  $login = Invoke-RestMethod "$base/api/suppliers/login" -Method Post -ContentType 'application/json' -Body $loginBody -ErrorAction Stop
  Write-Output "LOGIN_OK:"
  $login | ConvertTo-Json -Depth 5 | Write-Output
  $token = $login.token
} catch {
  Write-Output "LOGIN_FAILED:"
  Write-Output $_.Exception.Message
  exit 1
}

try {
  $prodBody = @{ name='Test Product Auto'; category='Shoes'; price=199; city='Fes'; supplierPhone='+212600000001'; description='Auto test product' } | ConvertTo-Json
  $prod = Invoke-RestMethod "$base/api/products" -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body $prodBody -ErrorAction Stop
  Write-Output "PRODUCT_CREATED:"
  $prod | ConvertTo-Json -Depth 5 | Write-Output
} catch {
  Write-Output "PRODUCT_FAILED:"
  Write-Output $_.Exception.Message
  exit 1
}
