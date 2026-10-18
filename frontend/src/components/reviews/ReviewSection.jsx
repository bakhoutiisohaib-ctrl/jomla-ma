import { useState, useEffect, useCallback } from 'react'
import StarRating from '../common/StarRating'
import { API } from '../../api/config'

export default function ReviewSection({ supplierId }) {
  const [reviews, setReviews] = useState([])
  const [avg, setAvg] = useState(0)
  const [total, setTotal] = useState(0)
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchReviews = useCallback(async () => {
    try {
      const data = await fetch(`${API}/reviews/${supplierId}`).then(r => r.json())
      setReviews(Array.isArray(data.reviews) ? data.reviews : [])
      setAvg(data.avg || 0)
      setTotal(data.total || 0)
    } catch {
      setReviews([])
    }
  }, [supplierId])

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

  async function submitReview() {
    if (!stars) return setMsg('⚠️ اختار عدد النجوم')
    setLoading(true)
    try {
      const res = await fetch(`${API}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId, stars, comment })
      })
      const data = await res.json()
      setMsg(data.message)
      setStars(0)
      setComment('')
      fetchReviews()
    } catch {
      setMsg('❌ تعذر إرسال التقييم')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: '24px', direction: 'rtl', fontFamily: "'Cairo', sans-serif" }}>
      {/* ملخص التقييم */}
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '20px 24px',
          marginBottom: '16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.07)'
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#1a1a1a' }}>
          ⭐ تقييمات التجار
        </h3>
        {total > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '36px', fontWeight: '700', color: '#EF9F27' }}>{avg}</div>
              <StarRating value={Math.round(avg)} readOnly />
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                {total} تقييم
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {[5, 4, 3, 2, 1].map(s => {
                const count = reviews.filter(r => r.stars === s).length
                const pct = total > 0 ? (count / total) * 100 : 0
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', color: '#888', minWidth: '16px' }}>{s}</span>
                    <span style={{ fontSize: '12px', color: '#EF9F27' }}>★</span>
                    <div style={{ flex: 1, background: '#f0f0f0', borderRadius: '4px', height: '8px' }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          background: '#EF9F27',
                          borderRadius: '4px',
                          height: '100%',
                          transition: 'width 0.3s'
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '12px', color: '#888', minWidth: '20px' }}>{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{ color: '#888', fontSize: '13px' }}>ما زال ما كاين تقييمات — كن الأول!</div>
        )}
      </div>

      {/* إضافة تقييم */}
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '20px 24px',
          marginBottom: '16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.07)'
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#1a1a1a' }}>
          قيم هاد المورد
        </h3>
        <div style={{ marginBottom: '10px' }}>
          <StarRating value={stars} onChange={setStars} />
        </div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="شارك تجربتك مع هاد المورد..."
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: '8px',
            border: '1px solid #ddd',
            fontSize: '14px',
            direction: 'rtl',
            outline: 'none',
            resize: 'vertical',
            minHeight: '80px',
            boxSizing: 'border-box',
            fontFamily: "'Cairo', sans-serif"
          }}
        />
        {msg && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              margin: '8px 0',
              background: msg.includes('✅') ? '#E1F5EE' : '#FAECE7',
              color: msg.includes('✅') ? '#0F6E56' : '#993C1D',
              fontSize: '13px'
            }}
          >
            {msg}
          </div>
        )}
        <button
          onClick={submitReview}
          disabled={loading}
          style={{
            marginTop: '10px',
            padding: '10px 24px',
            background: '#C1272D',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            fontFamily: "'Cairo', sans-serif"
          }}
        >
          {loading ? 'جاري الإرسال...' : 'أرسل تقييمي ⭐'}
        </button>
      </div>

      {/* قائمة التقييمات */}
      {reviews.map((r, i) => (
        <div
          key={i}
          style={{
            background: 'white',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '10px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <StarRating value={r.stars} readOnly />
            <span style={{ fontSize: '11px', color: '#aaa' }}>
              {new Date(r.date || r.createdAt).toLocaleDateString('ar-MA')}
            </span>
          </div>
          {r.comment && (
            <p style={{ margin: '0', fontSize: '13px', color: '#444', lineHeight: '1.6' }}>
              {r.comment}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
