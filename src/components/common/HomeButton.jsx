import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import { resolveHomeButton } from '../../lib/homeButton'

// ปุ่ม "หน้าหลัก" แบบลอย — เหลือใช้เฉพาะหน้าที่ไม่มีทางกลับอื่นเลย (เช่น /bag/:tagCode)
// ฝั่งทีมงานใช้ StaffHeader แทนแล้ว ดูเงื่อนไขทั้งหมดที่ src/lib/homeButton.js
//
// ที่ว่างล่างจอสำหรับปุ่มนี้ App.jsx จองให้แล้ว — อย่าไปไล่ใส่ pb-28 รายหน้าอีก
export default function HomeButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const { visible, target } = resolveHomeButton(pathname)
  if (!visible) return null

  // no-print / print:hidden — ปุ่มลอยตัวนี้ถูกวางไว้ที่ App.jsx จึงอยู่นอก DocumentShell
  // กฎซ่อนตอนพิมพ์ใน printProfiles.js เอื้อมไม่ถึง ถ้าไม่ซ่อนเองจะติดไอคอนหน้าหลัก
  // ไปบนกระดาษทุกครั้งที่สั่งพิมพ์เอกสาร
  return (
    <button
      onClick={() => navigate(target)}
      aria-label={t('common.home')}
      className="no-print fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-pill bg-surface px-4 py-3 text-sm font-bold text-brand shadow-card-hover ring-1 ring-line-subtle backdrop-blur transition hover:bg-surface active:scale-95 print:hidden"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <Icon name="home" size={16} filled interactive />
      {t('common.home')}
    </button>
  )
}
