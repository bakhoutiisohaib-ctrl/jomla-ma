import { useState, useEffect, useCallback } from 'react'
import ProductCard from './components/products/ProductCard'
import RegisterPage from './components/auth/RegisterPage'
import LoginPage from './components/auth/LoginPage'
import SupplierPage from './components/suppliers/SupplierPage'
import SupplierDashboard from './components/suppliers/SupplierDashboard'
import AdminDashboard from './components/admin/AdminDashboard'
import { API } from './api/config'

export default function App() {
  const [page, setPage] = useState('home')
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageMsg, setImageMsg] = useState('')
  const [supplier, setSupplier] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [debounceTimer, setDebounceTimer] = useState(null)
  const [filterCity] = useState('')
  const [filterCategory] = useState('')
  const [filterPrice] = useState('')
  const [aiMessage, setAiMessage] = useState('')
  const [trending, setTrending] = useState([])
  const [visited, setVisited] = useState(() => {
    try {
      const saved = localStorage.getItem('visited')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`${API}/products`)
      const data = await res.json()
      setProducts(Array.isArray(data) ? data : data.data || [])
    } catch {
      setProducts([])
    }
  }, [])

  const fetchTrending = useCallback(async () => {
    try {
      const data = await fetch(`${API}/tracking/trending`).then(r => r.json())
      setTrending(Array.isArray(data) ? data : data.data || [])
    } catch {
      setTrending([])
    }
  }, [])

  useEffect(() => {
    fetchAll()
    fetchTrending()
  }, [fetchAll, fetchTrending])

  // تسجيل مشاهدة منتج
  async function trackView(productId) {
    try {
      await fetch(`${API}/tracking/view/${productId}`, { method: 'POST' })
      const newVisited = [productId, ...visited.filter(id => id !== productId)].slice(0, 10)
      setVisited(newVisited)
      localStorage.setItem('visited', JSON.stringify(newVisited))
    } catch {
      // ignore tracking errors in background
    }
  }

  async function handleSearch(q = query) {
    setLoading(true)
    setImageMsg('')
    setAiMessage('')

    try {
      // استعمل AI Search
      const res = await fetch(`${API}/ai-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q || '',
          city: filterCity,
          category: filterCategory
        })
      })
      const data = await res.json()

      let results = Array.isArray(data.products) ? data.products : []

      // تطبيق فلتر السعر
      if (filterPrice === 'asc') results = [...results].sort((a, b) => a.price - b.price)
      if (filterPrice === 'desc') results = [...results].sort((a, b) => b.price - a.price)

      setProducts(results)

      if (data.suggestions?.length > 0) setSuggestions(data.suggestions)
      if (data.message) setAiMessage(data.message)
    } catch {
      // fallback للبحث العادي
      try {
        const url = q ? `${API}/products/search?q=${encodeURIComponent(q)}` : `${API}/products`
        const res = await fetch(url)
        const data = await res.json()
        setProducts(Array.isArray(data) ? data : data.data || [])
      } catch {
        setProducts([])
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleInput(val) {
    setQuery(val)
    if (debounceTimer) clearTimeout(debounceTimer)
    if (val.length < 2) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/products/search?q=${encodeURIComponent(val)}`)
        const data = await res.json()
        const arr = Array.isArray(data) ? data : data.data || []
        setSuggestions(arr.slice(0, 3).map(p => p.name))
      } catch {
        setSuggestions([])
      }
    }, 350)
    setDebounceTimer(timer)
  }

  async function handleImageSearch(e) {
    const file = e.target.files[0]
    if (!file) return
    setImageLoading(true)
    setImageMsg('')
    const formData = new FormData()
    formData.append('image', file)
    try {
      const res = await fetch(`${API}/image-search`, { method: 'POST', body: formData })
      const data = await res.json()
      setProducts(Array.isArray(data.products) ? data.products : [])
      setImageMsg(data.message)
    } catch {
      setImageMsg('❌ تعذر إتمام البحث بالصورة')
    } finally {
      setImageLoading(false)
    }
  }

  if (page === 'admin') return <AdminDashboard onBack={() => setPage('home')} onLogout={() => { setSupplier(null); setPage('home') }} />
  if (page === 'register') return <RegisterPage onBack={() => setPage('home')} />
  if (supplier) return <SupplierDashboard supplier={supplier} onLogout={() => setSupplier(null)} onGoAdmin={() => setPage('admin')} />
  if (page === 'login') return <LoginPage onLogin={s => { setSupplier(s); if (s.role === 'admin') setPage('admin'); else setPage('home'); }} onBack={() => setPage('home')} />
  if (selectedSupplier) return <SupplierPage supplierId={selectedSupplier} onBack={() => setSelectedSupplier(null)} />


  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: "'Cairo', sans-serif" }}>
      {/* Header */}
      <div style={{ background: '#C1272D', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'white', fontSize: '20px', fontWeight: '700' }}>🇲🇦 Jomla.ma</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setPage('admin')}
            style={{
              background: 'rgba(0,0,0,0.2)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: '8px',
              padding: '7px 12px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            🛡️ الإشراف
          </button>
          <button
            onClick={() => setPage('login')}
            style={{
              background: 'transparent',
              color: 'white',
              border: '1px solid white',
              borderRadius: '8px',
              padding: '7px 14px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            دخول المورد
          </button>
          <button
            onClick={() => setPage('register')}
            style={{
              background: 'white',
              color: '#C1272D',
              border: 'none',
              borderRadius: '8px',
              padding: '7px 14px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            سجل كمورد
          </button>
        </div>
      </div>

      {/* Hero Search Section */}
      <div style={{ background: 'linear-gradient(135deg,#C1272D,#8B1A1F)', padding: '40px 24px', textAlign: 'center' }}>
        <h1 style={{ color: 'white', margin: '0 0 8px', fontSize: '26px' }}>
          قلب على أي منتج بالجملة
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.8)', margin: '0 0 20px', fontSize: '14px' }}>
          تواصل مع الموردين مباشرة عبر الواتساب
        </p>

        <div style={{ position: 'relative', maxWidth: '500px', margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={query}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="ابحث: صباط، قميص، نظارات..."
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '15px',
                direction: 'rtl',
                outline: 'none',
                fontFamily: "'Cairo', sans-serif"
              }}
            />
            <button
              onClick={() => handleSearch()}
              style={{
                padding: '12px 20px',
                background: '#E85D24',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: '600',
                fontFamily: "'Cairo', sans-serif"
              }}
            >
              {loading ? '...' : 'بحث'}
            </button>
            <label
              style={{
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '15px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              {imageLoading ? '⏳' : '📸'}
              <input type="file" accept="image/*" onChange={handleImageSearch} style={{ display: 'none' }} />
            </label>
          </div>

          {suggestions.length > 0 && query && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: '0',
                left: '48px',
                background: 'white',
                borderRadius: '8px',
                marginTop: '4px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 10
              }}
            >
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  onClick={() => {
                    setQuery(s)
                    setSuggestions([])
                    handleSearch(s)
                  }}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    direction: 'rtl',
                    fontSize: '14px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right'
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
          )}

          {imageMsg && (
            <div style={{ background: '#E1F5EE', padding: '10px 24px', textAlign: 'center', fontSize: '13px', color: '#0F6E56', direction: 'rtl', marginTop: '14px', borderRadius: '8px' }}>
              🔍 {imageMsg}
            </div>
          )}

          {aiMessage && (
            <div style={{ background: '#E6F1FB', padding: '10px 24px', textAlign: 'center', fontSize: '13px', color: '#185FA5', direction: 'rtl', marginTop: '10px', borderRadius: '8px' }}>
              💡 {aiMessage}
            </div>
          )}
        </div>
      </div>

      {/* Trending Products */}
      {!query && trending.length > 0 && (
        <div style={{ maxWidth: '1100px', margin: '16px auto 0', padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', direction: 'rtl' }}>
            <span style={{ fontSize: '18px' }}>🔥</span>
            <h2 style={{ margin: '0', fontSize: '15px', color: '#333' }}>الأكثر طلباً دابا</h2>
          </div>
          <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px' }}>
            {trending.map(p => (
              <div
                key={p._id}
                onClick={() => {
                  trackView(p._id)
                  setSelectedSupplier(p.supplierId)
                }}
                style={{
                  minWidth: '140px',
                  background: 'white',
                  borderRadius: '10px',
                  padding: '12px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.07)',
                  cursor: 'pointer',
                  border: '1px solid #eee',
                  direction: 'rtl',
                  flexShrink: 0
                }}
              >
                <div style={{ fontSize: '10px', color: '#1D9E75', background: '#E1F5EE', padding: '2px 6px', borderRadius: '20px', display: 'inline-block', marginBottom: '6px' }}>
                  {p.category}
                </div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', marginBottom: '4px' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#E85D24' }}>
                  {p.price} درهم
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                  👁️ {p.views || 0} مشاهدة
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visited Recently */}
      {!query && visited.length > 0 && (
        <div style={{ maxWidth: '1100px', margin: '8px auto 0', padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', direction: 'rtl' }}>
            <span style={{ fontSize: '16px' }}>🕐</span>
            <h2 style={{ margin: '0', fontSize: '14px', color: '#888' }}>شفتيه من قبل</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(Array.isArray(products) ? products : []).filter(p => visited.includes(p._id)).slice(0, 4).map(p => (
              <div
                key={p._id}
                onClick={() => {
                  trackView(p._id)
                  setSelectedSupplier(p.supplierId)
                }}
                style={{
                  padding: '6px 14px',
                  background: '#f0f0f0',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: '#333'
                }}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Products Grid */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', direction: 'rtl' }}>
          <h2 style={{ margin: '0', fontSize: '16px', color: '#333' }}>
            {loading ? 'جاري البحث...' : `${products.length} منتج`}
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
          {products.map(p => (
            <ProductCard key={p._id} product={p} onViewSupplier={setSelectedSupplier} onView={trackView} />
          ))}
        </div>
        {products.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888', direction: 'rtl' }}>
            ما كاين والو — جرب كلمة أخرى
          </div>
        )}
      </div>

      {/* Moroccan B2B Footer */}
      <footer style={{ background: '#0F172A', color: '#94A3B8', padding: '24px 16px', marginTop: '48px', direction: 'rtl', fontSize: '13px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <span style={{ color: 'white', fontWeight: '700', fontSize: '15px' }}>🇲🇦 Jomla.ma</span>
            <span style={{ marginRight: '8px' }}>— منصة تجارة الجملة المغربية الذكية</span>
          </div>
          <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>🏛️ توثيق بالـ ICE والسجل التجاري</span>
            <span>📑 طلبات عروض أسعار (RFQ)</span>
            <button
              onClick={() => setPage('admin')}
              style={{
                background: '#1E293B',
                border: '1px solid #334155',
                color: '#38BDF8',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: "'Cairo', sans-serif"
              }}
            >
              🛡️ لوحة الإشراف
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
