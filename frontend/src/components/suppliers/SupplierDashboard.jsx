import { useState, useEffect, useCallback } from 'react'
import ImagePicker from '../common/ImagePicker'
import MarketAnalysis from './MarketAnalysis'
import { API } from '../../api/config'

export default function SupplierDashboard({ supplier, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [rfqs, setRfqs] = useState([])
  const [rfqCounts, setRfqCounts] = useState({ total: 0, pending: 0, responded: 0 })
  const [selectedRfq, setSelectedRfq] = useState(null)
  const [rfqReply, setRfqReply] = useState({ unitPrice: '', deliveryDays: 3, notes: '' })
  const [stats, setStats] = useState({ totalViews: 0, totalProducts: 0, avgRating: 0 })
  const [form, setForm] = useState({
    name: '',
    category: '',
    price: '',
    moq: 10,
    unit: 'قطعة',
    city: supplier.city || ''
  })
  const [priceTiers, setPriceTiers] = useState([])
  const [tierInput, setTierInput] = useState({ minQty: '', maxQty: '', price: '' })
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

  const fetchMyRfqs = useCallback(async () => {
    const token = localStorage.getItem('supplierToken')
    try {
      const res = await fetch(`${API}/rfq/supplier`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      })
      const data = await res.json()
      if (data.data) {
        setRfqs(data.data)
        setRfqCounts(data.counts || { total: 0, pending: 0, responded: 0 })
      }
    } catch {
      setRfqs([])
    }
  }, [])

  useEffect(() => {
    fetchMyProducts()
    fetchMyReviews()
    fetchMyRfqs()
  }, [fetchMyProducts, fetchMyReviews, fetchMyRfqs])

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
        setForm(prev => ({
          ...prev,
          name: data.aiData.title || prev.name,
          imageUrl: data.enhancedImage,
          price: data.aiData.suggestedPrice || prev.price,
          moq: data.aiData.suggestedMoq || prev.moq,
          unit: data.aiData.suggestedUnit || prev.unit
        }))
        if (Array.isArray(data.aiData.suggestedPriceTiers) && data.aiData.suggestedPriceTiers.length > 0) {
          setPriceTiers(data.aiData.suggestedPriceTiers)
        }
        setMsg('✅ AI حسّن المنتج واقترح تسعير الجملة والحد الأدنى للطلب!')
      }
    } catch {
      setMsg('⚠️ خطأ في AI')
    } finally {
      setImgLoading(false)
    }
  }

  function addPriceTier() {
    if (!tierInput.minQty || !tierInput.price) {
      return setMsg('⚠️ أدخل أقل كمية والسعر للشريحة')
    }
    const newTier = {
      minQty: Number(tierInput.minQty),
      maxQty: tierInput.maxQty ? Number(tierInput.maxQty) : null,
      price: Number(tierInput.price)
    }
    setPriceTiers([...priceTiers, newTier])
    setTierInput({ minQty: '', maxQty: '', price: '' })
  }

  function removePriceTier(idx) {
    setPriceTiers(priceTiers.filter((_, i) => i !== idx))
  }

  async function addProduct() {
    if (!form.name || !form.price || !form.category) return setMsg('⚠️ كمل جميع الخانات المطلوبة')
    setLoading(true)
    const token = localStorage.getItem('supplierToken')
    try {
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          moq: Number(form.moq) || 1,
          unit: form.unit || 'قطعة',
          priceTiers: priceTiers.filter(t => t.minQty && t.price),
          supplierId: supplier._id,
          supplierPhone: supplier.phone || '',
          description: aiResult?.aiData?.description || form.description || '',
          imageUrl: aiResult?.enhancedImage || form.imageUrl || ''
        })
      })
      const data = await res.json()
      setMsg(data.message)
      setForm({ name: '', category: '', price: '', moq: 10, unit: 'قطعة', city: supplier.city || '' })
      setPriceTiers([])
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
    const token = localStorage.getItem('supplierToken')
    try {
      await fetch(`${API}/products/${id}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      })
      fetchMyProducts()
    } catch {
      setMsg('❌ تعذر حذف المنتج')
    }
  }

  async function respondToRfq(rfqId, status = 'responded') {
    const token = localStorage.getItem('supplierToken')
    try {
      const res = await fetch(`${API}/rfq/${rfqId}/respond`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          unitPrice: Number(rfqReply.unitPrice),
          deliveryDays: Number(rfqReply.deliveryDays) || 3,
          notes: rfqReply.notes,
          status
        })
      })
      const data = await res.json()
      setMsg(data.message)
      setSelectedRfq(null)
      setRfqReply({ unitPrice: '', deliveryDays: 3, notes: '' })
      fetchMyRfqs()
    } catch {
      setMsg('❌ تعذر إرسال الرد على طلب عرض السعر')
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
    { id: 'rfq',      label: `📑 طلبات الأسعار RFQ (${rfqCounts.pending || 0})` },
    { id: 'products', label: '📦 منتجاتي' },
    { id: 'add',      label: '➕ إضافة منتج جملة' },
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
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px' }}>📍 {supplier.city} | متجر جملة معتمد</div>
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
                fontWeight: '600',
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

      <div style={{ maxWidth: '960px', margin: '24px auto', padding: '0 16px' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
              {[
                { icon: '📦', label: 'المنتجات', value: stats.totalProducts },
                { icon: '📑', label: 'طلبات RFQ جديدة', value: rfqCounts.pending },
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
                  <div style={{ fontSize: '26px', marginBottom: '6px' }}>{s.icon}</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a' }}>{s.value}</div>
                  <div style={{ fontSize: '12px', color: '#888' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', direction: 'rtl' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '16px' }}>آخر طلبات عروض الأسعار (RFQ)</h3>
                <button
                  onClick={() => setActiveTab('rfq')}
                  style={{ background: 'none', border: 'none', color: '#0F766E', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                >
                  عرض الكل ({rfqCounts.total}) ←
                </button>
              </div>
              {rfqs.length === 0 ? (
                <div style={{ color: '#888', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                  لا توجد طلبات عروض أسعار حتى الآن
                </div>
              ) : (
                rfqs.slice(0, 3).map(r => (
                  <div key={r._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #eee' }}>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '14px' }}>{r.productId?.name || 'منتج محذوف'}</div>
                      <div style={{ fontSize: '12px', color: '#666' }}>المشتري: {r.buyerName} ({r.quantity} {r.productId?.unit || 'قطعة'})</div>
                    </div>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '11px',
                        fontWeight: '600',
                        background: r.status === 'pending' ? '#FEF3C7' : '#E1F5EE',
                        color: r.status === 'pending' ? '#B45309' : '#0F766E'
                      }}
                    >
                      {r.status === 'pending' ? 'قيد المراجعة' : 'تم الرد'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* RFQ Management Tab (B2B Request For Quotation) */}
        {activeTab === 'rfq' && (
          <div style={{ direction: 'rtl' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>طلبات عروض الأسعار الرسمية (RFQ)</h2>
              <span style={{ fontSize: '13px', color: '#64748B' }}>
                المجموع: {rfqs.length} طلب | {rfqCounts.pending} بانتظار ردك
              </span>
            </div>

            {rfqs.length === 0 ? (
              <div style={{ background: 'white', borderRadius: '16px', padding: '60px 20px', textAlign: 'center', color: '#888' }}>
                <div style={{ fontSize: '40px', marginBottom: '10px' }}>📭</div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#333' }}>لا توجد طلبات عروض أسعار حتى الآن</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>ستظهر هنا طلبات الشراء بالجملة التي يرسلها التجار لمنتجاتك</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {rfqs.map(r => {
                  const whatsappBuyer = `https://wa.me/${r.buyerPhone}?text=${encodeURIComponent(
                    `السلام عليكم أخي ${r.buyerName}، معكم متجر ${supplier.name} من منصة Jomla.ma بخصوص طلب عرض السعر رقم #${r._id.slice(-6)} لمنتج "${r.productId?.name}"...`
                  )}`

                  return (
                    <div
                      key={r._id}
                      style={{
                        background: 'white',
                        borderRadius: '14px',
                        padding: '20px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        border: '1px solid #E2E8F0'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          {r.productId?.imageUrl && (
                            <img src={r.productId.imageUrl} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px' }} />
                          )}
                          <div>
                            <div style={{ fontWeight: '700', fontSize: '15px' }}>{r.productId?.name}</div>
                            <div style={{ fontSize: '12px', color: '#64748B' }}>
                              رقم الطلب: #{r._id.slice(-6)} | {new Date(r.createdAt).toLocaleDateString('ar-MA')}
                            </div>
                          </div>
                        </div>

                        <span
                          style={{
                            padding: '4px 12px',
                            borderRadius: '20px',
                            fontSize: '12px',
                            fontWeight: '600',
                            background:
                              r.status === 'pending' ? '#FEF3C7' : r.status === 'responded' ? '#E1F5EE' : '#F1F5F9',
                            color:
                              r.status === 'pending' ? '#B45309' : r.status === 'responded' ? '#0F766E' : '#475569'
                          }}
                        >
                          {r.status === 'pending' ? '⏳ بانتظار عرضك' : r.status === 'responded' ? '✅ تم إرسال عرض السعر' : 'مرفوض'}
                        </span>
                      </div>

                      <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', fontSize: '13px' }}>
                        <div><strong>المشتري:</strong> {r.buyerName}</div>
                        <div><strong>الهاتف:</strong> {r.buyerPhone}</div>
                        <div><strong>مدينة التوصيل:</strong> {r.buyerCity || 'غير محددة'}</div>
                        <div><strong>الكمية المطلوبة:</strong> <span style={{ color: '#B45309', fontWeight: '700' }}>{r.quantity} {r.productId?.unit || 'قطعة'}</span></div>
                        {r.targetPrice && <div><strong>السعر المستهدف:</strong> {r.targetPrice} درهم / قطعة</div>}
                      </div>

                      {r.notes && (
                        <div style={{ fontSize: '13px', color: '#334155', marginBottom: '14px', background: '#FFFBEB', padding: '10px 14px', borderRadius: '8px', borderRight: '4px solid #F59E0B' }}>
                          <strong>ملاحظات المشتري:</strong> {r.notes}
                        </div>
                      )}

                      {/* إذا كان قد تم الرد مسبقاً */}
                      {r.status === 'responded' && r.offer && (
                        <div style={{ background: '#F0FDF4', padding: '12px 16px', borderRadius: '10px', border: '1px solid #BBF7D0', marginBottom: '12px', fontSize: '13px' }}>
                          <div style={{ fontWeight: '700', color: '#166534', marginBottom: '4px' }}>📋 عرض السعر الذي أرسلته للمشتري:</div>
                          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                            <div>سعر الوحدة: <strong>{r.offer.unitPrice} درهم</strong></div>
                            <div>المجموع الكلي: <strong>{r.offer.totalPrice} درهم</strong></div>
                            <div>مدة التجهيز والتوصيل: <strong>{r.offer.deliveryDays} أيام</strong></div>
                          </div>
                          {r.offer.notes && <div style={{ marginTop: '4px', color: '#15803D' }}>ملاحظاتك: {r.offer.notes}</div>}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <a
                          href={whatsappBuyer}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '9px 18px',
                            background: '#25D366',
                            color: 'white',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontSize: '13px',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          💬 محادثة المشتري عبر واتساب
                        </a>

                        {r.status === 'pending' && (
                          <button
                            onClick={() => {
                              setSelectedRfq(r)
                              setRfqReply({
                                unitPrice: r.targetPrice || r.productId?.price || '',
                                deliveryDays: 3,
                                notes: ''
                              })
                            }}
                            style={{
                              padding: '9px 18px',
                              background: '#0F766E',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: '600'
                            }}
                          >
                            ✍️ تقديم عرض السعر الرسمي
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div style={{ direction: 'rtl' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>قائمة منتجات الجملة ({products.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
              {products.map(p => (
                <div key={p._id} style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', marginBottom: '10px' }} />}
                  <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>{p.name}</h4>
                  <div style={{ color: '#E85D24', fontWeight: '700', fontSize: '16px', marginBottom: '4px' }}>
                    {p.price} درهم / {p.unit || 'قطعة'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#B45309', background: '#FEF3C7', padding: '2px 8px', borderRadius: '12px', display: 'inline-block', marginBottom: '8px' }}>
                    📦 أقل طلب (MOQ): {p.moq || 1} {p.unit || 'قطعة'}
                  </div>
                  {p.priceTiers && p.priceTiers.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#0F766E', marginBottom: '10px' }}>
                      🏷️ {p.priceTiers.length} شرائح أسعار حسب الكمية
                    </div>
                  )}
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

        {/* Add Product Tab (Wholesale Core) */}
        {activeTab === 'add' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', maxWidth: '580px', margin: '0 auto', boxShadow: '0 2px 12px rgba(0,0,0,0.07)', direction: 'rtl' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '18px' }}>إضافة منتج جملة جديد</h2>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 20px' }}>
              حدد السعر الأساسي، أقل كمية للطلب (MOQ)، وشرائح أسعار الكميات.
            </p>

            {inp('اسم المنتج *', 'name')}
            {inp('الفئة (ملابس، أحذية، إلكترونيات...) *', 'category')}
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>السعر الأساسي (درهم) *</label>
                {inp('السعر الأساسي *', 'price', 'number')}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>وحدة البيع</label>
                <select
                  value={form.unit}
                  onChange={e => setForm({ ...form, unit: e.target.value })}
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
                    fontFamily: "'Cairo', sans-serif",
                    background: 'white'
                  }}
                >
                  <option value="قطعة">قطعة</option>
                  <option value="درزينة (12 قطعة)">درزينة (12 قطعة)</option>
                  <option value="كرتونة">كرتونة</option>
                  <option value="طرد">طرد</option>
                  <option value="حزمة">حزمة</option>
                  <option value="كيلوغرام">كيلوغرام</option>
                  <option value="متر">متر</option>
                  <option value="أخرى">أخرى</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>الحد الأدنى للطلب (MOQ) *</label>
                {inp('أقل كمية للطلب', 'moq', 'number')}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>المدينة</label>
                {inp('المدينة', 'city')}
              </div>
            </div>

            {/* شرائح الأسعار (Tiered Pricing) */}
            <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', margin: '12px 0', border: '1px solid #E2E8F0' }}>
              <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '6px', color: '#1E293B' }}>
                🏷️ أسعار الجملة للكميات الكبيرة (Tiered Pricing)
              </div>
              <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 10px' }}>
                شجع المشترين على شراء كميات أكبر بتقديم تخفيض لكل شريحة.
              </p>

              {priceTiers.map((tier, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', padding: '8px 12px', borderRadius: '6px', marginBottom: '6px', border: '1px solid #eee' }}>
                  <span style={{ fontSize: '13px' }}>
                    من <strong>{tier.minQty}</strong> {tier.maxQty ? `إلى ${tier.maxQty}` : 'فما فوق'} {form.unit}: <strong>{tier.price} درهم</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => removePriceTier(idx)}
                    style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '14px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <input
                  type="number"
                  placeholder="من كمية"
                  value={tierInput.minQty}
                  onChange={e => setTierInput({ ...tierInput, minQty: e.target.value })}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl' }}
                />
                <input
                  type="number"
                  placeholder="إلى كمية (اختياري)"
                  value={tierInput.maxQty}
                  onChange={e => setTierInput({ ...tierInput, maxQty: e.target.value })}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl' }}
                />
                <input
                  type="number"
                  placeholder="السعر (درهم)"
                  value={tierInput.price}
                  onChange={e => setTierInput({ ...tierInput, price: e.target.value })}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl' }}
                />
                <button
                  type="button"
                  onClick={addPriceTier}
                  style={{ padding: '8px 14px', background: '#0F766E', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                >
                  + أضف
                </button>
              </div>
            </div>

            {/* صورة المنتج وتحسين AI */}
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
                    {imgLoading ? '⏳ AI كيحسن الصورة والتسعير...' : '✨ تحسين بالذكاء الاصطناعي واقتراح أسعار الجملة'}
                  </button>
                )}
              </div>
            )}

            <button
              onClick={addProduct}
              disabled={loading}
              style={{ width: '100%', padding: '12px', background: '#C1272D', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', marginTop: '14px' }}
            >
              {loading ? 'جاري الإضافة...' : 'نشر منتج الجملة الآن'}
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

      {/* RFQ Reply Modal for Supplier */}
      {selectedRfq && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              direction: 'rtl',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>✍️ تقديم عرض سعر لـ {selectedRfq.buyerName}</h3>
              <button onClick={() => setSelectedRfq(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: '#F8FAFC', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' }}>
              <div>المنتج: <strong>{selectedRfq.productId?.name}</strong></div>
              <div>الكمية المطلوبة: <strong>{selectedRfq.quantity} {selectedRfq.productId?.unit || 'قطعة'}</strong></div>
              {selectedRfq.targetPrice && <div>السعر المستهدف من المشتري: <strong>{selectedRfq.targetPrice} درهم</strong></div>}
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>سعر الوحدة المعروض (درهم) *</label>
              <input
                type="number"
                value={rfqReply.unitPrice}
                onChange={e => setRfqReply({ ...rfqReply, unitPrice: e.target.value })}
                placeholder="مثال: 45"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'rtl', boxSizing: 'border-box' }}
              />
              {rfqReply.unitPrice && (
                <div style={{ fontSize: '12px', color: '#0F766E', marginTop: '4px', fontWeight: '600' }}>
                  المجموع الكلي: {Number(rfqReply.unitPrice) * selectedRfq.quantity} درهم
                </div>
              )}
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>مدة التجهيز والتوصيل (بالأيام)</label>
              <input
                type="number"
                value={rfqReply.deliveryDays}
                onChange={e => setRfqReply({ ...rfqReply, deliveryDays: e.target.value })}
                placeholder="مثال: 3"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'rtl', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>شروط أو ملاحظات للمشتري</label>
              <textarea
                rows={3}
                value={rfqReply.notes}
                onChange={e => setRfqReply({ ...rfqReply, notes: e.target.value })}
                placeholder="مثال: التوصيل متوفر لكازا، الدفع عند الاستلام..."
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => respondToRfq(selectedRfq._id, 'responded')}
                style={{ flex: 2, padding: '11px', background: '#0F766E', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}
              >
                🚀 إرسال العرض للمشتري
              </button>
              <button
                type="button"
                onClick={() => respondToRfq(selectedRfq._id, 'rejected')}
                style={{ flex: 1, padding: '11px', background: '#FAECE7', color: '#993C1D', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}
              >
                رفض
              </button>
            </div>
          </div>
        </div>
      )}

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
