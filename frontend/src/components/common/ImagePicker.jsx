import { useState, useEffect, useCallback } from 'react'
import { API } from '../../api/config'

export default function ImagePicker({ productName, category, onSelect, onClose }) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const searchImages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/product-ai/search-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName, category })
      })
      const data = await res.json()
      setImages(data.images || [])
    } catch {
      setImages([])
    } finally {
      setLoading(false)
    }
  }, [productName, category])

  useEffect(() => {
    searchImages()
  }, [searchImages])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          direction: 'rtl',
          fontFamily: "'Cairo', sans-serif"
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>🔍 اختار صورة احترافية</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#888'
            }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            ⏳ AI كيبحث على صور احترافية...
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {images.map((img, i) => (
                <div
                  key={i}
                  onClick={() => setSelected(img.url)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    border: selected === img.url ? '3px solid #C1272D' : '3px solid transparent',
                    transition: 'border 0.2s'
                  }}
                >
                  <img src={img.thumb} alt="" style={{ width: '100%', height: '100px', objectFit: 'cover' }} />
                  <div
                    style={{
                      fontSize: '10px',
                      color: '#aaa',
                      padding: '2px 4px',
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    📷 {img.credit}
                  </div>
                </div>
              ))}
            </div>

            {images.length === 0 && (
              <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
                ما لقيناش صور — جرب اسم منتج آخر
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => selected && onSelect(selected)}
                disabled={!selected}
                style={{
                  flex: 1,
                  padding: '11px',
                  background: selected ? '#C1272D' : '#ddd',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: selected ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  fontWeight: '600',
                  fontFamily: "'Cairo', sans-serif"
                }}
              >
                ✅ اختار هاد الصورة
              </button>
              <button
                onClick={searchImages}
                style={{
                  padding: '11px 16px',
                  background: '#E6F1FB',
                  color: '#185FA5',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontFamily: "'Cairo', sans-serif"
                }}
              >
                🔄 بحث جديد
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
