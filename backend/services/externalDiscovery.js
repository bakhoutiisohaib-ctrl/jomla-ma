const { isIP } = require('net')
const ExternalDiscoveryResult = require('../models/ExternalDiscoveryResult')

const PROVIDER_URL = 'https://api.search.brave.com/res/v1/web/search'
const NOTICE = 'خارجي تجريبي: نتائج بحث من الويب لم تتحقق المنصة من الموردين أو المخزون أو حقوق المحتوى. راجع المصدر قبل التعامل.'
const disabled = reason => ({ enabled: false, reason, results: [], externalSources: [] })

// These links are displayed, never fetched by the server. Block credentials,
// non-web protocols, local names and IP literals nevertheless.
function safePublicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        !host.includes('.') || isIP(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
        (url.port && !['80', '443'].includes(url.port))) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

function configuration() {
  const termsReference = safePublicUrl(process.env.EXTERNAL_DISCOVERY_TERMS_REFERENCE)
  if (process.env.EXTERNAL_DISCOVERY_ENABLED !== 'true' ||
      process.env.EXTERNAL_DISCOVERY_PROVIDER !== 'brave' ||
      process.env.EXTERNAL_DISCOVERY_TERMS_ACCEPTED !== 'true' ||
      !process.env.BRAVE_SEARCH_API_KEY || !termsReference || !termsReference.startsWith('https:')) return null
  return { termsReference, key: process.env.BRAVE_SEARCH_API_KEY }
}

async function discoverExternally(query, { internalTotal = 0, category = '' } = {}) {
  if (internalTotal > 0) return disabled('internal_results_available')
  if (typeof query !== 'string' || !query.trim()) return disabled('empty_query')
  const config = configuration()
  if (!config) return disabled('external_provider_not_configured_or_terms_not_confirmed')
  const q = query.trim().slice(0, 120)
  const endpoint = new URL(PROVIDER_URL)
  endpoint.search = new URLSearchParams({ q: q + ' wholesale Morocco', count: '5', result_filter: 'web', safesearch: 'strict', text_decorations: 'false', operators: 'false' }).toString()
  const queriedAt = new Date()
  let response, data
  try {
    response = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': config.key },
      signal: AbortSignal.timeout(5000), redirect: 'error'
    })
    if (!response.ok) return disabled('external_provider_unavailable')
    data = await response.json()
  } catch { return disabled('external_provider_unavailable') }
  const seen = new Set()
  const results = []
  for (const row of Array.isArray(data?.web?.results) ? data.web.results : []) {
    const url = safePublicUrl(row?.url)
    if (!url || seen.has(url) || typeof row.title !== 'string' || !row.title.trim()) continue
    seen.add(url)
    const title = row.title.replace(/<[^>]*>/g, '').trim().slice(0, 300)
    if (!title) continue
    results.push({ title, url,
      description: typeof row.description === 'string' ? row.description.replace(/<[^>]*>/g, '').trim().slice(0, 500) : '',
      sourceName: new URL(url).hostname, external: true, isVerified: false })
    if (results.length === 5) break
  }
  try {
    const record = await ExternalDiscoveryResult.create({
      query: q, provider: 'brave', termsReference: config.termsReference, queriedAt,
      detectedCategory: typeof category === 'string' ? category.slice(0, 100) : '',
      isAvailableInCatalog: false, results, disclaimer: NOTICE,
      externalSources: results.map(r => ({ sourceName: r.sourceName, sourceType: 'search_engine', searchUrl: r.url, isVerified: false }))
    })
    return { enabled: true, provider: 'brave', queriedAt, termsReference: config.termsReference,
      discoveryId: record._id, results, notice: NOTICE, externalSources: [] }
  } catch { return disabled('external_discovery_not_saved') }
}

module.exports = { discoverExternally, safePublicUrl }
