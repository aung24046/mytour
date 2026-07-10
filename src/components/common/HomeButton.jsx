import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// ปุ่ม "หน้าหลัก" แบบลอย เห็นชัดทุกหน้า ใช้ง่ายทั้งเด็กและผู้ใหญ่
// - ฝั่ง staff (หน้าย่อย) → กลับไป /staff
// - ฝั่งลูกทัวร์ (หน้าที่ไม่มีแถบเมนูล่าง เช่น หน้ากระเป๋า) → กลับไป /
// หน้าที่ซ่อนปุ่ม: หน้าหลักอยู่แล้ว, หน้า login, และหน้าที่มีแถบเมนูล่าง (มีปุ่มหน้าหลักในนั้นแล้ว)
const HIDE_ON = [
  '/',
  '/itinerary',
  '/my-qr',
  '/my-room',
  '/bingo',
  '/share-location',
  '/staff',
  '/staff/login',
]

export default function HomeButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()

  if (HIDE_ON.includes(pathname)) return null

  const target = pathname.startsWith('/staff') ? '/staff' : '/'

  return (
    <button
      onClick={() => navigate(target)}
      aria-label={t('common.home')}
      className="fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-pill bg-white/90 px-4 py-3 text-sm font-bold text-brand shadow-card-hover ring-1 ring-black/5 backdrop-blur transition active:scale-95 hover:bg-white"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <Icon name="home" size={16} filled interactive />
      {t('common.home')}
    </button>
  )
}
