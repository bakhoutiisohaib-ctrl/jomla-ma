import { useId, useState } from 'react'
import { apiRequest } from '../../api/config'
import { useTranslation } from '../../i18n/LanguageContext'
import { useLabels } from '../../i18n/useLabels'

export default function ReportModal({ targetType = 'product', targetId, targetName, onClose }) {
  const { t } = useTranslation()
  const l = useLabels()
  const id = useId()
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
      await apiRequest('/reports', {
        method: 'POST',
        token: '',
        body: {
          ...form,
          targetType,
          targetId,
          targetName
        }
      })
      setSubmitted(true)
      setMsg(l('تم إرسال البلاغ للإدارة.', 'Signalement envoyé à l’administration.'))
    } catch (error) {
      setMsg(error.message || l('تعذر إرسال البلاغ', 'Impossible d’envoyer le signalement'))
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={id + '-title'}
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '460px',
          width: '100%',
          maxHeight: '90dvh',
          overflowY: 'auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 id={id + '-title'} style={{ margin: 0, fontSize: '16px', color: '#DC2626' }}>
            {t('report_title')}
          </h3>
          <button aria-label={l('إغلاق', 'Fermer')} onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>

        {submitted ? (
          <div role="status" style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '42px', marginBottom: '8px' }}>🛡️</div>
            <h4 style={{ color: '#047857', margin: '0 0 6px', fontSize: '16px' }}>{l('شكراً لمساهمتك في حماية السوق', 'Merci de contribuer à la protection du marché')}</h4>
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
              {l('إغلاق', 'Fermer')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ background: '#FEF2F2', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '13px', color: '#991B1B' }}>
              {l('البلاغ بخصوص', 'Signalement concernant')}: <strong>{targetName}</strong> ({targetType === 'product' ? l('منتج', 'Produit') : l('مورد', 'Fournisseur')})
            </div>

            {msg && (
              <div role="alert" style={{ background: '#FFFBEB', color: '#B45309', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
                {msg}
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label htmlFor={id + '-reason'} style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#334155' }}>
                {l('سبب البلاغ', 'Motif du signalement')}
              </label>
              <select
                id={id + '-reason'}
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
              <label htmlFor={id + '-details'} style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#334155' }}>
                {l('تفاصيل إضافية', 'Détails complémentaires')}
              </label>
              <textarea
                id={id + '-details'}
                rows="3"
                value={form.details}
                onChange={e => setForm({ ...form, details: e.target.value })}
                placeholder={t('report_details_placeholder')}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label htmlFor={id + '-name'} style={{ display: 'block', fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>{l('اسمك (اختياري)', 'Votre nom (facultatif)')}</label>
                <input
                  id={id + '-name'}
                  type="text"
                  placeholder={l('محمد تاجر', 'Nom du commerçant')}
                  value={form.reporterName}
                  onChange={e => setForm({ ...form, reporterName: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label htmlFor={id + '-phone'} style={{ display: 'block', fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>{l('رقم هاتفك (اختياري)', 'Votre téléphone (facultatif)')}</label>
                <input
                  id={id + '-phone'}
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
