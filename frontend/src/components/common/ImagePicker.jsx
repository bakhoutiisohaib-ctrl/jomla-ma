// Legacy entry point retained for callers; remote image providers cannot enforce
// draft privacy. ProductEditor performs the authenticated local upload instead.
export default function ImagePicker({ onClose }) {
  return <div className="modal-backdrop"><section className="modal-content" role="dialog" aria-modal="true" aria-label="صور المنتجات">
    <p>لحماية المسودات، ارفع صورة تملكها أو صورة مرخصة من محرر المنتج. البحث عن صور خارجية غير متاح.</p>
    <button type="button" onClick={onClose}>إغلاق</button>
  </section></div>;
}
