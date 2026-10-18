export default function ProductCard({ product, onViewSupplier, onView }) {
  const whatsapp = `https://wa.me/${product.supplierPhone}?text=${encodeURIComponent(`السلام عليكم، شفت منتج "${product.name}" على Jomla.ma، بغيت معلومات أكثر`)}`

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
        fontFamily: "'Cairo', sans-serif"
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
        {product.category}
      </div>

      {product.imageUrl && (
        <div style={{ width: '100%', height: '140px', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px' }}>
          <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#1a1a1a' }}>
        {product.name}
      </h3>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
        <span style={{ fontSize: '18px', fontWeight: '700', color: '#E85D24' }}>
          {product.price} درهم
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>{product.city}</span>
          {product.avgStars > 0 && (
            <span style={{ fontSize: '12px', color: '#EF9F27' }}>
              {'★'.repeat(Math.round(product.avgStars))} {product.avgStars}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }} onClick={e => e.stopPropagation()}>
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
            fontSize: '13px',
            fontWeight: '500',
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
            fontSize: '13px',
            fontWeight: '500',
            fontFamily: "'Cairo', sans-serif"
          }}
        >
          🏪 المتجر
        </button>
      </div>
    </div>
  )
}
