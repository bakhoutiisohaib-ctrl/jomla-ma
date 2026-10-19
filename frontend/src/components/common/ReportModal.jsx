import { useState } from 'react'
import { API } from '../../api/config'
import { useTranslation } from '../../i18n/LanguageContext'

export default function ReportModal({ targetType = 'product', targetId, targetName, onClose }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    reporterName: '',
    reporterPhone: '',
    reason: 'fake_product',
    details: ''
  })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setMsg('')

    try {
      const res = await fetch(`${API}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          targetType,
          targetId,
          targetName
        })
      })
      const data = await res.json()
      if (res.ok) {
        setSubmitted(true)
        setMsg(data.message)
      } else {
        setMsg(data.message || '⚠️ تعذر إرسال البلاغ')
      }
    } catch {
      setMsg('❌ خطأ في الاتصال بالخادم')
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
        background: 'rgba(0,0,0,0.6)',
        zIndex: 2500,
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
          padding: '24px',
          maxWidth: '460px',
          width: '100%',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#DC2626' }}>
            {t('report_title')}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '42px', marginBottom: '8px' }}>🛡️</div>
            <h4 style={{ color: '#047857', margin: '0 0 6px', fontSize: '16px' }}>شكراً لمساهمتك في حماية السوق</h4>
            <p style={{ color: '#475569', fontSize: '13px', margin: '0 0 16px' }}>{msg}</p>
            <button
              onClick={onClose}
              style={{
                padding: '8px 24px',
                background: '#F1F5F9',
                color: '#334155',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              إغلاق
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ background: '#FEF2F2', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '13px', color: '#991B1B' }}>
              البلاغ بخصوص: <strong>{targetName}</strong> ({targetType === 'product' ? 'منتج' : 'مورد'})
            </div>

            {msg && (
              <div style={{ background: '#FFFBEB', color: '#B45309', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
                {msg}
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#334155' }}>
                سبب البلاغ *
              </label>
              <select
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', outline: 'none' }}
              >
                <option value="fake_product">{t('report_reason_fake')}</option>
                <option value="copyright_infringement">{t('report_reason_copyright')}</option>
                <option value="incorrect_pricing">{t('report_reason_price')}</option>
                <option value="fraud">{t('report_reason_fraud')}</option>
                <option value="other">{t('report_reason_other')}</option>
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#334155' }}>
                تفاصيل إضافية
              </label>
              <textarea
                rows="3"
                value={form.details}
                onChange={e => setForm({ ...form, details: e.target.value })}
                placeholder={t('report_details_placeholder')}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>اسمك (اختياري)</label>
                <input
                  type="text"
                  placeholder="محمد تاجر"
                  value={form.reporterName}
                  onChange={e => setForm({ ...form, reporterName: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>رقم هاتفك (اختياري)</label>
                <input
                  type="text"
                  placeholder="0600000000"
                  value={form.reporterPhone}
                  onChange={e => setForm({ ...form, reporterPhone: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#DC2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '700',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                {loading ? '...' : t('report_send_btn')}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 16px',
                  background: '#F1F5F9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                {t('report_cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
