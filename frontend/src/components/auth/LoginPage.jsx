import { useState } from 'react'
import { API } from '../../api/config'

export default function LoginPage({ onLogin, onBack }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch(`${API}/suppliers/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (res.ok && data.supplier) {
        if (data.token) {
          localStorage.setItem('supplierToken', data.token)
        }
        onLogin(data.supplier)
      } else {
        setMsg(data.message || 'بيانات الدخول غير صحيحة')
      }
    } catch {
      setMsg('❌ تعذر الاتصال بالسيرفر')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: "'Cairo', sans-serif" }}>
      <div style={{ background: '#C1272D', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}
        >
          ←
        </button>
        <span style={{ color: 'white', fontSize: '18px', fontWeight: '700' }}>دخول المورد</span>
      </div>
      <div style={{ maxWidth: '400px', margin: '60px auto', padding: '0 16px' }}>
        <div style={{ background: 'white', borderRadius: '16px', padding: '28px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin: '0 0 20px', textAlign: 'right', direction: 'rtl', fontSize: '18px' }}>
            مرحبا بك في متجرك
          </h2>
          {['email', 'password'].map(key => (
            <input
              key={key}
              type={key}
              placeholder={key === 'email' ? 'الإيميل' : 'كلمة المرور'}
              value={form[key]}
              onChange={e => setForm({ ...form, [key]: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
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
          ))}
          {msg && (
            <div style={{ color: '#993C1D', fontSize: '13px', direction: 'rtl', marginBottom: '10px' }}>
              {msg}
            </div>
          )}
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
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
            {loading ? 'جاري الدخول...' : 'دخول'}
          </button>
        </div>
      </div>
    </div>
  )
}
