import { useState, useEffect, useCallback } from 'react'
import ImagePicker from '../common/ImagePicker'
import MarketAnalysis from './MarketAnalysis'
import { API } from '../../api/config'

export default function SupplierDashboard({ supplier, onLogout, onGoAdmin }) {
  const [profile, setProfile] = useState(supplier)
  const [activeTab, setActiveTab] = useState('overview')
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [rfqs, setRfqs] = useState([])
  const [rfqCounts, setRfqCounts] = useState({ total: 0, pending: 0, responded: 0 })
  const [selectedRfq, setSelectedRfq] = useState(null)
  const [rfqReply, setRfqReply] = useState({ unitPrice: '', deliveryDays: 3, notes: '' })
  const [stats, setStats] = useState({ totalViews: 0, totalProducts: 0, avgRating: 0 })
  const [verifyForm, setVerifyForm] = useState({
    iceNumber: supplier.iceNumber || '',
    tradeRegistry: supplier.tradeRegistry || '',
    verificationDoc: supplier.verificationDoc || ''
  })
  const [verifyLoading, setVerifyLoading] = useState(false)
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
  const [hasImageRights, setHasImageRights] = useState(true)
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

  const fetchMyProfile = useCallback(async () => {
    const token = localStorage.getItem('supplierToken')
    if (!token) return
    try {
      const res = await fetch(`${API}/suppliers/me/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data && data._id) {
        setProfile(data)
        setVerifyForm({
          iceNumber: data.iceNumber || '',
          tradeRegistry: data.tradeRegistry || '',
          verificationDoc: data.verificationDoc || ''
        })
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchMyProducts()
    fetchMyReviews()
    fetchMyRfqs()
    fetchMyProfile()
  }, [fetchMyProducts, fetchMyReviews, fetchMyRfqs, fetchMyProfile])

  async function submitVerification(e) {
    if (e && e.preventDefault) e.preventDefault()
    if (!verifyForm.iceNumber && !verifyForm.tradeRegistry) {
      return setMsg('⚠️ يرجى إدخال رقم المعرف الموحد ICE أو رقم السجل التجاري RC')
    }
    setVerifyLoading(true)
    const token = localStorage.getItem('supplierToken')
    try {
      const res = await fetch(`${API}/suppliers/me/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(verifyForm)
      })
      const data = await res.json()
      if (res.ok) {
        setMsg(data.message)
        setProfile(prev => ({ ...prev, ...data.supplier }))
      } else {
        setMsg(data.message || '⚠️ تعذر إرسال طلب التوثيق')
      }
    } catch {
      setMsg('❌ خطأ في الاتصال بالسيرفر')
    } finally {
      setVerifyLoading(false)
    }
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

  async function enhanceWithAI(directFile = null) {
    const fileToUse = directFile || imageFile
    if (!fileToUse) return setMsg('⚠️ يرجى اختيار صورة للمنتج أولاً')
    setImgLoading(true)
    setMsg('🧠 جاري تحليل صورة المنتج وتوليد مسودة الجملة بالذكاء الاصطناعي...')
    const token = localStorage.getItem('supplierToken')
    const formData = new FormData()
    formData.append('image', fileToUse)
    if (form.name) formData.append('productName', form.name)
    if (form.category) formData.append('category', form.category)

    try {
      const res = await fetch(`${API}/product-ai/enhance`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData
      })
      const data = await res.json()
      const draft = data.draft || data.aiData
      if (draft) {
        setAiResult(data)
        const newImgUrl = data.imageUrl || data.enhancedImage
        if (newImgUrl) setPreview(newImgUrl)
        setForm(prev => ({
          ...prev,
          name: draft.title || prev.name,
          category: draft.category || prev.category || 'أخرى',
          description: draft.description || prev.description || '',
          price: draft.suggestedPrice || prev.price || '',
          moq: draft.suggestedMoq || prev.moq || 1,
          unit: draft.suggestedUnit || prev.unit || 'قطعة',
          imageUrl: newImgUrl || prev.imageUrl
        }))
        if (Array.isArray(draft.suggestedPriceTiers) && draft.suggestedPriceTiers.length > 0) {
          setPriceTiers(draft.suggestedPriceTiers)
        }
        setMsg('✨ تم استخراج مسودة المنتج وتسعير الجملة بنجاح! راجع البيانات واعتمد النشر.')
      } else {
        setMsg(data.message || '⚠️ لم يتم استخراج المسودة')
      }
    } catch {
      setMsg('⚠️ تعذر تحليل الصورة بالذكاء الاصطناعي')
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

  async function addProduct(isDraft = false) {
    if (!form.name || !form.price || !form.category) {
      return setMsg('⚠️ كمل جميع الخانات الإلزامية (اسم المنتج، الفئة، والسعر الأساسي)')
    }
    if (!hasImageRights) {
      return setMsg('⚠️ يرجى الموافقة على إقرار حقوق استخدام الصورة والمنتج')
    }

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
          description: form.description || aiResult?.draft?.description || aiResult?.aiData?.description || '',
          imageUrl: preview || aiResult?.imageUrl || aiResult?.enhancedImage || form.imageUrl || '',
          hasImageRights: true,
          isDraft: !!isDraft
        })
      })
      const data = await res.json()
      setMsg(data.message || (isDraft ? '💾 تم حفظ المنتج كمسودة' : '✅ تم نشر منتج الجملة في الكتالوج بنجاح'))
      setForm({ name: '', category: '', price: '', moq: 10, unit: 'قطعة', city: supplier.city || '', description: '' })
      setPriceTiers([])
      setAiResult(null)
      setPreview(null)
      setImageFile(null)
      fetchMyProducts()
    } catch {
      setMsg('❌ تعذر حفظ أو نشر المنتج')
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
    { id: 'verification', label: profile.isVerified ? '🛡️ توثيق المتجر (موثق)' : (profile.verificationStatus === 'pending' ? '⏳ توثيق المتجر (مراجعة)' : '🛡️ توثيق المتجر') },
    { id: 'products', label: '📦 منتجاتي' },
    { id: 'add',      label: '➕ إضافة منتج جملة' },
    { id: 'reviews',  label: '⭐ التقييمات' },
    { id: 'market',   label: '📈 تحليل السوق' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: "'Cairo', sans-serif" }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#C1272D,#8B1A1F)', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', flexWrap: 'wrap', gap: '10px' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'white', fontSize: '18px', fontWeight: '700' }}>{profile.name || supplier.name}</span>
                {profile.isVerified && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#065F46',
                      background: '#D1FAE5',
                      border: '1px solid #A7F3D0',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontWeight: '700'
                    }}
                  >
                    🛡️ مورد موثوق
                  </span>
                )}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px' }}>📍 {profile.city || supplier.city} | متجر جملة معتمد</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {profile.role === 'admin' && onGoAdmin && (
              <button
                onClick={onGoAdmin}
                style={{
                  background: '#F59E0B',
                  border: 'none',
                  color: 'white',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '700',
                  fontFamily: "'Cairo', sans-serif"
                }}
              >
                ⚙️ لوحة المشرف
              </button>
            )}
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

        {/* Add Product Tab (AI-First Wholesale Onboarding) */}
        {activeTab === 'add' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', maxWidth: '640px', margin: '0 auto', boxShadow: '0 2px 14px rgba(0,0,0,0.06)', direction: 'rtl' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <span style={{ fontSize: '26px' }}>✨</span>
              <h2 style={{ margin: 0, fontSize: '19px', color: '#0F172A' }}>إضافة منتج جملة بالذكاء الاصطناعي</h2>
            </div>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 20px', lineHeight: '1.5' }}>
              ابدأ برفع صورة المنتج فقط — الذكاء الاصطناعي يستخرج العنوان، الفئة، الوصف، واقتراح تسعير الجملة والـ MOQ تلقائياً لتراجعها بضغطة زر.
            </p>

            {/* المرحلة 1: رفع وتحليل صورة المنتج */}
            <div
              style={{
                background: preview ? '#F8FAFC' : 'linear-gradient(180deg, #F0FDF4 0%, #F8FAFC 100%)',
                border: '2px dashed #0F766E',
                borderRadius: '14px',
                padding: '24px 16px',
                textAlign: 'center',
                marginBottom: '20px'
              }}
            >
              {preview ? (
                <div>
                  <div style={{ position: 'relative', display: 'inline-block', maxWidth: '240px', maxHeight: '180px', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                    <img src={preview} alt="معاينة المنتج" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {aiResult && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: '8px',
                          left: '8px',
                          background: 'rgba(15, 118, 110, 0.9)',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: '700'
                        }}
                      >
                        ✨ تم تحليل وتوليد المسودة
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                    <label style={{ padding: '8px 14px', background: 'white', border: '1px solid #CBD5E1', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                      🔄 تغيير الصورة
                      <input type="file" accept="image/*" onChange={e => { handleImageUpload(e); if (e.target.files[0]) enhanceWithAI(e.target.files[0]) }} style={{ display: 'none' }} />
                    </label>
                    <button
                      type="button"
                      onClick={() => enhanceWithAI()}
                      disabled={imgLoading}
                      style={{
                        padding: '8px 16px',
                        background: '#0F766E',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '700',
                        fontFamily: "'Cairo', sans-serif"
                      }}
                    >
                      {imgLoading ? '🧠 جاري استخراج مسودة الجملة...' : '⚡ إعادة توليد المسودة بالـ AI'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '38px', marginBottom: '8px' }}>📸</div>
                  <div style={{ fontWeight: '700', fontSize: '15px', color: '#0F172A', marginBottom: '4px' }}>
                    ارفع صورة منتجك بالجملة هنا
                  </div>
                  <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 16px' }}>
                    صورة واضحة للمنتج كافية لاستخراج كامل بيانات الكتالوج
                  </p>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <label style={{ padding: '10px 20px', background: '#0F766E', color: 'white', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
                      📁 اختر صورة من جهازك
                      <input type="file" accept="image/*" onChange={e => { handleImageUpload(e); if (e.target.files[0]) enhanceWithAI(e.target.files[0]) }} style={{ display: 'none' }} />
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowImagePicker(true)}
                      style={{ padding: '10px 16px', background: '#E6F1FB', color: '#185FA5', border: '1px solid #BFDBFE', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                    >
                      🔍 صور تجارية جاهزة
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* تنبيه حالة AI الذكية */}
            {aiResult && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '10px', padding: '14px 16px', marginBottom: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#065F46', fontWeight: '700', fontSize: '13px', marginBottom: '4px' }}>
                  <span>✨</span>
                  <span>مسودة منتج الجملة جاهزة للمراجعة</span>
                </div>
                {aiResult.draft?.tips && (
                  <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                    💡 <strong>نصيحة المبيعات:</strong> {aiResult.draft.tips}
                  </div>
                )}
                {aiResult.draft?.features && aiResult.draft.features.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                    🏷️ <strong>المميزات المقترحة:</strong> {aiResult.draft.features.join(' • ')}
                  </div>
                )}
              </div>
            )}

            {/* المرحلة 2: مراجعة واعتماد بيانات الجملة */}
            <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '18px' }}>
              <div style={{ fontWeight: '700', fontSize: '15px', color: '#1E293B', marginBottom: '14px' }}>
                📋 مراجعة وتعديل بيانات المنتج
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>اسم المنتج *</label>
                {inp('اسم المنتج *', 'name')}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>الفئة *</label>
                  {inp('الفئة (ملابس، أحذية، إلكترونيات...) *', 'category')}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>مدينة التوريد</label>
                  {inp('المدينة', 'city')}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>السعر الأساسي (درهم) *</label>
                  {inp('السعر *', 'price', 'number')}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>وحدة البيع</label>
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
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>الحد الأدنى (MOQ) *</label>
                  {inp('أقل طلب', 'moq', 'number')}
                </div>
              </div>

              {/* شرائح الأسعار (Tiered Pricing) */}
              <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', margin: '12px 0', border: '1px solid #E2E8F0' }}>
                <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px', color: '#1E293B' }}>
                  🏷️ أسعار الجملة حسب الكمية (Tiered Pricing)
                </div>
                <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 10px' }}>
                  تخفيضات الكمية تشجع المشترين المهنيين على إرسال طلبات أكبر.
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

              {/* وصف المنتج */}
              <div style={{ margin: '12px 0' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>
                  وصف المنتج لتجار الجملة (استخرجه الذكاء الاصطناعي ويمكنك تعديله)
                </label>
                <textarea
                  rows={3}
                  value={form.description || ''}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="مواصفات الخامة، المقاسات المتوفرة، طرق التوصيل..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #ddd',
                    fontSize: '13px',
                    direction: 'rtl',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: "'Cairo', sans-serif"
                  }}
                />
              </div>

              {/* إقرار حقوق الصورة والمنتج (مطلوب حسب المخطط التأسيسي) */}
              <div style={{ background: '#F1F5F9', padding: '12px 14px', borderRadius: '8px', margin: '14px 0', border: '1px solid #E2E8F0' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '12px', color: '#334155', lineHeight: '1.5' }}>
                  <input
                    type="checkbox"
                    checked={hasImageRights}
                    onChange={e => setHasImageRights(e.target.checked)}
                    style={{ marginTop: '2px' }}
                  />
                  <span>
                    <strong>إقرار المورد:</strong> أقر بأنني أملك حق استخدام هذه الصورة وتوريد هذا المنتج، وبأن المواصفات والأسعار وموقع التوريد حقيقية ومطابقة للواقع (المورد يوافق صراحة على النشر).
                  </span>
                </label>
              </div>

              {/* أزرار النشر والحفظ */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => addProduct(false)}
                  disabled={loading}
                  style={{
                    flex: 2,
                    padding: '13px',
                    background: '#C1272D',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '15px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    fontFamily: "'Cairo', sans-serif"
                  }}
                >
                  {loading ? 'جاري النشر...' : '🚀 اعتماد ونشر منتج الجملة الآن'}
                </button>
                <button
                  type="button"
                  onClick={() => addProduct(true)}
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '13px',
                    background: '#F1F5F9',
                    color: '#475569',
                    border: '1px solid #CBD5E1',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontFamily: "'Cairo', sans-serif"
                  }}
                >
                  💾 حفظ كمسودة
                </button>
              </div>
            </div>
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

        {/* Verification Tab (توثيق المتجر والحصول على شارة موثوق) */}
        {activeTab === 'verification' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', direction: 'rtl', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '28px' }}>🛡️</span>
              <h2 style={{ fontSize: '20px', margin: 0, color: '#1E293B' }}>
                توثيق المتجر وشارة "مورد موثوق" (Verified Supplier)
              </h2>
            </div>
            <p style={{ color: '#64748B', fontSize: '14px', lineHeight: '1.6', margin: '0 0 20px' }}>
              توثيق متجرك بالمعرف الموحد للمقاولة (ICE) والسجل التجاري (RC) يمنحك شارة <strong>"🛡️ مورد موثوق"</strong> المعتمدة من Jomla.ma، مما يضاعف ثقة المشترين المهنيين في المغرب ويمنحك أولوية الظهور في نتائج البحث وتلقي طلبات عروض الأسعار (RFQ).
            </p>

            {/* حالة التوثيق الحالية */}
            {profile.isVerified ? (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#065F46', fontWeight: '700', fontSize: '16px', marginBottom: '8px' }}>
                  <span>✅</span>
                  <span>متجرك موثق ومعتمد رسمياً على Jomla.ma</span>
                </div>
                <p style={{ color: '#047857', fontSize: '13px', margin: '0 0 14px' }}>
                  تهانينا! حسابك يتمتع بكامل امتيازات المورد الموثوق وشارة الحماية والثقة.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', background: 'white', padding: '14px', borderRadius: '8px', border: '1px solid #D1FAE5' }}>
                  <div>
                    <span style={{ fontSize: '12px', color: '#64748B', display: 'block' }}>المعرف الموحد للمقاولة (ICE)</span>
                    <strong style={{ fontSize: '14px', color: '#0F172A' }}>{profile.iceNumber || 'مسجل'}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: '#64748B', display: 'block' }}>رقم السجل التجاري (RC)</span>
                    <strong style={{ fontSize: '14px', color: '#0F172A' }}>{profile.tradeRegistry || 'مسجل'}</strong>
                  </div>
                  {profile.verifiedAt && (
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748B', display: 'block' }}>تاريخ الاعتماد</span>
                      <strong style={{ fontSize: '14px', color: '#0F172A' }}>{new Date(profile.verifiedAt).toLocaleDateString('ar-MA')}</strong>
                    </div>
                  )}
                </div>
              </div>
            ) : profile.verificationStatus === 'pending' ? (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B45309', fontWeight: '700', fontSize: '16px', marginBottom: '8px' }}>
                  <span>⏳</span>
                  <span>طلب التوثيق قيد المراجعة والتدقيق</span>
                </div>
                <p style={{ color: '#92400E', fontSize: '13px', margin: '0 0 10px', lineHeight: '1.6' }}>
                  لقد استلمنا بيانات التوثيق الخاصة بك (ICE: <strong>{profile.iceNumber}</strong> {profile.tradeRegistry ? `| RC: ${profile.tradeRegistry}` : ''}). فريق إدارة المنصة يقوم بمطابقة الوثائق وسيتم اعتماد متجرك قريباً.
                </p>
                <span style={{ fontSize: '12px', color: '#B45309', background: '#FEF3C7', padding: '4px 10px', borderRadius: '6px' }}>
                  ⏱️ المدة التقديرية للمراجعة: أقل من 24 ساعة
                </span>
              </div>
            ) : (
              <div>
                {profile.verificationStatus === 'rejected' && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px', padding: '16px', marginBottom: '20px', color: '#991B1B' }}>
                    <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '4px' }}>⚠️ تم رفض طلب التوثيق السابق</div>
                    <div style={{ fontSize: '13px' }}>سبب الرفض: {profile.rejectionReason || 'البيانات أو الوثائق غير مكتملة'}</div>
                    <div style={{ fontSize: '12px', marginTop: '6px', color: '#7F1D1D' }}>يرجى تصحيح البيانات أدناه وإعادة إرسال الطلب للمراجعة.</div>
                  </div>
                )}

                <form onSubmit={submitVerification} style={{ maxWidth: '520px' }}>
                  <div style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                      المعرف الموحد للمقاولة (ICE - 15 رقماً) *
                    </label>
                    <input
                      type="text"
                      placeholder="مثال: 001234567890001"
                      value={verifyForm.iceNumber}
                      onChange={e => setVerifyForm({ ...verifyForm, iceNumber: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        fontSize: '14px',
                        direction: 'ltr',
                        textAlign: 'right',
                        boxSizing: 'border-box',
                        fontFamily: "'Cairo', sans-serif"
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                      رقم السجل التجاري (Registre de Commerce - RC)
                    </label>
                    <input
                      type="text"
                      placeholder="مثال: 12345 - كازا أو طنجة"
                      value={verifyForm.tradeRegistry}
                      onChange={e => setVerifyForm({ ...verifyForm, tradeRegistry: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        fontSize: '14px',
                        direction: 'rtl',
                        boxSizing: 'border-box',
                        fontFamily: "'Cairo', sans-serif"
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
                      رابط وثيقة الإثبات (PDF أو صورة السجل / بطاقة المقاول الذاتي)
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/rc-document.pdf"
                      value={verifyForm.verificationDoc}
                      onChange={e => setVerifyForm({ ...verifyForm, verificationDoc: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        fontSize: '14px',
                        direction: 'ltr',
                        boxSizing: 'border-box',
                        fontFamily: "'Cairo', sans-serif"
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#64748B', display: 'block', marginTop: '4px' }}>
                      يمكنك وضع رابط مباشر لنسخة السجل التجاري أو شهادة التسجيل الضريبي أو بطاقة المقاول الذاتي
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={verifyLoading}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: '#0F766E',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '15px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontFamily: "'Cairo', sans-serif",
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                  >
                    {verifyLoading ? 'جاري الإرسال...' : '🛡️ إرسال ملف التوثيق للمراجعة'}
                  </button>
                </form>
              </div>
            )}
          </div>
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
