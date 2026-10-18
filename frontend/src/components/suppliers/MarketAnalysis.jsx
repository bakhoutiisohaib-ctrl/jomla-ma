import { useState } from 'react'
import { API } from '../../api/config'

export default function MarketAnalysis({ supplier, products }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)

  async function getAnalysis() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/ai-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `تحليل سوق ${products.map(p => p.category).filter(Boolean).join(' ')} في ${supplier.city}`,
          city: supplier.city,
          category: ''
        })
      })
      const data = await res.json()
      setAnalysis(data)
    } catch {
      setAnalysis({ message: 'خطأ في التحليل' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        background: 'white',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        direction: 'rtl',
        fontFamily: "'Cairo', sans-serif"
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: '16px' }}>📈 تحليل السوق الذكي</h2>
      <p style={{ fontSize: '13px', color: '#888', margin: '0 0 16px' }}>
        AI يحلل السوق ويعطيك توصيات مخصصة لمتجرك
      </p>

      {/* إحصائيات المنتجات */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ fontSize: '14px', color: '#333', marginBottom: '10px' }}>أداء منتجاتك:</h3>
        {products.length === 0 ? (
          <div style={{ color: '#888', fontSize: '13px' }}>ما زال ما ضفتيش منتجات للتحليل</div>
        ) : (
          [...products]
            .sort((a, b) => (b.views || 0) - (a.views || 0))
            .map(p => (
              <div
                key={p._id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid #f5f5f5'
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600' }}>{p.name}</div>
                  <div style={{ fontSize: '11px', color: '#888' }}>{p.category}</div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '13px', color: '#E85D24', fontWeight: '600' }}>{p.price} درهم</div>
                  <div style={{ fontSize: '11px', color: '#888' }}>👁️ {p.views || 0} مشاهدة</div>
                </div>
              </div>
            ))
        )}
      </div>

      <button
        onClick={getAnalysis}
        disabled={loading}
        style={{
          width: '100%',
          padding: '12px',
          background: 'linear-gradient(135deg,#185FA5,#0C447C)',
          color: 'white',
          border: 'none',
          borderRadius: '10px',
          fontSize: '14px',
          fontWeight: '700',
          cursor: 'pointer',
          fontFamily: "'Cairo', sans-serif",
          marginBottom: '16px'
        }}
      >
        {loading ? '⏳ AI كيحلل السوق...' : '🤖 احصل على تحليل ذكي'}
      </button>

      {analysis?.message && (
        <div style={{ background: '#E6F1FB', borderRadius: '12px', padding: '16px', fontSize: '13px', lineHeight: '1.8' }}>
          <div style={{ fontWeight: '600', color: '#185FA5', marginBottom: '8px' }}>🤖 توصيات AI:</div>
          <div>{analysis.message}</div>
          {analysis.suggestions?.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: '600', marginBottom: '6px' }}>💡 اقتراحات:</div>
              {analysis.suggestions.map((s, i) => (
                <div key={i} style={{ padding: '4px 0', color: '#333' }}>• {s}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
