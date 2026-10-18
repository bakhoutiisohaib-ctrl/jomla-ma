import { useState, useEffect } from 'react'

const API = 'http://localhost:5000/api'

function RegisterPage({ onBack }) {
  const [form, setForm] = useState({
    name:'', city:'', phone:'', description:'', email:'', password:''
  })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!form.name || !form.email || !form.password || !form.phone) {
      setMsg(' كمل جميع الخانات المطلوبة')
      return
    }
    setLoading(true)
    const res = await fetch('http://localhost:5000/api/suppliers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    const data = await res.json()
    setLoading(false)
    setMsg(data.message)
    if (res.ok) setTimeout(onBack, 1500)
  }

  const input = (placeholder, key, type='text') => (
    <input
      type={type}
      placeholder={placeholder}
      value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      style={{ width:'100%', padding:'11px 14px', borderRadius:'8px',
        border:'1px solid #ddd', fontSize:'14px', direction:'rtl',
        outline:'none', boxSizing:'border-box', marginBottom:'10px' }}
    />
  )

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', fontFamily:"'Cairo', sans-serif" }}>
      <div style={{ background:'#C1272D', padding:'14px 24px', display:'flex', alignItems:'center', gap:'12px' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'white', fontSize:'20px', cursor:'pointer' }}></button>
        <span style={{ color:'white', fontSize:'18px', fontWeight:'700' }}>تسجيل مورد جديد</span>
      </div>
      <div style={{ maxWidth:'480px', margin:'40px auto', padding:'0 16px' }}>
        <div style={{ background:'white', borderRadius:'16px', padding:'28px', boxShadow:'0 2px 12px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin:'0 0 20px', fontSize:'18px', color:'#1a1a1a', direction:'rtl', textAlign:'right' }}>
            سجل متجرك الآن مجاناً
          </h2>
          {input('اسم الشركة أو المتجر *', 'name')}
          {input('المدينة *', 'city')}
          {input('رقم واتساب (212XXXXXXXXX) *', 'phone')}
          {input('وصف مختصر عن متجرك', 'description')}
          {input('الإيميل *', 'email', 'email')}
          {input('كلمة المرور *', 'password', 'password')}
          {msg && (
            <div style={{ padding:'10px 14px', borderRadius:'8px', marginBottom:'12px', background: msg.includes('') ? '#E1F5EE' : '#FAECE7', color: msg.includes('') ? '#0F6E56' : '#993C1D', fontSize:'13px', direction:'rtl' }}>
              {msg}
            </div>
          )}
          <button onClick={handleSubmit} disabled={loading} style={{ width:'100%', padding:'13px', background:'#C1272D', color:'white', border:'none', borderRadius:'10px', fontSize:'15px', fontWeight:'700', cursor:'pointer' }}>
            {loading ? 'جاري التسجيل...' : 'سجل متجري الآن'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductCard({ product, onViewSupplier, onView }) {
  const whatsapp = `https://wa.me/${product.supplierPhone}?text=${encodeURIComponent(`السلام عليكم، شفت منتج "${product.name}" على Jomla.ma، بغيت معلومات أكثر`)}`

  return (
    <div onClick={() => onView && onView(product._id)} style={{ background:'white', borderRadius:'12px', padding:'16px', boxShadow:'0 2px 8px rgba(0,0,0,0.08)', border:'1px solid #eee', direction:'rtl', cursor:'pointer', transition:'transform 0.2s' }}>
      <div style={{ fontSize:'11px', color:'#1D9E75', fontWeight:'500', background:'#E1F5EE', padding:'2px 8px', borderRadius:'20px', display:'inline-block', marginBottom:'8px' }}>
        {product.category}
      </div>
      <h3 style={{ margin:'0 0 6px', fontSize:'15px', color:'#1a1a1a' }}>
        {product.name}
      </h3>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'10px' }}>
        <span style={{ fontSize:'18px', fontWeight:'700', color:'#E85D24' }}>
          {product.price} درهم
        </span>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'2px' }}>
          <span style={{ fontSize:'12px', color:'#888' }}>{product.city}</span>
          {product.avgStars > 0 && (
            <span style={{ fontSize:'12px', color:'#EF9F27' }}>
              {'★'.repeat(Math.round(product.avgStars))} {product.avgStars}
            </span>
          )}
        </div>
      </div>
      <div style={{ display:'flex', gap:'8px', marginTop:'12px' }}>
        <a href={whatsapp} target="_blank" rel="noreferrer" style={{ flex:1, padding:'8px', background:'#25D366', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'13px', fontWeight:'500', textAlign:'center', textDecoration:'none' }}>
          💬 واتساب
        </a>
        <button onClick={() => onViewSupplier(product.supplierId)} style={{ flex:1, padding:'8px', background:'#E6F1FB', color:'#185FA5', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'13px', fontWeight:'500' }}>
          🏪 المورد
        </button>
      </div>
    </div>
  )
}

function SupplierPage({ supplierId, onBack }) {
  const [supplier, setSupplier] = useState(null)
  const [products, setProducts] = useState([])

  useEffect(() => {
    fetch(`http://localhost:5000/api/suppliers/${supplierId}`)
      .then(r => r.json()).then(setSupplier)
    fetch(`http://localhost:5000/api/suppliers/${supplierId}/products`)
      .then(r => r.json()).then(data => setProducts(Array.isArray(data) ? data : data.data || []))
  }, [supplierId])

  if (!supplier) return (
    <div style={{ textAlign:'center', padding:'60px', fontFamily:"'Cairo',sans-serif" }}>
      جاري التحميل...
    </div>
  )

  const whatsapp = `https://wa.me/${supplier.phone}?text=السلام عليكم، شفت متجرك على Jomla.ma`

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', fontFamily:"'Cairo',sans-serif" }}>
      <div style={{ background:'#C1272D', padding:'14px 24px', display:'flex', alignItems:'center', gap:'12px' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'white', fontSize:'20px', cursor:'pointer' }}>←</button>
        <span style={{ color:'white', fontSize:'18px', fontWeight:'700' }}>🇲🇦 Jomla.ma</span>
      </div>

      <div style={{ background:'linear-gradient(135deg,#C1272D,#8B1A1F)', padding:'28px 24px' }}>
        <div style={{ maxWidth:'800px', margin:'0 auto', background:'rgba(255,255,255,0.1)', borderRadius:'16px', padding:'20px 24px', direction:'rtl' }}>
          <h1 style={{ color:'white', margin:'0 0 6px', fontSize:'22px' }}>
            🏪 {supplier.name}
          </h1>
          <p style={{ color:'rgba(255,255,255,0.85)', margin:'0 0 4px', fontSize:'14px' }}>
            📍 {supplier.city}
          </p>
          {supplier.description && (
            <p style={{ color:'rgba(255,255,255,0.75)', margin:'0 0 16px', fontSize:'13px' }}>
              {supplier.description}
            </p>
          )}
          <a href={whatsapp} target="_blank" rel="noreferrer" style={{ display:'inline-block', padding:'10px 24px', background:'#25D366', color:'white', borderRadius:'10px', textDecoration:'none', fontWeight:'700', fontSize:'14px' }}>
            💬 تواصل عبر واتساب
          </a>
        </div>
      </div>

      <div style={{ maxWidth:'800px', margin:'24px auto', padding:'0 16px' }}>
        <h2 style={{ direction:'rtl', fontSize:'16px', color:'#333', marginBottom:'16px' }}>
          📦 منتجات المورد ({products.length})
        </h2>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'14px' }}>
          {products.map(p => (
            <div key={p._id} style={{ background:'white', borderRadius:'12px', padding:'16px', boxShadow:'0 2px 8px rgba(0,0,0,0.07)', border:'1px solid #eee', direction:'rtl' }}>
              <div style={{ fontSize:'11px', color:'#1D9E75', fontWeight:'500', background:'#E1F5EE', padding:'2px 8px', borderRadius:'20px', display:'inline-block', marginBottom:'8px' }}>
                {p.category}
              </div>
              <h3 style={{ margin:'0 0 8px', fontSize:'14px', color:'#1a1a1a' }}>
                {p.name}
              </h3>
              <span style={{ fontSize:'18px', fontWeight:'700', color:'#E85D24' }}>
                {p.price} درهم
              </span>
            </div>
          ))}
        </div>
        {products.length === 0 && (
          <div style={{ textAlign:'center', padding:'40px', color:'#888' }}>
            ما زال ما زاف منتجات
          </div>
        )}
      </div>

      <div style={{ maxWidth:'800px', margin:'0 auto 40px', padding:'0 16px' }}>
        <ReviewSection supplierId={supplierId} />
      </div>
    </div>
  )
}

function ImagePicker({ productName, category, onSelect, onClose }) {
  const [images, setImages]   = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => { searchImages() }, [])

  async function searchImages() {
    setLoading(true)
    const res  = await fetch(`${API}/product-ai/search-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName, category })
    })
    const data = await res.json()
    setImages(data.images || [])
    setLoading(false)
  }

  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0,
      background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex',
      alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'24px',
        maxWidth:'600px', width:'100%', maxHeight:'80vh', overflow:'auto', direction:'rtl' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
          <h3 style={{ margin:0, fontSize:'16px' }}>🔍 اختار صورة احترافية</h3>
          <button onClick={onClose} style={{ background:'none', border:'none',
            fontSize:'20px', cursor:'pointer', color:'#888' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign:'center', padding:'40px', color:'#888' }}>
            ⏳ AI كيبحث على صور احترافية...
          </div>
        ) : (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'10px', marginBottom:'16px' }}>
              {images.map((img, i) => (
                <div key={i} onClick={() => setSelected(img.url)}
                  style={{ cursor:'pointer', borderRadius:'10px', overflow:'hidden',
                    border: selected === img.url ? '3px solid #C1272D' : '3px solid transparent',
                    transition:'border 0.2s' }}>
                  <img src={img.thumb} alt="" style={{ width:'100%', height:'100px', objectFit:'cover' }} />
                  <div style={{ fontSize:'10px', color:'#aaa', padding:'2px 4px',
                    textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    📷 {img.credit}
                  </div>
                </div>
              ))}
            </div>

            {images.length === 0 && (
              <div style={{ textAlign:'center', color:'#888', padding:'20px' }}>
                ما لقيناش صور — جرب اسم منتج آخر
              </div>
            )}

            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={() => selected && onSelect(selected)} disabled={!selected}
                style={{ flex:1, padding:'11px', background: selected ? '#C1272D' : '#ddd',
                  color:'white', border:'none', borderRadius:'10px',
                  cursor: selected ? 'pointer' : 'not-allowed', fontSize:'14px',
                  fontWeight:'600', fontFamily:"'Cairo',sans-serif" }}>
                ✅ اختار هاد الصورة
              </button>
              <button onClick={searchImages}
                style={{ padding:'11px 16px', background:'#E6F1FB', color:'#185FA5',
                  border:'none', borderRadius:'10px', cursor:'pointer', fontSize:'13px' }}>
                🔄 بحث جديد
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SupplierDashboard({ supplier, onLogout }) {
  const [activeTab, setActiveTab]   = useState('overview')
  const [products, setProducts]     = useState([])
  const [reviews, setReviews]       = useState([])
  const [stats, setStats]           = useState({ totalViews:0, totalProducts:0, avgRating:0 })
  const [form, setForm]             = useState({ name:'', category:'', price:'', city:supplier.city })
  const [msg, setMsg]               = useState('')
  const [loading, setLoading]       = useState(false)
  const [aiResult, setAiResult]     = useState(null)
  const [imgLoading, setImgLoading] = useState(false)
  const [imageFile, setImageFile]   = useState(null)
  const [preview, setPreview]       = useState(null)
  const [showImagePicker, setShowImagePicker] = useState(false)

  useEffect(() => {
    fetchMyProducts()
    fetchMyReviews()
  }, [])

  async function fetchMyProducts() {
    const res  = await fetch(`${API}/products`)
    const data = await res.json()
    const mine = Array.isArray(data) ? data.filter(p => p.supplierId === supplier._id) : []
    setProducts(mine)
    const totalViews = mine.reduce((s, p) => s + (p.views || 0), 0)
    setStats(prev => ({ ...prev, totalViews, totalProducts: mine.length }))
  }

  async function fetchMyReviews() {
    const res  = await fetch(`${API}/reviews/${supplier._id}`)
    const data = await res.json()
    setReviews(Array.isArray(data.reviews) ? data.reviews : [])
    setStats(prev => ({ ...prev, avgRating: data.avg || 0 }))
  }

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
      const res  = await fetch(`${API}/product-ai/enhance`, { method:'POST', body: formData })
      const data = await res.json()
      if (data.aiData) {
        setAiResult(data)
        setForm(prev => ({ ...prev, name: data.aiData.title || prev.name, imageUrl: data.enhancedImage }))
        setMsg('✅ AI حسّن المنتج!')
      }
    } catch { setMsg('⚠️ خطأ في AI') }
    setImgLoading(false)
  }

  async function addProduct() {
    if (!form.name || !form.price || !form.category) return setMsg('⚠️ كمل جميع الخانات')
    setLoading(true)
    const res  = await fetch(`${API}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, price: Number(form.price), supplierId: supplier._id,
        description: aiResult?.aiData?.description || '', imageUrl: aiResult?.enhancedImage || '' })
    })
    const data = await res.json()
    setLoading(false)
    setMsg(data.message)
    setForm({ name:'', category:'', price:'', city: supplier.city })
    setAiResult(null); setPreview(null); setImageFile(null)
    fetchMyProducts()
  }

  async function deleteProduct(id) {
    await fetch(`${API}/products/${id}`, { method:'DELETE' })
    fetchMyProducts()
  }

  const inp = (ph, key, type='text') => (
    <input type={type} placeholder={ph} value={form[key]}
      onChange={e => setForm({...form, [key]: e.target.value})}
      style={{ width:'100%', padding:'10px 14px', borderRadius:'8px', border:'1px solid #ddd',
        fontSize:'14px', direction:'rtl', outline:'none', boxSizing:'border-box', marginBottom:'10px',
        fontFamily:"'Cairo',sans-serif" }} />
  )

  const tabs = [
    { id:'overview', label:'📊 نظرة عامة' },
    { id:'products', label:'📦 منتجاتي' },
    { id:'add',      label:'➕ إضافة منتج' },
    { id:'reviews',  label:'⭐ التقييمات' },
    { id:'market',   label:'📈 تحليل السوق' },
  ]

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', fontFamily:"'Cairo',sans-serif" }}>

      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#C1272D,#8B1A1F)', padding:'0 24px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
            <label style={{ cursor:'pointer' }}>
              <div style={{ width:'52px', height:'52px', borderRadius:'50%',
                background:'rgba(255,255,255,0.2)', overflow:'hidden',
                display:'flex', alignItems:'center', justifyContent:'center',
                border:'2px solid rgba(255,255,255,0.4)' }}>
                {supplier.avatar
                  ? <img src={supplier.avatar} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  : <span style={{ fontSize:'24px' }}>🏪</span>
                }
              </div>
              <input type="file" accept="image/*" style={{ display:'none' }}
                onChange={async (e) => {
                  const file = e.target.files[0]
                  if (!file) return
                  const formData = new FormData()
                  formData.append('image', file)
                  formData.append('productName', 'avatar')
                  formData.append('category', 'profile')
                  const res  = await fetch(`${API}/product-ai/enhance`, { method:'POST', body: formData })
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
                }}
              />
            </label>
            <div style={{ direction:'rtl' }}>
              <div style={{ color:'white', fontSize:'18px', fontWeight:'700' }}>{supplier.name}</div>
              <div style={{ color:'rgba(255,255,255,0.75)', fontSize:'12px' }}>📍 {supplier.city}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
            color:'white', borderRadius:'8px', padding:'8px 16px', cursor:'pointer', fontSize:'13px' }}>
            خروج
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:'4px', overflowX:'auto', paddingBottom:'0' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ padding:'10px 16px', border:'none', cursor:'pointer', fontSize:'13px',
                fontFamily:"'Cairo',sans-serif", whiteSpace:'nowrap', fontWeight:'500',
                background: activeTab === t.id ? 'white' : 'transparent',
                color: activeTab === t.id ? '#C1272D' : 'rgba(255,255,255,0.85)',
                borderRadius:'8px 8px 0 0' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:'900px', margin:'24px auto', padding:'0 16px' }}>

        {/* نظرة عامة */}
        {activeTab === 'overview' && (
          <div>
            {/* Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'14px', marginBottom:'20px' }}>
              {[
                { icon:'📦', label:'المنتجات', value: stats.totalProducts },
                { icon:'👁️', label:'المشاهدات', value: stats.totalViews },
                { icon:'⭐', label:'التقييم', value: stats.avgRating > 0 ? `${stats.avgRating}/5` : 'لا يوجد' },
              ].map((s,i) => (
                <div key={i} style={{ background:'white', borderRadius:'12px', padding:'18px',
                  textAlign:'center', boxShadow:'0 2px 8px rgba(0,0,0,0.07)', direction:'rtl' }}>
                  <div style={{ fontSize:'28px', marginBottom:'4px' }}>{s.icon}</div>
                  <div style={{ fontSize:'22px', fontWeight:'700', color:'#C1272D' }}>{s.value}</div>
                  <div style={{ fontSize:'12px', color:'#888' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* بطاقة المورد */}
            <div style={{ background:'white', borderRadius:'16px', padding:'20px 24px',
              boxShadow:'0 2px 8px rgba(0,0,0,0.07)', direction:'rtl', marginBottom:'16px' }}>
              <h3 style={{ margin:'0 0 14px', fontSize:'15px', color:'#1a1a1a' }}>معلومات المتجر</h3>
              <div style={{ display:'grid', gap:'10px', fontSize:'14px', color:'#444' }}>
                <div>📱 <strong>واتساب:</strong> {supplier.phone}</div>
                <div>📧 <strong>الإيميل:</strong> {supplier.email}</div>
                <div>📍 <strong>المدينة:</strong> {supplier.city}</div>
                {supplier.description && <div>📝 <strong>الوصف:</strong> {supplier.description}</div>}
              </div>
              <a href={`https://wa.me/${supplier.phone}`} target="_blank" rel="noreferrer"
                style={{ display:'inline-block', marginTop:'14px', padding:'9px 20px',
                  background:'#25D366', color:'white', borderRadius:'8px',
                  textDecoration:'none', fontSize:'13px', fontWeight:'600' }}>
                💬 فتح واتساب
              </a>
            </div>

            {/* آخر المنتجات */}
            <div style={{ background:'white', borderRadius:'16px', padding:'20px 24px',
              boxShadow:'0 2px 8px rgba(0,0,0,0.07)', direction:'rtl' }}>
              <h3 style={{ margin:'0 0 14px', fontSize:'15px', color:'#1a1a1a' }}>آخر المنتجات</h3>
              {products.slice(0,3).map(p => (
                <div key={p._id} style={{ display:'flex', justifyContent:'space-between',
                  padding:'10px 0', borderBottom:'1px solid #f5f5f5' }}>
                  <div>
                    <div style={{ fontWeight:'600', fontSize:'14px' }}>{p.name}</div>
                    <div style={{ fontSize:'12px', color:'#888' }}>{p.category} — 👁️ {p.views} مشاهدة</div>
                  </div>
                  <div style={{ fontSize:'16px', fontWeight:'700', color:'#E85D24' }}>{p.price} درهم</div>
                </div>
              ))}
              {products.length === 0 && <div style={{ color:'#888', fontSize:'13px' }}>ما زال ما ضفتيش منتجات</div>}
            </div>
          </div>
        )}

        {/* منتجاتي */}
        {activeTab === 'products' && (
          <div style={{ background:'white', borderRadius:'16px', padding:'24px',
            boxShadow:'0 2px 8px rgba(0,0,0,0.07)' }}>
            <h2 style={{ margin:'0 0 16px', fontSize:'16px', direction:'rtl' }}>📦 منتجاتي ({products.length})</h2>
            {products.length === 0
              ? <div style={{ textAlign:'center', padding:'40px', color:'#888' }}>ما زال ما ضفتيش منتجات</div>
              : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:'14px' }}>
                  {products.map(p => (
                    <div key={p._id} style={{ border:'1px solid #eee', borderRadius:'12px', padding:'14px', direction:'rtl' }}>
                      {p.imageUrl && <img src={p.imageUrl} alt={p.name}
                        style={{ width:'100%', height:'120px', objectFit:'cover', borderRadius:'8px', marginBottom:'8px' }} />}
                      <div style={{ fontSize:'11px', color:'#1D9E75', background:'#E1F5EE',
                        padding:'2px 8px', borderRadius:'20px', display:'inline-block', marginBottom:'6px' }}>{p.category}</div>
                      <div style={{ fontWeight:'600', fontSize:'14px', marginBottom:'4px' }}>{p.name}</div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:'16px', fontWeight:'700', color:'#E85D24' }}>{p.price} درهم</span>
                        <span style={{ fontSize:'11px', color:'#888' }}>👁️ {p.views}</span>
                      </div>
                      <button onClick={() => deleteProduct(p._id)}
                        style={{ width:'100%', marginTop:'10px', padding:'6px', background:'#FAECE7',
                          color:'#993C1D', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'12px' }}>
                        🗑️ حذف
                      </button>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}

        {/* إضافة منتج */}
        {activeTab === 'add' && (
          <div style={{ background:'white', borderRadius:'16px', padding:'24px',
            boxShadow:'0 2px 8px rgba(0,0,0,0.07)' }}>
            <h2 style={{ margin:'0 0 16px', fontSize:'16px', direction:'rtl', textAlign:'right' }}>➕ إضافة منتج جديد</h2>

            <label style={{ display:'block', marginBottom:'12px', cursor:'pointer' }}>
              <div style={{ border:'2px dashed #ddd', borderRadius:'12px', padding:'20px',
                textAlign:'center', background: preview ? 'transparent' : '#fafafa' }}>
                {preview
                  ? <img src={preview} alt="preview"
                      style={{ width:'100%', maxHeight:'200px', objectFit:'cover', borderRadius:'8px' }} />
                  : <div><div style={{ fontSize:'32px', marginBottom:'8px' }}>📸</div>
                      <div style={{ fontSize:'13px', color:'#888' }}>ارفع صورة المنتج</div></div>
                }
              </div>
              <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display:'none' }} />
            </label>

            <button onClick={() => setShowImagePicker(true)}
              style={{ width:'100%', padding:'11px', background:'#E6F1FB', color:'#185FA5',
                border:'none', borderRadius:'10px', fontSize:'14px', fontWeight:'600',
                cursor:'pointer', marginBottom:'12px', fontFamily:"'Cairo',sans-serif" }}>
              🔍 ابحث عن صور احترافية من الويب
            </button>

            {inp('اسم المنتج *', 'name')}
            <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}
              style={{ width:'100%', padding:'10px 14px', borderRadius:'8px', border:'1px solid #ddd',
                fontSize:'14px', direction:'rtl', outline:'none', marginBottom:'10px', background:'white',
                fontFamily:"'Cairo',sans-serif" }}>
              <option value="">اختار الفئة *</option>
              {['أحذية','ملابس','إكسسوارات','إلكترونيات','أغذية','أخرى'].map(c =>
                <option key={c} value={c}>{c}</option>)}
            </select>
            {inp('الثمن بالدرهم *', 'price', 'number')}

            {preview && (
              <button onClick={enhanceWithAI} disabled={imgLoading}
                style={{ width:'100%', padding:'11px', background:'#185FA5', color:'white',
                  border:'none', borderRadius:'10px', fontSize:'14px', fontWeight:'600',
                  cursor:'pointer', marginBottom:'10px', fontFamily:"'Cairo',sans-serif" }}>
                {imgLoading ? '⏳ AI كيحلل...' : '🤖 حسّن بالـ AI'}
              </button>
            )}

            {aiResult?.aiData && (
              <div style={{ background:'#E6F1FB', borderRadius:'10px', padding:'14px',
                marginBottom:'12px', direction:'rtl', fontSize:'13px' }}>
                <div style={{ fontWeight:'600', color:'#185FA5', marginBottom:'6px' }}>🤖 اقتراحات AI:</div>
                <div>📝 {aiResult.aiData.description}</div>
                <div>💰 السعر المقترح: {aiResult.aiData.suggestedPrice}</div>
                <div>💡 {aiResult.aiData.tips}</div>
              </div>
            )}

            {form.name && (
              <button onClick={() => setShowImagePicker(true)}
                style={{ width:'100%', padding:'11px', background:'#1D9E75', color:'white',
                  border:'none', borderRadius:'10px', fontSize:'14px', fontWeight:'600',
                  cursor:'pointer', marginBottom:'10px', fontFamily:"'Cairo',sans-serif" }}>
                🖼️ ابحث على صور احترافية من الويب
              </button>
            )}

            {msg && (
              <div style={{ padding:'10px 14px', borderRadius:'8px', marginBottom:'10px',
                background: msg.includes('✅') ? '#E1F5EE' : '#FAECE7',
                color: msg.includes('✅') ? '#0F6E56' : '#993C1D', fontSize:'13px', direction:'rtl' }}>
                {msg}
              </div>
            )}

            <button onClick={addProduct} disabled={loading}
              style={{ width:'100%', padding:'12px', background:'#C1272D', color:'white',
                border:'none', borderRadius:'10px', fontSize:'15px', fontWeight:'700',
                cursor:'pointer', fontFamily:"'Cairo',sans-serif" }}>
              {loading ? 'جاري الإضافة...' : 'أضف المنتج 🚀'}
            </button>
          </div>
        )}

        {/* التقييمات */}
        {activeTab === 'reviews' && (
          <div style={{ background:'white', borderRadius:'16px', padding:'24px',
            boxShadow:'0 2px 8px rgba(0,0,0,0.07)', direction:'rtl' }}>
            <h2 style={{ margin:'0 0 16px', fontSize:'16px' }}>⭐ تقييمات التجار ({reviews.length})</h2>
            {reviews.length === 0
              ? <div style={{ textAlign:'center', padding:'40px', color:'#888' }}>ما زال ما كاين تقييمات</div>
              : reviews.map((r,i) => (
                <div key={i} style={{ padding:'14px 0', borderBottom:'1px solid #f5f5f5' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                    <div style={{ color:'#EF9F27', fontSize:'16px' }}>{'★'.repeat(r.stars)}{'☆'.repeat(5-r.stars)}</div>
                    <div style={{ fontSize:'11px', color:'#aaa' }}>{new Date(r.date).toLocaleDateString('ar-MA')}</div>
                  </div>
                  {r.comment && <div style={{ fontSize:'13px', color:'#444', lineHeight:'1.6' }}>{r.comment}</div>}
                </div>
              ))
            }
          </div>
        )}

        {/* تحليل السوق */}
        {activeTab === 'market' && (
          <MarketAnalysis supplier={supplier} products={products} />
        )}

      </div>

      {showImagePicker && (
        <ImagePicker
          productName={form.name}
          category={form.category || 'product'}
          onSelect={handleImageSelect}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  )
}

function MarketAnalysis({ supplier, products }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading]   = useState(false)

  async function getAnalysis() {
    setLoading(true)
    try {
      const res  = await fetch(`${API}/ai-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `تحليل سوق ${products.map(p=>p.category).join(' ')} في ${supplier.city}`,
          city: supplier.city,
          category: ''
        })
      })
      const data = await res.json()
      setAnalysis(data)
    } catch { setAnalysis({ message: 'خطأ في التحليل' }) }
    setLoading(false)
  }

  return (
    <div style={{ background:'white', borderRadius:'16px', padding:'24px',
      boxShadow:'0 2px 8px rgba(0,0,0,0.07)', direction:'rtl' }}>
      <h2 style={{ margin:'0 0 8px', fontSize:'16px' }}>📈 تحليل السوق الذكي</h2>
      <p style={{ fontSize:'13px', color:'#888', margin:'0 0 16px' }}>
        AI يحلل السوق ويعطيك توصيات مخصصة لمتجرك
      </p>

      {/* إحصائيات المنتجات */}
      <div style={{ marginBottom:'20px' }}>
        <h3 style={{ fontSize:'14px', color:'#333', marginBottom:'10px' }}>أداء منتجاتك:</h3>
        {products.length === 0
          ? <div style={{ color:'#888', fontSize:'13px' }}>ما زال ما ضفتيش منتجات للتحليل</div>
          : products.sort((a,b) => (b.views||0)-(a.views||0)).map(p => (
            <div key={p._id} style={{ display:'flex', justifyContent:'space-between',
              alignItems:'center', padding:'8px 0', borderBottom:'1px solid #f5f5f5' }}>
              <div>
                <div style={{ fontSize:'13px', fontWeight:'600' }}>{p.name}</div>
                <div style={{ fontSize:'11px', color:'#888' }}>{p.category}</div>
              </div>
              <div style={{ textAlign:'left' }}>
                <div style={{ fontSize:'13px', color:'#E85D24', fontWeight:'600' }}>{p.price} درهم</div>
                <div style={{ fontSize:'11px', color:'#888' }}>👁️ {p.views || 0} مشاهدة</div>
              </div>
            </div>
          ))
        }
      </div>

      <button onClick={getAnalysis} disabled={loading}
        style={{ width:'100%', padding:'12px', background:'linear-gradient(135deg,#185FA5,#0C447C)',
          color:'white', border:'none', borderRadius:'10px', fontSize:'14px',
          fontWeight:'700', cursor:'pointer', fontFamily:"'Cairo',sans-serif", marginBottom:'16px' }}>
        {loading ? '⏳ AI كيحلل السوق...' : '🤖 احصل على تحليل ذكي'}
      </button>

      {analysis?.message && (
        <div style={{ background:'#E6F1FB', borderRadius:'12px', padding:'16px', fontSize:'13px', lineHeight:'1.8' }}>
          <div style={{ fontWeight:'600', color:'#185FA5', marginBottom:'8px' }}>🤖 توصيات AI:</div>
          <div>{analysis.message}</div>
          {analysis.suggestions?.length > 0 && (
            <div style={{ marginTop:'10px' }}>
              <div style={{ fontWeight:'600', marginBottom:'6px' }}>💡 اقتراحات:</div>
              {analysis.suggestions.map((s,i) => (
                <div key={i} style={{ padding:'4px 0', color:'#333' }}>• {s}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LoginPage({ onLogin, onBack }) {
  const [form, setForm] = useState({ email:'', password:'' })
  const [msg, setMsg] = useState('')

  async function handleLogin() {
    const res = await fetch('http://localhost:5000/api/suppliers/login', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(form)
    })
    const data = await res.json()
    if (res.ok) onLogin(data.supplier)
    else setMsg(data.message)
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', fontFamily:"'Cairo', sans-serif" }}>
      <div style={{ background:'#C1272D', padding:'14px 24px', display:'flex', alignItems:'center', gap:'12px' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'white', fontSize:'20px', cursor:'pointer' }}></button>
        <span style={{ color:'white', fontSize:'18px', fontWeight:'700' }}>دخول المورد</span>
      </div>
      <div style={{ maxWidth:'400px', margin:'60px auto', padding:'0 16px' }}>
        <div style={{ background:'white', borderRadius:'16px', padding:'28px', boxShadow:'0 2px 12px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin:'0 0 20px', textAlign:'right', direction:'rtl' }}>مرحبا بك </h2>
          {['email','password'].map(key => (
            <input key={key} type={key} placeholder={key === 'email' ? 'الإيميل' : 'كلمة المرور'} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={{ width:'100%', padding:'11px 14px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'14px', direction:'rtl', outline:'none', boxSizing:'border-box', marginBottom:'10px' }} />
          ))}
          {msg && <div style={{ color:'#993C1D', fontSize:'13px', direction:'rtl', marginBottom:'10px' }}>{msg}</div>}
          <button onClick={handleLogin} style={{ width:'100%', padding:'12px', background:'#C1272D', color:'white', border:'none', borderRadius:'10px', fontSize:'15px', fontWeight:'700', cursor:'pointer' }}>
            دخول
          </button>
        </div>
      </div>
    </div>
  )
}

function StarRating({ value, onChange, readOnly }) {
  return (
    <div style={{ display:'flex', gap:'4px', direction:'ltr' }}>
      {[1,2,3,4,5].map(star => (
        <span key={star}
          onClick={() => !readOnly && onChange && onChange(star)}
          style={{ fontSize:'22px', cursor: readOnly ? 'default' : 'pointer',
            color: star <= value ? '#EF9F27' : '#ddd',
            transition:'color 0.1s' }}>
          ★
        </span>
      ))}
    </div>
  )
}

function ReviewSection({ supplierId }) {
  const [reviews, setReviews] = useState([])
  const [avg, setAvg]         = useState(0)
  const [total, setTotal]     = useState(0)
  const [stars, setStars]     = useState(0)
  const [comment, setComment] = useState('')
  const [msg, setMsg]         = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchReviews() }, [supplierId])

  async function fetchReviews() {
    const data = await fetch(`${API}/reviews/${supplierId}`).then(r => r.json())
    setReviews(Array.isArray(data.reviews) ? data.reviews : [])
    setAvg(data.avg || 0)
    setTotal(data.total || 0)
  }

  async function submitReview() {
    if (!stars) return setMsg('⚠️ اختار عدد النجوم')
    setLoading(true)
    const res = await fetch(`${API}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplierId, stars, comment })
    })
    const data = await res.json()
    setLoading(false)
    setMsg(data.message)
    setStars(0)
    setComment('')
    fetchReviews()
  }

  return (
    <div style={{ marginTop:'24px', direction:'rtl' }}>

      {/* ملخص التقييم */}
      <div style={{ background:'white', borderRadius:'16px', padding:'20px 24px',
        marginBottom:'16px', boxShadow:'0 2px 8px rgba(0,0,0,0.07)' }}>
        <h3 style={{ margin:'0 0 12px', fontSize:'15px', color:'#1a1a1a' }}>
          ⭐ تقييمات التجار
        </h3>
        {total > 0 ? (
          <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:'36px', fontWeight:'700', color:'#EF9F27' }}>{avg}</div>
              <StarRating value={Math.round(avg)} readOnly />
              <div style={{ fontSize:'12px', color:'#888', marginTop:'4px' }}>
                {total} تقييم
              </div>
            </div>
            <div style={{ flex:1 }}>
              {[5,4,3,2,1].map(s => {
                const count = reviews.filter(r => r.stars === s).length
                const pct   = total > 0 ? (count / total) * 100 : 0
                return (
                  <div key={s} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
                    <span style={{ fontSize:'12px', color:'#888', minWidth:'16px' }}>{s}</span>
                    <span style={{ fontSize:'12px', color:'#EF9F27' }}>★</span>
                    <div style={{ flex:1, background:'#f0f0f0', borderRadius:'4px', height:'8px' }}>
                      <div style={{ width:`${pct}%`, background:'#EF9F27',
                        borderRadius:'4px', height:'100%', transition:'width 0.3s' }} />
                    </div>
                    <span style={{ fontSize:'12px', color:'#888', minWidth:'20px' }}>{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{ color:'#888', fontSize:'13px' }}>ما زال ما كاين تقييمات — كن الأول!</div>
        )}
      </div>

      {/* إضافة تقييم */}
      <div style={{ background:'white', borderRadius:'16px', padding:'20px 24px',
        marginBottom:'16px', boxShadow:'0 2px 8px rgba(0,0,0,0.07)' }}>
        <h3 style={{ margin:'0 0 12px', fontSize:'15px', color:'#1a1a1a' }}>
          قيم هاد المورد
        </h3>
        <div style={{ marginBottom:'10px' }}>
          <StarRating value={stars} onChange={setStars} />
        </div>
        <textarea value={comment} onChange={e => setComment(e.target.value)}
          placeholder="شارك تجربتك مع هاد المورد..."
          style={{ width:'100%', padding:'10px 14px', borderRadius:'8px',
            border:'1px solid #ddd', fontSize:'14px', direction:'rtl',
            outline:'none', resize:'vertical', minHeight:'80px',
            boxSizing:'border-box', fontFamily:"'Cairo',sans-serif" }} />
        {msg && (
          <div style={{ padding:'8px 12px', borderRadius:'8px', margin:'8px 0',
            background: msg.includes('✅') ? '#E1F5EE' : '#FAECE7',
            color: msg.includes('✅') ? '#0F6E56' : '#993C1D', fontSize:'13px' }}>
            {msg}
          </div>
        )}
        <button onClick={submitReview} disabled={loading}
          style={{ marginTop:'10px', padding:'10px 24px', background:'#C1272D',
            color:'white', border:'none', borderRadius:'8px',
            cursor:'pointer', fontSize:'14px', fontWeight:'600' }}>
          {loading ? 'جاري الإرسال...' : 'أرسل تقييمي ⭐'}
        </button>
      </div>

      {/* قائمة التقييمات */}
      {reviews.map((r, i) => (
        <div key={i} style={{ background:'white', borderRadius:'12px', padding:'16px 20px',
          marginBottom:'10px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
            <StarRating value={r.stars} readOnly />
            <span style={{ fontSize:'11px', color:'#aaa' }}>
              {new Date(r.date).toLocaleDateString('ar-MA')}
            </span>
          </div>
          {r.comment && (
            <p style={{ margin:'0', fontSize:'13px', color:'#444', lineHeight:'1.6' }}>
              {r.comment}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

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
  const [filterCity, setFilterCity] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPrice, setFilterPrice] = useState('')
  const [aiMessage, setAiMessage] = useState('')
  const [trending, setTrending] = useState([])
  const [visited, setVisited] = useState(() => {
    const saved = localStorage.getItem('visited')
    return saved ? JSON.parse(saved) : []
  })

  useEffect(() => {
    fetchAll()
    fetchTrending()
  }, [])

  async function fetchAll() {
    const res = await fetch(`${API}/products`)
    const data = await res.json()
    setProducts(Array.isArray(data) ? data : data.data || [])
  }

  // تسجيل مشاهدة منتج
  async function trackView(productId) {
    await fetch(`${API}/tracking/view/${productId}`, { method: 'POST' })
    const newVisited = [productId, ...visited.filter(id => id !== productId)].slice(0, 10)
    setVisited(newVisited)
    localStorage.setItem('visited', JSON.stringify(newVisited))
  }

  // جيب الترند عند التحميل
  async function fetchTrending() {
    const data = await fetch(`${API}/tracking/trending`).then(r => r.json())
    setTrending(Array.isArray(data) ? data : data.data || [])
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
      if (filterPrice === 'asc')  results = [...results].sort((a,b) => a.price - b.price)
      if (filterPrice === 'desc') results = [...results].sort((a,b) => b.price - a.price)

      setProducts(results)

      // اقتراحات AI
      if (data.suggestions?.length > 0) setSuggestions(data.suggestions)

      // رسالة AI
      if (data.message) setAiMessage(data.message)

    } catch (err) {
      // fallback للبحث العادي
      const url = q ? `${API}/products/search?q=${q}` : `${API}/products`
      const data = await fetch(url).then(r => r.json())
      setProducts(data)
    }

    setLoading(false)
  }

  async function handleInput(val) {
    setQuery(val)
    if (debounceTimer) clearTimeout(debounceTimer)
    if (val.length < 2) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(async () => {
      const data = await fetch(`${API}/products/search?q=${val}`).then(r => r.json())
      const arr = Array.isArray(data) ? data : data.data || []
      setSuggestions(arr.slice(0,3).map(p => p.name))
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
    const res = await fetch(`${API}/image-search`, { method:'POST', body: formData })
    const data = await res.json()
    setImageLoading(false)
    setProducts(Array.isArray(data.products) ? data.products : [])
    setImageMsg(data.message)
  }

  if (page === 'register') return <RegisterPage onBack={() => setPage('home')} />
  if (supplier) return <SupplierDashboard supplier={supplier} onLogout={() => setSupplier(null)} />
  if (page === 'login') return <LoginPage onLogin={(s) => { setSupplier(s); setPage('home') }} onBack={() => setPage('home')} />
  if (selectedSupplier) return <SupplierPage supplierId={selectedSupplier} onBack={() => setSelectedSupplier(null)} />

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', fontFamily:"'Cairo', sans-serif" }}>
      <div style={{ background:'#C1272D', padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ color:'white', fontSize:'20px', fontWeight:'700' }}> Jomla.ma</span>
        <div>
          <button onClick={() => setPage('login')} style={{ background:'transparent', color:'white', border:'1px solid white', borderRadius:'8px', padding:'7px 14px', fontSize:'13px', fontWeight:'600', cursor:'pointer', marginLeft:'8px' }}>
            دخول المورد
          </button>
          <button onClick={() => setPage('register')} style={{ background:'white', color:'#C1272D', border:'none', borderRadius:'8px', padding:'7px 14px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
            سجل كمورد
          </button>
        </div>
      </div>
      <div style={{ background:'linear-gradient(135deg,#C1272D,#8B1A1F)', padding:'40px 24px', textAlign:'center' }}>
        <h1 style={{ color:'white', margin:'0 0 8px', fontSize:'26px' }}>
          قلب على أي منتج بالجملة
        </h1>
        <p style={{ color:'rgba(255,255,255,0.8)', margin:'0 0 20px', fontSize:'14px' }}>
          تواصل مع الموردين مباشرة
        </p>
        <div style={{ position:'relative', maxWidth:'500px', margin:'0 auto' }}>
          <div style={{ display:'flex', gap:'8px' }}>
            <input value={query} onChange={e => handleInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="ابحث: صباط، قميص، نظارات..." style={{ flex:1, padding:'12px 16px', borderRadius:'8px', border:'none', fontSize:'15px', direction:'rtl', outline:'none' }} />
            <button onClick={handleSearch} style={{ padding:'12px 20px', background:'#E85D24', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'15px' }}>
              بحث
            </button>
            <label style={{ padding:'12px 16px', background:'rgba(255,255,255,0.2)',
              color:'white', borderRadius:'8px', cursor:'pointer', fontSize:'15px',
              display:'flex', alignItems:'center', gap:'6px', whiteSpace:'nowrap' }}>
              {imageLoading ? '⏳' : '📸'}
              <input type="file" accept="image/*" onChange={handleImageSearch} style={{ display:'none' }} />
            </label>
          </div>
          {suggestions.length > 0 && (
            <div style={{ position:'absolute', top:'100%', right:'0', left:'48px', background:'white', borderRadius:'8px', marginTop:'4px', boxShadow:'0 4px 12px rgba(0,0,0,0.15)', zIndex:10 }}>
              {suggestions.map((s,i) => (
                <div key={i} onClick={() => { setQuery(s); setSuggestions([]); handleSearch() }} style={{ padding:'10px 16px', cursor:'pointer', direction:'rtl', fontSize:'14px', borderBottom:'1px solid #f0f0f0' }}>
                  {s}
                </div>
              ))}
            </div>
          )}
          {imageMsg && (
            <div style={{ background:'#E1F5EE', padding:'10px 24px', textAlign:'center', fontSize:'13px', color:'#0F6E56', direction:'rtl', marginTop:'14px' }}>
              🔍 {imageMsg}
            </div>
          )}
          {suggestions.length > 0 && !query && (
            <div style={{ background:'white', borderBottom:'1px solid #eee',
              padding:'12px 24px', marginTop:'14px', direction:'rtl' }}>
              <span style={{ fontSize:'13px', color:'#888', marginLeft:'12px' }}>
                🤖 قد يعجبك:
              </span>
              {suggestions.map((s,i) => (
                <button key={i} onClick={() => { setQuery(s); handleSearch(s) }}
                  style={{ margin:'4px', padding:'6px 14px', borderRadius:'20px',
                    background:'#E6F1FB', color:'#185FA5', border:'none',
                    cursor:'pointer', fontSize:'13px' }}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {aiMessage && (
            <div style={{ background:'#E6F1FB', padding:'10px 24px', textAlign:'center', fontSize:'13px', color:'#185FA5', direction:'rtl', marginTop:'10px', borderRadius:'8px' }}>
              💡 {aiMessage}
            </div>
          )}
        </div>
      </div>
      {!query && trending.length > 0 && (
        <div style={{ maxWidth:'1100px', margin:'16px auto 0', padding:'0 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px',
            marginBottom:'12px', direction:'rtl' }}>
            <span style={{ fontSize:'18px' }}>🔥</span>
            <h2 style={{ margin:'0', fontSize:'15px', color:'#333' }}>الأكثر طلباً دابا</h2>
          </div>
          <div style={{ display:'flex', gap:'10px', overflowX:'auto', paddingBottom:'8px' }}>
            {trending.map(p => (
              <div key={p._id} onClick={() => { trackView(p._id); setSelectedSupplier(p.supplierId) }}
                style={{ minWidth:'140px', background:'white', borderRadius:'10px',
                  padding:'12px', boxShadow:'0 2px 6px rgba(0,0,0,0.07)',
                  cursor:'pointer', border:'1px solid #eee', direction:'rtl', flexShrink:0 }}>
                <div style={{ fontSize:'10px', color:'#1D9E75', background:'#E1F5EE',
                  padding:'2px 6px', borderRadius:'20px', display:'inline-block', marginBottom:'6px' }}>
                  {p.category}
                </div>
                <div style={{ fontSize:'13px', fontWeight:'600', color:'#1a1a1a', marginBottom:'4px' }}>
                  {p.name}
                </div>
                <div style={{ fontSize:'15px', fontWeight:'700', color:'#E85D24' }}>
                  {p.price} درهم
                </div>
                <div style={{ fontSize:'11px', color:'#888', marginTop:'2px' }}>
                  👁️ {p.views} مشاهدة
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!query && visited.length > 0 && (
        <div style={{ maxWidth:'1100px', margin:'8px auto 0', padding:'0 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px',
            marginBottom:'8px', direction:'rtl' }}>
            <span style={{ fontSize:'16px' }}>🕐</span>
            <h2 style={{ margin:'0', fontSize:'14px', color:'#888' }}>شفتيه من قبل</h2>
          </div>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            {(Array.isArray(products) ? products : []).filter(p => visited.includes(p._id)).slice(0,4).map(p => (
              <div key={p._id} onClick={() => { trackView(p._id); setSelectedSupplier(p.supplierId) }}
                style={{ padding:'6px 14px', background:'#f0f0f0', borderRadius:'20px',
                  cursor:'pointer', fontSize:'13px', color:'#333' }}>
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ maxWidth:'1100px', margin:'0 auto', padding:'24px 16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px', direction:'rtl' }}>
          <h2 style={{ margin:'0', fontSize:'16px', color:'#333' }}>
            {loading ? 'جاري البحث...' : `${products.length} منتج`}
          </h2>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'16px' }}>
          {products.map(p => <ProductCard key={p._id} product={p} onViewSupplier={setSelectedSupplier} onView={trackView} />)}
        </div>
        {products.length === 0 && !loading && (
          <div style={{ textAlign:'center', padding:'40px', color:'#888' }}>
            ما كاين والو جرب كلمة أخرى
          </div>
        )}
      </div>
    </div>
  )
}
