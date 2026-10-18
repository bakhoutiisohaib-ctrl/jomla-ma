import { useState } from 'react'
import RFQModal from './RFQModal'

export default function ProductCard({ product, onViewSupplier, onView }) {
  const [showRFQ, setShowRFQ] = useState(false)
  const moqText = `${product.moq || 1} ${product.unit || 'قطعة'}`
  const whatsapp = `https://wa.me/${product.supplierPhone}?text=${encodeURIComponent(
    `السلام عليكم، شفت منتج "${product.name}" على Jomla.ma، بغيت نسول على ثمن الجملة (الحد الأدنى: ${moqText}). هل متوفر؟`
  )}`

  return (
    <div
      onClick={() => onView && onView(product._id)}
      style={{
        background: 'white',
        borderRadius: '12px',
        padding: '16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        border: '1px solid #eee',
        direction: 'rtl',
        cursor: 'pointer',
        transition: 'transform 0.2s',
        fontFamily: "'Cairo', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between'
      }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              color: '#1D9E75',
              fontWeight: '600',
              background: '#E1F5EE',
              padding: '2px 8px',
              borderRadius: '20px'
            }}
          >
            {product.category}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: '#B45309',
              background: '#FEF3C7',
              padding: '2px 8px',
              borderRadius: '20px',
              fontWeight: '600'
            }}
          >
            📦 أقل طلب: {moqText}
          </span>
        </div>

        {product.imageUrl && (
          <div style={{ width: '100%', height: '140px', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px' }}>
            <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}

        <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#1a1a1a', fontWeight: '600' }}>
          {product.name}
        </h3>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px' }}>
          <div>
            <span style={{ fontSize: '18px', fontWeight: '700', color: '#E85D24' }}>
              {product.price} درهم
            </span>
            <span style={{ fontSize: '12px', color: '#666', marginRight: '4px' }}>
              / {product.unit || 'قطعة'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>📍 {product.city}</span>
            {product.avgStars > 0 && (
              <span style={{ fontSize: '12px', color: '#EF9F27' }}>
                {'★'.repeat(Math.round(product.avgStars))} {product.avgStars}
              </span>
            )}
          </div>
        </div>

        {/* أسعار الكميات (Tiered Pricing) */}
        {product.priceTiers && product.priceTiers.length > 0 && (
          <div style={{ marginTop: '8px', padding: '6px 8px', background: '#F8FAFC', borderRadius: '6px', fontSize: '11px', color: '#475569' }}>
            <div style={{ fontWeight: '600', marginBottom: '2px' }}>🏷️ أسعار الجملة حسب الكمية:</div>
            {product.priceTiers.slice(0, 2).map((tier, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{tier.minQty}{tier.maxQty ? ` - ${tier.maxQty}` : '+'} {product.unit || 'قطعة'}:</span>
                <span style={{ fontWeight: '700', color: '#0F766E' }}>{tier.price} درهم</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: '14px' }} onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setShowRFQ(true)}
          style={{
            width: '100%',
            padding: '9px',
            background: '#0F766E',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '700',
            marginBottom: '8px',
            fontFamily: "'Cairo', sans-serif",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          📄 طلب عرض سعر رسمي (RFQ)
        </button>

        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1,
              padding: '8px',
              background: '#25D366',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              textAlign: 'center',
              textDecoration: 'none'
            }}
          >
            💬 واتساب
          </a>
          <button
            onClick={() => onViewSupplier(product.supplierId)}
            style={{
              flex: 1,
              padding: '8px',
              background: '#E6F1FB',
              color: '#185FA5',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              fontFamily: "'Cairo', sans-serif"
            }}
          >
            🏪 المتجر
          </button>
        </div>
      </div>

      {showRFQ && (
        <RFQModal
          product={product}
          onClose={() => setShowRFQ(false)}
        />
      )}
    </div>
  )
}
