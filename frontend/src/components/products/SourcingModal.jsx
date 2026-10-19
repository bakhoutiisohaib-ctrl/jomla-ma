import { useState } from 'react'
import { API } from '../../api/config'

export default function SourcingModal({ initialData = {}, onClose, onSuccess }) {
  const [form, setForm] = useState({
    buyerName: '',
    buyerPhone: '',
    buyerCity: 'الدار البيضاء',
    productName: initialData.productName || initialData.query || '',
    category: initialData.category || 'عام',
    quantity: initialData.quantity || 50,
    unit: 'قطعة',
    targetPrice: initialData.targetPrice || '',
    imageUrl: initialData.imageUrl || '',
    notes: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.buyerName || !form.buyerPhone || !form.productName || !form.quantity) {
      return setError('⚠️ يرجى ملء الحقول الإلزامية: الاسم، الهاتف، اسم المنتج، والكمية')
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${API}/sourcing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(data)
        if (onSuccess) onSuccess(data.sourcing)
      } else {
        setError(data.message || '⚠️ تعذر إرسال طلب التوريد')
      }
    } catch {
      setError('❌ تعذر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: "'Cairo', sans-serif"
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '28px',
          maxWidth: '520px',
          width: '100%',
          direction: 'rtl',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>📦</span>
            <h3 style={{ margin: 0, fontSize: '18px', color: '#0F172A' }}>طلب توريد خاص (B2B Sourcing)</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '46px', marginBottom: '8px' }}>🎉</div>
            <h4 style={{ fontSize: '17px', color: '#065F46', margin: '0 0 8px' }}>تم تسجيل طلب التوريد بنجاح!</h4>
            <p style={{ fontSize: '13px', color: '#475569', lineHeight: '1.6', margin: '0 0 20px' }}>
              طلبك لـ <strong>"{form.productName}"</strong> (كمية: {form.quantity} {form.unit}) تم بثه لشبكة الموردين المعتمدين على Jomla.ma. ستتلقى عروض أسعار مباشرة على هاتفك.
            </p>

            {success.whatsappFollowup && (
              <a
                href={success.whatsappFollowup}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block',
                  width: '100%',
                  padding: '12px',
                  background: '#25D366',
                  color: 'white',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  marginBottom: '10px',
                  boxSizing: 'border-box'
                }}
              >
                💬 متابعة سريعة عبر الواتساب
              </a>
            )}

            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '10px',
                background: '#F1F5F9',
                color: '#475569',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              إغلاق
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 16px', lineHeight: '1.5' }}>
              إذا لم تجد المنتج في الكتالوج، اكتب مواصفاتك وسنقوم بربطك بالمصانع والمستوردين وتجار الجملة الموثوقين لتلقي عروض أسعار منافسة.
            </p>

            {error && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>اسم المنتج المطلوب *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: أحذية رياضية رجالية جملة"
                  value={form.productName}
                  onChange={e => setForm({ ...form, productName: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>الكمية المطلوبة *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="مثال: 100"
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>وحدة البيع</label>
                  <select
                    value={form.unit}
                    onChange={e => setForm({ ...form, unit: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box', background: 'white' }}
                  >
                    <option value="قطعة">قطعة</option>
                    <option value="درزينة">درزينة (12 قطعة)</option>
                    <option value="كرتونة">كرتونة</option>
                    <option value="طرد">طرد</option>
                    <option value="كيلوغرام">كيلوغرام</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>السعر المستهدف للقطعة (درهم)</label>
                  <input
                    type="number"
                    placeholder="اختياري (مثال: 45)"
                    value={form.targetPrice}
                    onChange={e => setForm({ ...form, targetPrice: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>مدينة التسليم</label>
                  <input
                    type="text"
                    placeholder="مثال: كازا، فاس، مراكش..."
                    value={form.buyerCity}
                    onChange={e => setForm({ ...form, buyerCity: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>اسمك أو اسم المحل *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: رضوان التاجر"
                    value={form.buyerName}
                    onChange={e => setForm({ ...form, buyerName: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>رقم الهاتف / الواتساب *</label>
                  <input
                    type="tel"
                    required
                    placeholder="مثال: 0612345678"
                    value={form.buyerPhone}
                    onChange={e => setForm({ ...form, buyerPhone: e.target.value })}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'ltr', textAlign: 'right', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>ملاحظات أو مواصفات خاصة</label>
                <textarea
                  rows={2}
                  placeholder="مثال: تفضيل الدفع عند الاستلام، المقاسات المطلوبة..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', direction: 'rtl', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
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
                  fontFamily: "'Cairo', sans-serif"
                }}
              >
                {loading ? 'جاري الإرسال...' : '🚀 إرسال طلب التوريد للموردين'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
