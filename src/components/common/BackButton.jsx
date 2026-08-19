import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

// ปุ่มย้อนกลับหัวมุมซ้ายบน — ตัวเดียวกับที่ StaffHeader ใช้
//
// ทำไมต้องแยกออกมา: ฝั่งลูกทัวร์บางหน้า (ส่วนเกม) ไม่ได้ใช้ StaffHeader
// เดิมจึงต้องพึ่งปุ่มลอย "หน้าหลัก" มุมซ้ายล่าง ซึ่งไปทับแถบเมนูล่าง/ปุ่มในเกม
// ย้ายมาใช้ปุ่มย้อนกลับบนหัวเรื่องแทน ทางกลับจะได้หน้าตาเหมือนกันทั้งแอป
//
// วิธีใช้ — วางเป็นตัวแรกในแถวหัวเรื่อง แล้วให้ h1 อยู่ถัดไป:
//   <div className="flex items-center gap-2">
//     <BackButton to={tp('games')} />
//     <h1 className="text-2xl font-extrabold text-ink">…</h1>
//   </div>
export default function BackButton({ to, className = '' }) {
  const { t } = useTranslation()
  if (!to) return null

  return (
    <Link
      to={to}
      aria-label={t('common.back')}
      className={`no-print -ml-1.5 flex h-9 w-9 flex-none items-center justify-center rounded-full text-ink-muted transition active:scale-95 hover:bg-surface-sunken hover:text-ink print:hidden ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </Link>
  )
}
