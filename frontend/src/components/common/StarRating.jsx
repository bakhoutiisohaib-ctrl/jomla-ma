export default function StarRating({ value, onChange, readOnly }) {
  return (
    <div style={{ display:'flex', gap:'4px', direction:'ltr' }}>
      {[1, 2, 3, 4, 5].map(star => (
        <span
          key={star}
          onClick={() => !readOnly && onChange && onChange(star)}
          style={{
            fontSize: '22px',
            cursor: readOnly ? 'default' : 'pointer',
            color: star <= value ? '#EF9F27' : '#ddd',
            transition: 'color 0.1s'
          }}
        >
          ★
        </span>
      ))}
    </div>
  )
}
