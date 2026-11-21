import { apiRequest } from './config'

beforeEach(() => { localStorage.clear(); global.fetch = jest.fn() })
afterEach(() => { delete global.fetch })

test.each([
  ['ar', 'تحقق من البيانات الإلزامية والقيم المدخلة ثم حاول مجدداً.'],
  ['en', 'Check the required information and entered values, then try again.'],
  ['fr', 'Vérifiez les informations obligatoires et les valeurs saisies, puis réessayez.']
])('validation errors use the selected language (%s)', async (lang, expected) => {
  localStorage.setItem('jomla_lang', lang)
  const serverMessage = lang === 'ar' ? 'Données invalides' : 'البيانات غير صالحة'
  fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: serverMessage }) })
  await expect(apiRequest('/products')).rejects.toMatchObject({ message: expected, status: 400 })
})

test('a useful Arabic server error is preserved in the Arabic interface', async () => {
  fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'اعتمد المتجر أولاً' }) })
  await expect(apiRequest('/products')).rejects.toMatchObject({ message: 'اعتمد المتجر أولاً', status: 409 })
})

test.each([
  ['ar', 'تعذر الاتصال بالخادم. تحقق من اتصالك ثم حاول مجدداً.'],
  ['en', 'Cannot connect to the server. Check your connection and try again.'],
  ['fr', 'Connexion au serveur impossible. Vérifiez votre connexion puis réessayez.']
])('network failures have a recovery instruction in %s', async (lang, expected) => {
  localStorage.setItem('jomla_lang', lang)
  fetch.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(apiRequest('/products')).rejects.toMatchObject({ message: expected, status: 0 })
})

test('an intentional request cancellation stays an AbortError', async () => {
  const abort = new DOMException('Aborted', 'AbortError')
  fetch.mockRejectedValue(abort)
  await expect(apiRequest('/products')).rejects.toBe(abort)
})

test.each([
  ['ar', 'الاسم: الاسم يجب أن يكون حرفين على الأقل', 'رقم الهاتف: راجع هذه القيمة.'],
  ['en', 'Name: The name must contain at least 2 characters.', 'Phone: Check this value.'],
  ['fr', 'Nom : Le nom doit contenir au moins 2 caractères.', 'Téléphone : Vérifiez cette valeur.']
])('validation feedback identifies the fields without losing structured errors (%s)', async (lang, name, phone) => {
  localStorage.setItem('jomla_lang', lang)
  const data = { message: '❌ بيانات غير صحيحة', errors: [
    { field: 'name', message: 'الاسم يجب أن يكون حرفين على الأقل' },
    { field: 'phone', message: 'Invalid value' }
  ] }
  fetch.mockResolvedValue({ ok: false, status: 400, json: async () => data })
  try { await apiRequest('/suppliers/register'); throw new Error('Expected request rejection') }
  catch (error) {
    expect(error.message).toContain(name)
    expect(error.message).toContain(phone)
    expect(error.data).toBe(data)
    expect(error.status).toBe(400)
  }
})

test('a French sign-in error explains that the credentials were rejected', async () => {
  localStorage.setItem('jomla_lang', 'fr')
  fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'بيانات الدخول غير صحيحة' }) })
  await expect(apiRequest('/suppliers/login')).rejects.toMatchObject({ message: 'Adresse e-mail ou mot de passe incorrect.' })
})

test.each(['ar', 'fr'])('technical database validation text is replaced by a field correction in %s', async lang => {
  localStorage.setItem('jomla_lang', lang)
  fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({
    message: '❌ خطأ في التحقق من البيانات', errors: [{ field: 'name', message: 'Path `name` is required.' }]
  }) })
  try { await apiRequest('/products'); throw new Error('Expected request rejection') }
  catch (error) {
    expect(error.message).toContain(lang === 'fr' ? 'Nom : Vérifiez cette valeur.' : 'الاسم: راجع هذه القيمة.')
    expect(error.message).not.toContain('Path `')
  }
})

test('multipart requests preserve the token, signal, and caller headers', async () => {
  const body = new FormData()
  body.append('hasImageRights', 'true')
  const controller = new AbortController()
  fetch.mockResolvedValue({ ok: true, json: async () => ({ imageUrl: '/uploads/example.png' }) })
  await apiRequest('/product-ai/upload', { method: 'POST', body, token: 'session', signal: controller.signal, headers: { 'X-Request-ID': 'local-test' } })
  expect(fetch).toHaveBeenCalledWith('/api/product-ai/upload', expect.objectContaining({ method: 'POST', body, signal: controller.signal, headers: { Authorization: 'Bearer session', 'X-Request-ID': 'local-test' } }))
})
