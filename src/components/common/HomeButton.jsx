import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// ปุ่ม "หน้าหลัก" แบบลอย เห็นชัดทุกหน้า ใช้ง่ายทั้งเด็กและผู้ใหญ่
// - ฝั่ง staff (หน้าย่อย) → กลับไป /staff
// - ฝั่งลูกทัวร์ (หน้าที่ไม่มีแถบเมนูล่าง เช่น หน้ากระเป๋า) → กลับไป /
// หน้าที่ซ่อนปุ่ม: หน้าหลักอยู่แล้ว, หน้า login, และหน้าที่มีแถบเมนูล่าง (มีปุ่มหน้าหลักในนั้นแล้ว)
// เทียบเป็น "หน้าอะไร" ไม่ใช่ path เต็ม เพราะหน้า guest มี prefix /t/:code แล้ว
const HIDE_GUEST_PAGES = [
  '', // หน้าแรกของทริป
  'itinerary',
  'my-qr',
  'my-room',
  'my-seat',
  'bingo',
  'share-location',
  'trip-guide',
  'feedback',
  'edit-profile',
  'sos',
]
const HIDE_EXACT = ['/', '/join', '/staff', '/staff/login']

export default function HomeButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()

  if (HIDE_EXACT.includes(pathname)) return null

  // /t/:code/<sub> → เอา <sub> มาเทียบ
  const tourMatch = /^\/t\/([^/]+)(?:\/(.*))?$/.exec(pathname)
  if (tourMatch && HIDE_GUEST_PAGES.includes(tourMatch[2] ?? '')) return null

  const target = pathname.startsWith('/staff')
    ? '/staff'
    : tourMatch
      ? `/t/${tourMatch[1]}`
      : '/'

  // no-print / print:hidden — ปุ่มลอยตัวนี้ถูกวางไว้ที่ App.jsx จึงอยู่นอก DocumentShell
  // กฎซ่อนตอนพิมพ์ใน printProfiles.js เอื้อมไม่ถึง ถ้าไม่ซ่อนเองจะติดไอคอนหน้าหลัก
  // ไปบนกระดาษทุกครั้งที่สั่งพิมพ์เอกสาร
  return (
    <button
      onClick={() => navigate(target)}
      aria-label={t('common.home')}
      className="no-print fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-pill bg-surface px-4 py-3 text-sm font-bold text-brand shadow-card-hover ring-1 ring-line-subtle backdrop-blur transition active:scale-95 hover:bg-surface print:hidden"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <Icon name="home" size={16} filled interactive />
      {t('common.home')}
    </button>
  )
}
