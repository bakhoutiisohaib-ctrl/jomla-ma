import { useState, useEffect, useCallback } from 'react'
import ImagePicker from '../common/ImagePicker'
import MarketAnalysis from './MarketAnalysis'
import { API } from '../../api/config'

export default function SupplierDashboard({ supplier, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [stats, setStats] = useState({ totalViews: 0, totalProducts: 0, avgRating: 0 })
  const [form, setForm] = useState({ name: '', category: '', price: '', city: supplier.city || '' })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [imgLoading, setImgLoading] = useState(false)
  const [imageFile, setImageFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [showImagePicker, setShowImagePicker] = useState(false)

  const fetchMyProducts = useCallback(async () => {
    try {
      const res = await fetch(`${API}/products`)
      const data = await res.json()
      const list = Array.isArray(data) ? data : data.data || []
      const mine = list.filter(p => p.supplierId === supplier._id)
      setProducts(mine)
      const totalViews = mine.reduce((s, p) => s + (p.views || 0), 0)
      setStats(prev => ({ ...prev, totalViews, totalProducts: mine.length }))
    } catch {
      setProducts([])
    }
  }, [supplier._id])

  const fetchMyReviews = useCallback(async () => {
    try {
      const res = await fetch(`${API}/reviews/${supplier._id}`)
      const data = await res.json()
      setReviews(Array.isArray(data.reviews) ? data.reviews : [])
      setStats(prev => ({ ...prev, avgRating: data.avg || 0 }))
    } catch {
      setReviews([])
    }
  }, [supplier._id])

  useEffect(() => {
    fetchMyProducts()
    fetchMyReviews()
  }, [fetchMyProducts, fetchMyReviews])

  async function handleImageUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setImageFile(file)
    setPreview(URL.createObjectURL(file))
    setAiResult(null)
  }

  function handleImageSelect(url) {
    setPreview(url)
    setForm(prev => ({ ...prev, imageUrl: url }))
    setShowImagePicker(false)
    setAiResult(null)
    setMsg('✅ تم اختيار الصورة!')
  }

  async function enhanceWithAI() {
    if (!imageFile || !form.name) return setMsg('⚠️ أضف اسم المنتج وصورة أولاً')
    setImgLoading(true)
    const formData = new FormData()
    formData.append('image', imageFile)
    formData.append('productName', form.name)
    formData.append('category', form.category || 'أخرى')

    try {
      const res = await fetch(`${API}/product-ai/enhance`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.aiData) {
        setAiResult(data)
        setForm(prev => ({ ...prev, name: data.aiData.title || prev.name, imageUrl: data.enhancedImage }))
        setMsg('✅ AI حسّن المنتج!')
      }
    } catch {
      setMsg('⚠️ خطأ في AI')
    } finally {
      setImgLoading(false)
    }
  }

  async function addProduct() {
    if (!form.name || !form.price || !form.category) return setMsg('⚠️ كمل جميع الخانات')
    setLoading(true)
    try {
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          supplierId: supplier._id,
          description: aiResult?.aiData?.description || form.description || '',
          imageUrl: aiResult?.enhancedImage || form.imageUrl || ''
        })
      })
      const data = await res.json()
      setMsg(data.message)
      setForm({ name: '', category: '', price: '', city: supplier.city || '' })
      setAiResult(null)
      setPreview(null)
      setImageFile(null)
      fetchMyProducts()
    } catch {
      setMsg('❌ تعذر إضافة المنتج')
    } finally {
      setLoading(false)
    }
  }

  async function deleteProduct(id) {
    try {
      await fetch(`${API}/products/${id}`, { method: 'DELETE' })
      fetchMyProducts()
    } catch {
      setMsg('❌ تعذر حذف المنتج')
    }
  }

  const inp = (ph, key, type = 'text') => (
    <input
      type={type}
      placeholder={ph}
      value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      style={{
        width: '100%',
        padding: '10px 14px',
        borderRadius: '8px',
        border: '1px solid #ddd',
        fontSize: '14px',
        direction: 'rtl',
        outline: 'none',
        boxSizing: 'border-box',
        marginBottom: '10px',
        fontFamily: "'Cairo', sans-serif"
      }}
    />
  )

  const tabs = [
    { id: 'overview', label: '📊 نظرة عامة' },
    { id: 'products', label: '📦 منتجاتي' },
    { id: 'add',      label: '➕ إضافة منتج' },
    { id: 'reviews',  label: '⭐ التقييمات' },
    { id: 'market',   label: '📈 تحليل السوق' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: "'Cairo', sans-serif" }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#C1272D,#8B1A1F)', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <label style={{ cursor: 'pointer' }}>
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid rgba(255,255,255,0.4)'
                }}
              >
                {supplier.avatar ? (
                  <img src={supplier.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '24px' }}>🏪</span>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files[0]
                  if (!file) return
                  const formData = new FormData()
                  formData.append('image', file)
                  formData.append('productName', 'avatar')
                  formData.append('category', 'profile')
                  try {
                    const res = await fetch(`${API}/product-ai/enhance`, { method: 'POST', body: formData })
                    const data = await res.json()
                    if (data.enhancedImage) {
                      await fetch(`${API}/suppliers/${supplier._id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avatar: data.enhancedImage })
                      })
                      supplier.avatar = data.enhancedImage
                      setMsg('✅ تم تحديث صورة البروفيل!')
                    }
                  } catch {
                    setMsg('⚠️ تعذر تحديث الصورة')
                  }
                }}
              />
            </label>
            <div style={{ direction: 'rtl' }}>
              <div style={{ color: 'white', fontSize: '18px', fontWeight: '700' }}>{supplier.name}</div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px' }}>📍 {supplier.city}</div>
            </div>
          </div>
          <button
            onClick={onLogout}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'white',
              borderRadius: '8px',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: '13px',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            خروج
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '0' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '10px 16px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontFamily: "'Cairo', sans-serif",
                whiteSpace: 'nowrap',
                fontWeight: '500',
                background: activeTab === t.id ? 'white' : 'transparent',
                color: activeTab === t.id ? '#C1272D' : 'rgba(255,255,255,0.85)',
                borderRadius: '8px 8px 0 0'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '24px auto', padding: '0 16px' }}>
        {msg && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '16px',
              background: msg.includes('✅') ? '#E1F5EE' : '#FAECE7',
              color: msg.includes('✅') ? '#0F6E56' : '#993C1D',
              direction: 'rtl',
              fontSize: '14px'
            }}
          >
            {msg}
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
              {[
                { icon: '📦', label: 'المنتجات', value: stats.totalProducts },
                { icon: '👁️', label: 'المشاهدات', value: stats.totalViews },
                { icon: '⭐', label: 'التقييم', value: stats.avgRating > 0 ? `${stats.avgRating}/5` : 'لا يوجد' },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    background: 'white',
                    borderRadius: '12px',
                    padding: '20px',
                    textAlign: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                  }}
                >
                  <div style={{ fontSize: '28px', marginBottom: '6px' }}>{s.icon}</div>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a' }}>{s.value}</div>
                  <div style={{ fontSize: '12px', color: '#888' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', direction: 'rtl' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>أحدث المنتجات</h3>
              {products.slice(0, 3).map(p => (
                <div key={p._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee' }}>
                  <span>{p.name}</span>
                  <span style={{ fontWeight: '700', color: '#E85D24' }}>{p.price} درهم</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div style={{ direction: 'rtl' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>قائمة المنتجات ({products.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
              {products.map(p => (
                <div key={p._id} style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', marginBottom: '10px' }} />}
                  <h4 style={{ margin: '0 0 6px' }}>{p.name}</h4>
                  <div style={{ color: '#E85D24', fontWeight: '700', marginBottom: '12px' }}>{p.price} درهم</div>
                  <button
                    onClick={() => deleteProduct(p._id)}
                    style={{ width: '100%', padding: '8px', background: '#FAECE7', color: '#993C1D', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                  >
                    🗑️ حذف المنتج
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Product Tab */}
        {activeTab === 'add' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', maxWidth: '520px', margin: '0 auto', boxShadow: '0 2px 12px rgba(0,0,0,0.07)', direction: 'rtl' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: '18px' }}>إضافة منتج جديد</h2>
            {inp('اسم المنتج *', 'name')}
            {inp('الفئة (ملابس، أحذية...) *', 'category')}
            {inp('سعر الجملة بالدرهم *', 'price', 'number')}
            {inp('المدينة', 'city')}

            <div style={{ margin: '14px 0' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '6px' }}>صورة المنتج:</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <label style={{ flex: 1, padding: '10px', background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: '8px', textAlign: 'center', cursor: 'pointer', fontSize: '13px' }}>
                  📁 رفع صورة
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                </label>
                <button
                  type="button"
                  onClick={() => setShowImagePicker(true)}
                  style={{ padding: '10px 14px', background: '#E6F1FB', color: '#185FA5', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                >
                  🔍 صور AI
                </button>
              </div>
            </div>

            {preview && (
              <div style={{ textAlign: 'center', margin: '14px 0' }}>
                <img src={preview} alt="معاينة" style={{ maxWidth: '100%', maxHeight: '180px', borderRadius: '8px' }} />
                {imageFile && (
                  <button
                    type="button"
                    onClick={enhanceWithAI}
                    disabled={imgLoading}
                    style={{ display: 'block', width: '100%', marginTop: '8px', padding: '10px', background: '#25D366', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                  >
                    {imgLoading ? '⏳ AI كيحسن الصورة...' : '✨ تحسين بالذكاء الاصطناعي'}
                  </button>
                )}
              </div>
            )}

            <button
              onClick={addProduct}
              disabled={loading}
              style={{ width: '100%', padding: '12px', background: '#C1272D', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', marginTop: '14px' }}
            >
              {loading ? 'جاري الإضافة...' : 'نشر المنتج الآن'}
            </button>
          </div>
        )}

        {/* Reviews Tab */}
        {activeTab === 'reviews' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', direction: 'rtl' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>تقييمات التجار ({reviews.length})</h2>
            {reviews.map((r, i) => (
              <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
                <div style={{ color: '#EF9F27', fontSize: '16px' }}>{'★'.repeat(r.stars)}</div>
                <p style={{ margin: '6px 0', color: '#444' }}>{r.comment}</p>
                <span style={{ fontSize: '11px', color: '#888' }}>{new Date(r.date || r.createdAt).toLocaleDateString('ar-MA')}</span>
              </div>
            ))}
          </div>
        )}

        {/* Market Analysis Tab */}
        {activeTab === 'market' && (
          <MarketAnalysis supplier={supplier} products={products} />
        )}
      </div>

      {showImagePicker && (
        <ImagePicker
          productName={form.name}
          category={form.category}
          onSelect={handleImageSelect}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  )
}
