import { useState, useEffect } from 'react'
import ReviewSection from '../reviews/ReviewSection'
import { API } from '../../api/config'

export default function SupplierPage({ supplierId, onBack }) {
  const [supplier, setSupplier] = useState(null)
  const [products, setProducts] = useState([])

  useEffect(() => {
    fetch(`${API}/suppliers/${supplierId}`)
      .then(r => r.json())
      .then(setSupplier)
      .catch(() => setSupplier(null))

    fetch(`${API}/suppliers/${supplierId}/products`)
      .then(r => r.json())
      .then(data => setProducts(Array.isArray(data) ? data : data.data || []))
      .catch(() => setProducts([]))
  }, [supplierId])

  if (!supplier) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', fontFamily: "'Cairo', sans-serif" }}>
        جاري التحميل...
      </div>
    )
  }

  const whatsapp = `https://wa.me/${supplier.phone}?text=السلام عليكم، شفت متجرك على Jomla.ma`

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: "'Cairo', sans-serif" }}>
      <div style={{ background: '#C1272D', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}
        >
          ←
        </button>
        <span style={{ color: 'white', fontSize: '18px', fontWeight: '700' }}>🇲🇦 Jomla.ma</span>
      </div>

      <div style={{ background: 'linear-gradient(135deg,#C1272D,#8B1A1F)', padding: '28px 24px' }}>
        <div
          style={{
            maxWidth: '800px',
            margin: '0 auto',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '16px',
            padding: '20px 24px',
            direction: 'rtl'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <h1 style={{ color: 'white', margin: 0, fontSize: '22px' }}>
              🏪 {supplier.name}
            </h1>
            {supplier.isVerified && (
              <span
                style={{
                  fontSize: '12px',
                  color: '#065F46',
                  background: '#D1FAE5',
                  border: '1px solid #A7F3D0',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  fontWeight: '700',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                🛡️ مورد موثوق رسمياً
              </span>
            )}
          </div>
          <p style={{ color: 'rgba(255,255,255,0.85)', margin: '0 0 4px', fontSize: '14px' }}>
            📍 {supplier.city}
          </p>
          {(supplier.iceNumber || supplier.tradeRegistry) && (
            <div style={{ display: 'flex', gap: '14px', color: 'rgba(255,255,255,0.9)', fontSize: '12px', margin: '4px 0 8px' }}>
              {supplier.iceNumber && <span>🏛️ المعرف الموحد ICE: <strong>{supplier.iceNumber}</strong></span>}
              {supplier.tradeRegistry && <span>📋 السجل التجاري RC: <strong>{supplier.tradeRegistry}</strong></span>}
            </div>
          )}
          {supplier.description && (
            <p style={{ color: 'rgba(255,255,255,0.75)', margin: '0 0 16px', fontSize: '13px' }}>
              {supplier.description}
            </p>
          )}
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              background: '#25D366',
              color: 'white',
              borderRadius: '10px',
              textDecoration: 'none',
              fontWeight: '700',
              fontSize: '14px'
            }}
          >
            💬 تواصل عبر واتساب
          </a>
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '24px auto', padding: '0 16px' }}>
        <h2 style={{ direction: 'rtl', fontSize: '16px', color: '#333', marginBottom: '16px' }}>
          📦 منتجات المورد ({products.length})
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' }}>
          {products.map(p => (
            <div
              key={p._id}
              style={{
                background: 'white',
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
                border: '1px solid #eee',
                direction: 'rtl'
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: '#1D9E75',
                  fontWeight: '500',
                  background: '#E1F5EE',
                  padding: '2px 8px',
                  borderRadius: '20px',
                  display: 'inline-block',
                  marginBottom: '8px'
                }}
              >
                {p.category}
              </div>
              {p.imageUrl && (
                <div style={{ width: '100%', height: '120px', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px' }}>
                  <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
                <span style={{ fontSize: '18px', fontWeight: '700', color: '#E85D24' }}>
                  {p.price} درهم
                </span>
                <span style={{ fontSize: '12px', color: '#666' }}>
                  / {p.unit || 'قطعة'}
                </span>
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: '#B45309', background: '#FEF3C7', padding: '2px 6px', borderRadius: '10px', display: 'inline-block' }}>
                📦 أقل طلب: {p.moq || 1} {p.unit || 'قطعة'}
              </div>
            </div>
          ))}
        </div>
        {products.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            ما زال ما زاد منتجات
          </div>
        )}
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto 40px', padding: '0 16px' }}>
        <ReviewSection supplierId={supplierId} />
      </div>
    </div>
  )
}
