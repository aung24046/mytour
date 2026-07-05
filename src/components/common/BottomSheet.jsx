export default function BottomSheet({ open, onClose, title, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* แก้บั๊ก "ปุ่ม home บัง" รอบ 2 — สาเหตุจริงคือปุ่มลอย HomeButton (fixed bottom-4 left-4)
          มี z-40 ซึ่งสูงกว่า BottomSheet เดิม (z-20) ทำให้ปุ่ม Home ลอยทับอยู่บนมุมล่างซ้ายของ
          sheet เสมอ บังช่องกรอกชื่อที่ปักอยู่ด้านล่าง จึงยกระดับ z-index ของ sheet ทั้งก้อนให้สูง
          กว่าทุกปุ่มลอยในแอป (z-50) sheet จะได้อยู่บนสุดเสมอเวลาเปิดใช้งาน */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-[1.75rem] border-t border-white/60 bg-surface px-5 pt-5 shadow-2xl animate-[sheet_0.22s_ease-out]"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-pill bg-neutral-bg" />
        {title && (
          <h2 className="mb-4 text-lg font-bold text-ink">{title}</h2>
        )}
        {children}
      </div>
    </div>
  )
}
