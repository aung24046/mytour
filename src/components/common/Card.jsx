// การ์ดพื้นฐานที่ใช้ทั่วทั้งแอป
//
// ประวัติการแก้ (ส.ค. 2569):
//   - เดิมมี `border-line` ซึ่งมองไม่เห็นบนพื้นขาว แต่กลายเป็นเส้นสว่าง
//     รอบการ์ดดำทันทีที่เปิดโหมดมืด → เปลี่ยนเป็น token `border-line`
//   - เดิมซ้อน `ring-1 ring-line-subtle` ทับ border อีกชั้น ทั้งที่แทบมองไม่เห็น
//     และไม่ตามธีม → ตัดออก ความลึกมาจากเส้นขอบอย่างเดียว
//   - เดิมเงา hover เขียนค่าเองเป็น `shadow-[0_2px_0_rgba(...)]` ซึ่งข้าม token
//     → ใช้ shadow-card / shadow-card-hover ที่คุมจากที่เดียว
export default function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div
      className={`rounded-card border border-line bg-surface p-4 shadow-card ${
        hover ? 'transition-shadow hover:shadow-card-hover' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
