import { useState } from 'react'
import { API } from '../../api/config'

export default function RegisterPage({ onBack }) {
  const [form, setForm] = useState({
    name: '',
    city: '',
    phone: '',
    description: '',
    email: '',
    password: ''
  })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!form.name || !form.email || !form.password || !form.phone) {
      setMsg('كمل جميع الخانات المطلوبة')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/suppliers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      setMsg(data.message)
      if (res.ok) setTimeout(onBack, 1500)
    } catch {
      setMsg('❌ تعذر إتمام التسجيل، يرجى المحاولة لاحقاً')
    } finally {
      setLoading(false)
    }
  }

  const input = (placeholder, key, type = 'text') => (
    <input
      type={type}
      placeholder={placeholder}
      value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      style={{
        width: '100%',
        padding: '11px 14px',
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

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: "'Cairo', sans-serif" }}>
      <div style={{ background: '#C1272D', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}
        >
          ←
        </button>
        <span style={{ color: 'white', fontSize: '18px', fontWeight: '700' }}>تسجيل مورد جديد</span>
      </div>
      <div style={{ maxWidth: '480px', margin: '40px auto', padding: '0 16px' }}>
        <div style={{ background: 'white', borderRadius: '16px', padding: '28px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin: '0 0 20px', fontSize: '18px', color: '#1a1a1a', direction: 'rtl', textAlign: 'right' }}>
            سجل متجرك الآن مجاناً
          </h2>
          {input('اسم الشركة أو المتجر *', 'name')}
          {input('المدينة *', 'city')}
          {input('رقم واتساب (212XXXXXXXXX) *', 'phone')}
          {input('وصف مختصر عن متجرك', 'description')}
          {input('الإيميل *', 'email', 'email')}
          {input('كلمة المرور *', 'password', 'password')}
          {msg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '12px',
                background: msg.includes('✅') || msg.includes('بنجاح') ? '#E1F5EE' : '#FAECE7',
                color: msg.includes('✅') || msg.includes('بنجاح') ? '#0F6E56' : '#993C1D',
                fontSize: '13px',
                direction: 'rtl'
              }}
            >
              {msg}
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px',
              background: '#C1272D',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: '700',
              cursor: 'pointer',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            {loading ? 'جاري التسجيل...' : 'سجل متجري الآن'}
          </button>
        </div>
      </div>
    </div>
  )
}
