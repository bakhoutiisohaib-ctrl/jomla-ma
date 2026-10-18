import React, { useEffect, useState } from 'react'

export default function SupplierProfile() {
  const [profile, setProfile] = useState(null)
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [analysis, setAnalysis] = useState([])
  const [filtered, setFiltered] = useState([])
  const [filterCategory, setFilterCategory] = useState('')
  const [sortKey, setSortKey] = useState('gap')
  const [sortDir, setSortDir] = useState('desc')
  const [fileList, setFileList] = useState([])
  const [form, setForm] = useState({ name: '', price: '', category: '', city: '', description: '' })

  const token = localStorage.getItem('supplierToken')
  const api = (path) => `/api/suppliers${path}`

  useEffect(() => {
    fetchProfile()
    fetchProducts()
    fetchReviews()
    fetchAnalysis()
  }, [])

  function authHeaders() {
    return { Authorization: `Bearer ${token}` }
  }

  async function fetchProfile() {
    const res = await fetch(api('/me/profile'), { headers: authHeaders() })
    if (res.ok) setProfile(await res.json())
  }

  async function fetchProducts() {
    const res = await fetch(api('/me/products?page=1&limit=20'), { headers: authHeaders() })
    if (res.ok) {
      const data = await res.json()
      setProducts(data.items || data)
    }
  }

  async function fetchReviews() {
    const res = await fetch(api('/me/reviews'), { headers: authHeaders() })
    if (res.ok) {
      const data = await res.json()
      setReviews(data.items || data)
    }
  }

  async function fetchAnalysis() {
    const res = await fetch(api('/me/analytics/details'), { headers: authHeaders() })
    if (res.ok) {
      const data = await res.json()
      const list = data.analysis || []
      setAnalysis(list)
      setFiltered(list)
    }
  }

  // apply filter & sort
  function applyFilterSort(list = analysis) {
    let out = list.slice()
    if (filterCategory) out = out.filter(a => a.category === filterCategory)
    out.sort((a,b) => {
      const aVal = sortKey === 'gap' ? (a.gapPercentage||0) : (a[sortKey]||0)
      const bVal = sortKey === 'gap' ? (b.gapPercentage||0) : (b[sortKey]||0)
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })
    setFiltered(out)
  }

  // when filter/sort changes
  React.useEffect(()=> applyFilterSort(), [filterCategory, sortKey, sortDir, analysis])

  function downloadCSV() {
    if (!filtered.length) return alert('لا توجد بيانات للتحميل')
    const rows = [ ['category','supplierAvg','marketAvg','gapPercentage','supplierCount','marketCount'] ]
    filtered.forEach(r => rows.push([r.category, r.supplierAvg, r.marketAvg, r.gapPercentage, r.supplierCount, r.marketCount]))
    const csv = rows.map(r => r.map(v => typeof v === 'string' ? '"'+v.replace(/"/g,'""')+'"' : v).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'analysis.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadAllCSV() {
    if (!analysis.length) return alert('لا توجد بيانات للتحميل')
    const rows = [ ['category','supplierAvg','marketAvg','gapPercentage','supplierCount','marketCount'] ]
    analysis.forEach(r => rows.push([r.category, r.supplierAvg, r.marketAvg, r.gapPercentage, r.supplierCount, r.marketCount]))
    const csv = rows.map(r => r.map(v => typeof v === 'string' ? '"'+v.replace(/"/g,'""')+'"' : v).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'analysis_all.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFiles(e) {
    setFileList(Array.from(e.target.files))
  }

  async function submitProduct(e) {
    e.preventDefault()
    const fd = new FormData()
    fd.append('name', form.name)
    fd.append('price', form.price)
    fd.append('category', form.category)
    fd.append('city', form.city)
    fd.append('description', form.description)
    fileList.forEach(f => fd.append('images', f))

    const res = await fetch(api('/me/products'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    })

    if (res.ok) {
      alert('تم إضافة المنتج')
      setForm({ name: '', price: '', category: '', city: '', description: '' })
      setFileList([])
      fetchProducts()
    } else {
      const err = await res.json()
      alert('خطأ: ' + (err.message || res.statusText))
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: 'Arial' }}>
      <h2>لوحة البائع</h2>
      {profile && (
        <div style={{ marginBottom: 20 }}>
          <h3>{profile.name}</h3>
          <div>المدينة: {profile.city}</div>
          <div>الهاتف: {profile.phone}</div>
        </div>
      )}

      <section>
        <h3>إضافة منتج جديد</h3>
        <form onSubmit={submitProduct}>
          <input placeholder="اسم المنتج" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /> <br/>
          <input placeholder="السعر" value={form.price} onChange={e => setForm({...form, price: e.target.value})} required /> <br/>
          <input placeholder="الفئة" value={form.category} onChange={e => setForm({...form, category: e.target.value})} /> <br/>
          <input placeholder="المدينة" value={form.city} onChange={e => setForm({...form, city: e.target.value})} /> <br/>
          <textarea placeholder="الوصف" value={form.description} onChange={e => setForm({...form, description: e.target.value})}></textarea> <br/>
          <input type="file" multiple onChange={handleFiles} accept="image/*" /> <br/>
          <button type="submit">إضافة</button>
        </form>
      </section>

      <section>
        <h3>منتجاتي</h3>
        <ul>
          {products.map(p => (
            <li key={p._id} style={{ marginBottom: 8 }}>
              <strong>{p.name}</strong> — {p.category} — {p.price} د.م<br/>
              {p.imageUrl && <img src={p.imageUrl} alt="img" style={{ height: 60 }} />}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>تحليل السوق</h3>
        {analysis.length === 0 && <div>لا توجد بيانات تحليلية</div>}
        {analysis.length > 0 && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <label>تصفية بالفئة: </label>
              <select value={filterCategory} onChange={e=>setFilterCategory(e.target.value)}>
                <option value=''>الكل</option>
                {Array.from(new Set(analysis.map(a=>a.category))).map(c=> <option key={c} value={c}>{c}</option>)}
              </select>

              <label style={{ marginLeft: 12 }}>ترتيب حسب: </label>
              <select value={sortKey} onChange={e=>setSortKey(e.target.value)}>
                <option value='gap'>فجوة %</option>
                <option value='supplierAvg'>متوسط المورد</option>
                <option value='marketAvg'>متوسط السوق</option>
              </select>
              <select value={sortDir} onChange={e=>setSortDir(e.target.value)}>
                <option value='desc'>تنازلي</option>
                <option value='asc'>تصاعدي</option>
              </select>

              <button style={{ marginLeft: 12 }} onClick={downloadCSV}>تحميل CSV (المصفاة)</button>
              <button style={{ marginLeft: 8 }} onClick={downloadAllCSV}>تحميل CSV (الكل)</button>
            </div>

            <table style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #ccc', padding: 6 }}>الفئة</th>
                  <th style={{ border: '1px solid #ccc', padding: 6 }}>متوسط المورد</th>
                  <th style={{ border: '1px solid #ccc', padding: 6 }}>متوسط السوق</th>
                  <th style={{ border: '1px solid #ccc', padding: 6 }}>فجوة %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.category}>
                    <td style={{ border: '1px solid #ccc', padding: 6 }}>{a.category}</td>
                    <td style={{ border: '1px solid #ccc', padding: 6 }}>{a.supplierAvg ? a.supplierAvg.toFixed(2) : '-'}</td>
                    <td style={{ border: '1px solid #ccc', padding: 6 }}>{a.marketAvg ? a.marketAvg.toFixed(2) : '-'}</td>
                    <td style={{ border: '1px solid #ccc', padding: 6 }}>{a.gapPercentage !== null && a.gapPercentage !== undefined ? a.gapPercentage.toFixed(1) + '%' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <h4>معاينة الصفوف المحددة</h4>
              {filtered.length === 0 && <div>لا توجد صفوف لعرضها</div>}
              {filtered.length > 0 && (
                <ul>
                  {filtered.map(r => (
                    <li key={r.category}>{r.category}: المورد {r.supplierAvg ? r.supplierAvg.toFixed(2) : '-'} — السوق {r.marketAvg ? r.marketAvg.toFixed(2) : '-'} — فجوة {r.gapPercentage !== null && r.gapPercentage !== undefined ? r.gapPercentage.toFixed(1)+'%' : '-'}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section>
        <h3>التعليقات</h3>
        <ul>
          {reviews.map(r => (
            <li key={r._id} style={{ marginBottom: 8 }}>
              <strong>{r.userName || 'مستخدم'}</strong> — {r.stars}⭐<br/>
              {r.comment}<br/>
              {r.reply && (<div style={{ marginTop: 6, color: 'green' }}>ردك: {r.reply.text}</div>)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
