import { useState, useEffect, useCallback } from 'react'
import { API } from '../../api/config'

export default function AdminDashboard({ onBack, onLogout }) {
  const [token, setToken] = useState(() => localStorage.getItem('adminToken') || localStorage.getItem('supplierToken') || '')
  const [activeTab, setActiveTab] = useState('verification')
  const [stats, setStats] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [filterStatus, setFilterStatus] = useState('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [auditLogs, setAuditLogs] = useState([])
  const [reports, setReports] = useState([])
  const [reportsFilter, setReportsFilter] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  
  // Rejection modal state
  const [rejectingSupplier, setRejectingSupplier] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  // Login form state (if not authenticated)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  const fetchStats = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API}/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      } else if (res.status === 401 || res.status === 403) {
        // Not authorized as admin
      }
    } catch {
      // ignore
    }
  }, [token])

  const fetchSuppliers = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      let url = `${API}/admin/suppliers?status=${filterStatus}`
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSuppliers(data.data || [])
      }
    } catch {
      setSuppliers([])
    } finally {
      setLoading(false)
    }
  }, [token, filterStatus, searchQuery])

  const fetchAuditLogs = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API}/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setAuditLogs(data.data || [])
      }
    } catch {
      setAuditLogs([])
    }
  }, [token])

  const fetchReports = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API}/reports?status=${reportsFilter}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setReports(data.data || [])
      }
    } catch {
      setReports([])
    }
  }, [token, reportsFilter])

  useEffect(() => {
    if (token) {
      fetchStats()
      fetchSuppliers()
      fetchAuditLogs()
      fetchReports()
    }
  }, [token, fetchStats, fetchSuppliers, fetchAuditLogs, fetchReports])

  async function handleResolveReport(id, action) {
    try {
      const res = await fetch(`${API}/reports/${id}/resolve`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action })
      })
      const data = await res.json()
      setMsg(data.message)
      fetchReports()
    } catch {
      setMsg('❌ خطأ في معالجة البلاغ')
    }
  }

  async function handleAdminLogin(e) {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      const res = await fetch(`${API}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      })
      const data = await res.json()
      if (res.ok && data.token) {
        localStorage.setItem('adminToken', data.token)
        setToken(data.token)
      } else {
        setLoginError(data.message || 'فشل تسجيل الدخول')
      }
    } catch {
      setLoginError('تعذر الاتصال بالخادم')
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleVerify(supplierId, action, reason = '') {
    try {
      const res = await fetch(`${API}/admin/suppliers/${supplierId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action, rejectionReason: reason })
      })
      const data = await res.json()
      if (res.ok) {
        setMsg(data.message)
        setRejectingSupplier(null)
        setRejectionReason('')
        fetchStats()
        fetchSuppliers()
        fetchAuditLogs()
      } else {
        setMsg(data.message || '⚠️ فشل تحديث حالة المورد')
      }
    } catch {
      setMsg('❌ خطأ في الاتصال بالخادم')
    }
  }

  // إذا لم يكن هناك توكن أو كانت الصلاحية مرفوضة، اعرض شاشة تسجيل دخول المشرف
  if (!token) {
    return (
      <div style={{ minHeight: '100vh', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: "'Cairo', sans-serif" }}>
        <div style={{ background: 'white', borderRadius: '16px', padding: '32px', maxWidth: '420px', width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', direction: 'rtl' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span style={{ fontSize: '36px' }}>👑</span>
            <h1 style={{ fontSize: '20px', margin: '8px 0 4px', color: '#0F172A' }}>دخول لوحة إدارة Jomla.ma</h1>
            <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>مخصص للمشرفين والمسؤولين المعتمدين فقط</p>
          </div>

          {loginError && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>
              {loginError}
            </div>
          )}

          <form onSubmit={handleAdminLogin}>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>البريد الإلكتروني للمشرف</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                required
                placeholder="admin@jomla.ma"
                style={{ width: '100%', padding: '11px 14px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'ltr', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>كلمة المرور</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{ width: '100%', padding: '11px 14px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', direction: 'ltr', boxSizing: 'border-box' }}
              />
            </div>
            <button
              type="submit"
              disabled={loginLoading}
              style={{ width: '100%', padding: '12px', background: '#0F172A', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: "'Cairo', sans-serif" }}
            >
              {loginLoading ? 'جاري التحقق...' : 'تسجيل الدخول كمسؤول 🛡️'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button
              onClick={onBack}
              style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '13px', fontFamily: "'Cairo', sans-serif" }}
            >
              ← العودة للموقع
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'Cairo', sans-serif" }}>
      {/* Top Navbar */}
      <header style={{ background: '#0F172A', color: 'white', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>🛡️</span>
          <div>
            <div style={{ fontWeight: '700', fontSize: '17px' }}>Jomla.ma | لوحة الإشراف والتوثيق</div>
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>إدارة الحسابات وتوثيق الموردين وسجل التدقيق</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={onBack}
            style={{
              background: '#1E293B',
              border: '1px solid #334155',
              color: 'white',
              borderRadius: '8px',
              padding: '7px 14px',
              cursor: 'pointer',
              fontSize: '13px',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            🏠 العودة للموقع
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('adminToken')
              setToken('')
              if (onLogout) onLogout()
            }}
            style={{
              background: '#EF4444',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              padding: '7px 14px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            خروج
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1120px', margin: '24px auto', padding: '0 16px', direction: 'rtl' }}>
        {msg && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '16px',
              background: msg.includes('✅') ? '#ECFDF5' : '#FEF2F2',
              color: msg.includes('✅') ? '#065F46' : '#991B1B',
              fontSize: '14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>{msg}</span>
            <button onClick={() => setMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>✕</button>
          </div>
        )}

        {/* Stats Row */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            {[
              { label: 'طلبات توثيق قيد المراجعة', value: stats.pendingVerifications, icon: '⏳', color: '#B45309', bg: '#FEF3C7', alert: stats.pendingVerifications > 0 },
              { label: 'موردون موثقون رسمياً', value: stats.verifiedSuppliers, icon: '🛡️', color: '#065F46', bg: '#D1FAE5' },
              { label: 'إجمالي الموردين', value: stats.totalSuppliers, icon: '🏪', color: '#1E293B', bg: '#F1F5F9' },
              { label: 'إجمالي المنتجات', value: stats.totalProducts, icon: '📦', color: '#1E293B', bg: '#F1F5F9' },
              { label: 'طلبات عروض الأسعار (RFQ)', value: stats.totalRfqs, icon: '📑', color: '#0F766E', bg: '#CCFBF1' },
            ].map((s, idx) => (
              <div
                key={idx}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '18px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                  border: s.alert ? '2px solid #F59E0B' : '1px solid #E2E8F0'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '22px' }}>{s.icon}</span>
                  <span style={{ fontSize: '22px', fontWeight: '700', color: s.color }}>{s.value}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748B', fontWeight: '500' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #E2E8F0', marginBottom: '20px' }}>
          {[
            { id: 'verification', label: `🛡️ طابور التوثيق (${stats?.pendingVerifications || 0})` },
            { id: 'reports',      label: `🚨 البلاغات والإشراف (${reports.filter(r => r.status === 'pending').length})` },
            { id: 'all_suppliers', label: '👥 جميع الموردين' },
            { id: 'audit',         label: '📜 سجل التدقيق الإداري' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '12px 18px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === t.id ? '3px solid #0F766E' : '3px solid transparent',
                color: activeTab === t.id ? '#0F766E' : '#64748B',
                fontWeight: activeTab === t.id ? '700' : '500',
                fontSize: '14px',
                cursor: 'pointer',
                fontFamily: "'Cairo', sans-serif"
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Verification Queue & Suppliers */}
        {(activeTab === 'verification' || activeTab === 'all_suppliers') && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748B' }}>الحالة:</span>
                {['all', 'pending', 'verified', 'rejected'].map(st => (
                  <button
                    key={st}
                    onClick={() => setFilterStatus(st)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      border: 'none',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: filterStatus === st ? '700' : '500',
                      background: filterStatus === st ? '#0F766E' : '#E2E8F0',
                      color: filterStatus === st ? 'white' : '#475569',
                      fontFamily: "'Cairo', sans-serif"
                    }}
                  >
                    {st === 'all' && 'الكل'}
                    {st === 'pending' && '⏳ قيد المراجعة'}
                    {st === 'verified' && '🛡️ موثق'}
                    {st === 'rejected' && '❌ مرفوض'}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="بحث بالاسم، المدينة، أو الـ ICE..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  fontSize: '13px',
                  direction: 'rtl',
                  minWidth: '240px',
                  fontFamily: "'Cairo', sans-serif"
                }}
              />
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>جاري تحميل البيانات...</div>
            ) : suppliers.length === 0 ? (
              <div style={{ background: 'white', borderRadius: '12px', padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
                لا يوجد موردون يطابقون هذه الفئة حالياً.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {suppliers.map(s => (
                  <div
                    key={s._id}
                    style={{
                      background: 'white',
                      borderRadius: '12px',
                      padding: '20px',
                      border: s.verificationStatus === 'pending' ? '1px solid #FDE68A' : '1px solid #E2E8F0',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '16px'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: '280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A' }}>{s.name}</span>
                        {s.isVerified && (
                          <span style={{ fontSize: '11px', background: '#D1FAE5', color: '#065F46', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>
                            🛡️ موثق
                          </span>
                        )}
                        {s.verificationStatus === 'pending' && (
                          <span style={{ fontSize: '11px', background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>
                            ⏳ قيد المراجعة
                          </span>
                        )}
                        {s.verificationStatus === 'rejected' && (
                          <span style={{ fontSize: '11px', background: '#FEE2E2', color: '#991B1B', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>
                            ❌ مرفوض
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '13px', color: '#64748B', display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        <span>📍 {s.city || 'المدينة غير محددة'}</span>
                        <span>✉️ {s.email}</span>
                        <span>📞 {s.phone}</span>
                      </div>

                      {/* بيانات التوثيق القانونية (ICE / RC) */}
                      <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <div>
                          <span style={{ color: '#64748B' }}>المعرف الموحد ICE: </span>
                          <strong style={{ color: s.iceNumber ? '#0F172A' : '#94A3B8' }}>{s.iceNumber || 'غير متوفر'}</strong>
                        </div>
                        <div>
                          <span style={{ color: '#64748B' }}>السجل التجاري RC: </span>
                          <strong style={{ color: s.tradeRegistry ? '#0F172A' : '#94A3B8' }}>{s.tradeRegistry || 'غير متوفر'}</strong>
                        </div>
                        {s.verificationDoc && (
                          <div>
                            <a
                              href={s.verificationDoc}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#0F766E', fontWeight: '600', textDecoration: 'none' }}
                            >
                              📎 معاينة الوثيقة المرفقة ↗
                            </a>
                          </div>
                        )}
                      </div>

                      {s.rejectionReason && (
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#991B1B' }}>
                          سبب الرفض السابق: {s.rejectionReason}
                        </div>
                      )}
                    </div>

                    {/* أزرار الإجراءات للمشرف */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <a
                        href={`https://wa.me/${s.phone}?text=${encodeURIComponent(`السلام عليكم ${s.name}، نتواصل معكم من إدارة منصة Jomla.ma بخصوص ملف التوثيق.`)}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          padding: '9px 12px',
                          background: '#25D366',
                          color: 'white',
                          borderRadius: '8px',
                          textDecoration: 'none',
                          fontSize: '12px',
                          fontWeight: '600'
                        }}
                      >
                        💬 واتساب
                      </a>

                      {s.verificationStatus !== 'verified' && (
                        <button
                          onClick={() => handleVerify(s._id, 'approve')}
                          style={{
                            padding: '9px 16px',
                            background: '#0F766E',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            fontFamily: "'Cairo', sans-serif"
                          }}
                        >
                          ✅ قبول وتوثيق
                        </button>
                      )}

                      {s.verificationStatus !== 'rejected' && (
                        <button
                          onClick={() => {
                            setRejectingSupplier(s)
                            setRejectionReason('')
                          }}
                          style={{
                            padding: '9px 14px',
                            background: '#FEE2E2',
                            color: '#991B1B',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            fontFamily: "'Cairo', sans-serif"
                          }}
                        >
                          ❌ رفض
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Audit Logs */}
        {activeTab === 'audit' && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 16px', color: '#0F172A' }}>سجل العمليات والقرارات الإدارية (Audit Trail)</h2>
            {auditLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#94A3B8' }}>لا توجد سجلات بعد.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#475569' }}>
                      <th style={{ padding: '12px' }}>التاريخ والوقت</th>
                      <th style={{ padding: '12px' }}>الإجراء</th>
                      <th style={{ padding: '12px' }}>المنفذ</th>
                      <th style={{ padding: '12px' }}>الهدف</th>
                      <th style={{ padding: '12px' }}>التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(log => (
                      <tr key={log._id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '12px', color: '#64748B', whiteSpace: 'nowrap' }}>
                          {new Date(log.createdAt).toLocaleString('ar-MA')}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: '700',
                              background:
                                log.action === 'SUPPLIER_VERIFIED'
                                  ? '#D1FAE5'
                                  : log.action === 'SUPPLIER_REJECTED'
                                  ? '#FEE2E2'
                                  : '#FEF3C7',
                              color:
                                log.action === 'SUPPLIER_VERIFIED'
                                  ? '#065F46'
                                  : log.action === 'SUPPLIER_REJECTED'
                                  ? '#991B1B'
                                  : '#92400E'
                            }}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontWeight: '600' }}>
                          {log.performedBy?.name || log.performedBy?.email || 'نظام المنصة'}
                        </td>
                        <td style={{ padding: '12px', color: '#475569' }}>
                          {log.targetType} #{String(log.targetId).slice(-6)}
                        </td>
                        <td style={{ padding: '12px', color: '#64748B', fontSize: '12px' }}>
                          {log.details?.reason && <span>السبب: {log.details.reason} </span>}
                          {log.details?.iceNumber && <span>(ICE: {log.details.iceNumber})</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: Moderation & Reports */}
        {activeTab === 'reports' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748B' }}>الحالة:</span>
                {['all', 'pending', 'resolved', 'dismissed'].map(st => (
                  <button
                    key={st}
                    onClick={() => setReportsFilter(st)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      border: 'none',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: reportsFilter === st ? '700' : '500',
                      background: reportsFilter === st ? '#DC2626' : '#E2E8F0',
                      color: reportsFilter === st ? 'white' : '#475569',
                      fontFamily: "'Cairo', sans-serif"
                    }}
                  >
                    {st === 'all' && 'الكل'}
                    {st === 'pending' && '⏳ قيد المراجعة'}
                    {st === 'resolved' && '✅ تم الحل'}
                    {st === 'dismissed' && '📁 تم الحفظ'}
                  </button>
                ))}
              </div>
              <button
                onClick={fetchReports}
                style={{ padding: '6px 12px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
              >
                🔄 تحديث
              </button>
            </div>

            {reports.length === 0 ? (
              <div style={{ background: 'white', borderRadius: '14px', padding: '50px 20px', textAlign: 'center', color: '#64748B' }}>
                <div style={{ fontSize: '36px', marginBottom: '8px' }}>🛡️</div>
                <div style={{ fontWeight: '600', fontSize: '15px' }}>لا توجد بلاغات في هذه الفئة حالياً</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>جميع السلع والموردين متوافقين مع معايير المنصة</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {reports.map(rep => (
                  <div key={rep._id} style={{ background: 'white', borderRadius: '12px', padding: '16px', border: '1px solid #E2E8F0', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <span style={{ fontWeight: '700', fontSize: '15px', color: '#0F172A' }}>{rep.targetName}</span>
                        <span style={{ fontSize: '11px', background: '#FEE2E2', color: '#991B1B', padding: '2px 8px', borderRadius: '12px', marginRight: '8px' }}>
                          {rep.targetType === 'product' ? 'منتج' : 'مورد'}
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748B', marginRight: '8px' }}>
                          بواسطة: {rep.reporterName} ({rep.reporterPhone || 'بدون هاتف'})
                        </span>
                      </div>
                      <span style={{
                        padding: '3px 10px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '700',
                        background: rep.status === 'pending' ? '#FEF3C7' : rep.status === 'resolved' ? '#DCFCE7' : '#F1F5F9',
                        color: rep.status === 'pending' ? '#B45309' : rep.status === 'resolved' ? '#166534' : '#475569'
                      }}>
                        {rep.status === 'pending' ? '⏳ قيد التدقيق' : rep.status === 'resolved' ? '✅ تم الحل' : '📁 محفوظ'}
                      </span>
                    </div>

                    <div style={{ fontSize: '13px', color: '#334155', background: '#F8FAFC', padding: '10px 14px', borderRadius: '8px', marginBottom: '10px' }}>
                      <strong>السبب:</strong> {rep.reason} {rep.details && `— ${rep.details}`}
                    </div>

                    {rep.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleResolveReport(rep._id, 'resolved')}
                          style={{ padding: '6px 14px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          ✅ اتخاذ إجراء وحل البلاغ
                        </button>
                        <button
                          onClick={() => handleResolveReport(rep._id, 'dismissed')}
                          style={{ padding: '6px 14px', background: '#94A3B8', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                        >
                          📁 حفظ بدون إجراء
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal: Rejection Reason Dialog */}
      {rejectingSupplier && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1500
          }}
        >
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', maxWidth: '440px', width: '100%', direction: 'rtl', fontFamily: "'Cairo', sans-serif" }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '17px', color: '#0F172A' }}>
              رفض طلب توثيق {rejectingSupplier.name}
            </h3>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 14px' }}>
              يرجى توضيح سبب الرفض ليتمكن المورد من تصحيح وثائقه (مثال: رقم السجل غير مطابق، أو الوثيقة غير واضحة):
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="اكتب سبب الرفض هنا..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                fontSize: '13px',
                direction: 'rtl',
                boxSizing: 'border-box',
                outline: 'none',
                fontFamily: "'Cairo', sans-serif",
                marginBottom: '16px'
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setRejectingSupplier(null)}
                style={{
                  padding: '9px 14px',
                  background: '#F1F5F9',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontFamily: "'Cairo', sans-serif"
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => handleVerify(rejectingSupplier._id, 'reject', rejectionReason)}
                style={{
                  padding: '9px 18px',
                  background: '#EF4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  fontFamily: "'Cairo', sans-serif"
                }}
              >
                تأكيد الرفض ❌
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
