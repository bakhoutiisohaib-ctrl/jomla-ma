import React, { useState } from 'react'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function submit(e) {
    e.preventDefault()
    try {
      const res = await fetch('/api/suppliers/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (res.ok && data.token) {
        localStorage.setItem('supplierToken', data.token)
        onLogin()
      } else {
        alert(data.message || 'فشل تسجيل الدخول')
      }
    } catch (err) {
      alert('خطأ في الاتصال')
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h3>تسجيل دخول المورد</h3>
      <form onSubmit={submit}>
        <input placeholder="البريد الإلكتروني" value={email} onChange={e=>setEmail(e.target.value)} required /> <br/>
        <input placeholder="كلمة المرور" type="password" value={password} onChange={e=>setPassword(e.target.value)} required /> <br/>
        <button type="submit">دخول</button>
      </form>
    </div>
  )
}
