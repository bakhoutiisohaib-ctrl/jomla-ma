import { useState } from 'react'
import { API } from '../../api/config'

export default function RFQModal({ product, onClose, onSuccess }) {
  const [form, setForm] = useState({
    quantity: product.moq || 10,
    buyerName: '',
    buyerPhone: '',
    buyerCity: product.city || '',
    targetPrice: '',
    notes: ''
  })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [submittedRfq, setSubmittedRfq] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.buyerName || !form.buyerPhone || !form.quantity) {
      return setMsg('⚠️ يرجى ملء الخانات الإلزامية (الاسم، الهاتف، والكمية)')
    }

    setLoading(true)
    setMsg('')
    try {
      const res = await fetch(`${API}/rfq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product._id,
          ...form,
          quantity: Number(form.quantity),
          targetPrice: form.targetPrice ? Number(form.targetPrice) : null
        })
      })
      const data = await res.json()
      if (res.ok) {
        setSubmittedRfq(data.rfq)
        setMsg('✅ تم إرسال طلب عرض السعر بنجاح!')
        if (onSuccess) onSuccess(data.rfq)
      } else {
        setMsg(data.message || 'تعذر إرسال الطلب')
      }
    } catch {
      setMsg('❌ تعذر الاتصال بالسيرفر')
    } finally {
      setLoading(false)
    }
  }

  const whatsappFollowup = submittedRfq
    ? `https://wa.me/${product.supplierPhone}?text=${encodeURIComponent(
        `السلام عليكم، أرسلت لك طلب عرض سعر رسمي (RFQ رقم #${submittedRfq._id.slice(-6)}) لمنتج "${product.name}" بكمية (${submittedRfq.quantity} ${product.unit || 'قطعة'}) عبر منصة Jomla.ma.`
      )}`
    : '#'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: "'Cairo', sans-serif"
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          direction: 'rtl',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#1a1a1a' }}>
            📄 طلب عرض سعر جملة (RFQ)
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#888' }}
          >
            ✕
          </button>
        </div>

        {/* ملخص المنتج */}
        <div style={{ display: 'flex', gap: '12px', background: '#F8FAFC', padding: '12px', borderRadius: '10px', marginBottom: '16px', border: '1px solid #E2E8F0' }}>
          {product.imageUrl && (
            <img src={product.imageUrl} alt="" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px' }} />
          )}
          <div>
            <div style={{ fontWeight: '700', fontSize: '14px', color: '#0F172A' }}>{product.name}</div>
            <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
              السعر الاسترشادي: <strong style={{ color: '#E85D24' }}>{product.price} درهم</strong> / {product.unit || 'قطعة'}
            </div>
            <div style={{ fontSize: '11px', color: '#B45309', marginTop: '2px' }}>
              الحد الأدنى للطلب (MOQ): {product.moq || 1} {product.unit || 'قطعة'}
            </div>
          </div>
        </div>

        {submittedRfq ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '42px', marginBottom: '8px' }}>🎉</div>
            <h3 style={{ margin: '0 0 8px', color: '#0F766E', fontSize: '16px' }}>
              تم إرسال طلبك للمورد بنجاح!
            </h3>
            <p style={{ fontSize: '13px', color: '#64748B', lineHeight: '1.6', margin: '0 0 16px' }}>
              رقم الطلب الخاص بك: <strong>#{submittedRfq._id.slice(-6)}</strong>. سيتواصل معك المورد أو يرسل عرضه الرسمي.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a
                href={whatsappFollowup}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  padding: '12px',
                  background: '#25D366',
                  color: 'white',
                  borderRadius: '10px',
                  textDecoration: 'none',
                  fontWeight: '700',
                  fontSize: '14px'
                }}
              >
                💬 إشعار المورد فوراً عبر واتساب
              </a>
              <button
                onClick={onClose}
                style={{
                  padding: '10px',
                  background: '#F1F5F9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                إغلاق
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {msg && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '14px',
                  background: '#FAECE7',
                  color: '#993C1D',
                  fontSize: '13px'
                }}
              >
                {msg}
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#334155', fontWeight: '600', marginBottom: '4px' }}>
                الكمية المطلوبة ({product.unit || 'قطعة'}) *
              </label>
              <input
                type="number"
                min={product.moq || 1}
                value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  fontSize: '14px',
                  direction: 'rtl',
                  boxSizing: 'border-box'
                }}
              />
              {Number(form.quantity) < (product.moq || 1) && (
                <div style={{ fontSize: '11px', color: '#EF4444', marginTop: '2px' }}>
                  ⚠️ تنبيه: الكمية أقل من الحد الأدنى للطلب ({product.moq} {product.unit || 'قطعة'})
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#334155', fontWeight: '600', marginBottom: '4px' }}>
                  اسم التاجر / الشركة *
                </label>
                <input
                  type="text"
                  placeholder="محمد متجر الأناقة"
                  value={form.buyerName}
                  onChange={e => setForm({ ...form, buyerName: e.target.value })}
                  required
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'rtl', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#334155', fontWeight: '600', marginBottom: '4px' }}>
                  رقم الواتساب *
                </label>
                <input
                  type="tel"
                  placeholder="2126XXXXXXXX"
                  value={form.buyerPhone}
                  onChange={e => setForm({ ...form, buyerPhone: e.target.value })}
                  required
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'ltr', textAlign: 'right', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#334155', fontWeight: '600', marginBottom: '4px' }}>
                  مدينة التوصيل
                </label>
                <input
                  type="text"
                  placeholder="كازا، فاس، طنجة..."
                  value={form.buyerCity}
                  onChange={e => setForm({ ...form, buyerCity: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'rtl', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#334155', fontWeight: '600', marginBottom: '4px' }}>
                  السعر المستهدف (اختياري)
                </label>
                <input
                  type="number"
                  placeholder="درهم / قطعة"
                  value={form.targetPrice}
                  onChange={e => setForm({ ...form, targetPrice: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'rtl', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#334155', fontWeight: '600', marginBottom: '4px' }}>
                مواصفات أو متطلبات خاصة (ألوان، مقاسات، تغليف...)
              </label>
              <textarea
                rows={3}
                placeholder="اكتب هنا أي تفاصيل تحتاجها مثل الألوان أو مدة التسليم..."
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  flex: 2,
                  padding: '12px',
                  background: '#C1272D',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                {loading ? 'جاري الإرسال...' : '🚀 إرسال طلب السعر الرسمي'}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#F1F5F9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                إلغاء
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
