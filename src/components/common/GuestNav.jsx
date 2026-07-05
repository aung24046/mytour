import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

// แถบเมนูลูกทัวร์แบบติดด้านล่าง (bottom tab bar) — เห็นตลอดเวลา ไม่ต้องเลื่อน
// ไอคอนใหญ่ + ข้อความสั้น ใช้ง่ายทั้งเด็กและผู้ใหญ่ นิ้วโป้งกดถึงสะดวก
const ITEMS = [
  { to: '/', key: 'home', icon: '🏠', labelKey: 'guest.nav.home' },
  { to: '/itinerary', key: 'itinerary', icon: '🗺️', labelKey: 'guest.nav.itinerary' },
  { to: '/my-qr', key: 'myQr', icon: '🎫', labelKey: 'guest.nav.myQr' },
  { to: '/my-room', key: 'myRoom', icon: '🛏️', labelKey: 'guest.nav.myRoom' },
  { to: '/bingo', key: 'bingo', icon: '🎯', labelKey: 'guest.nav.bingo' },
  { to: '/share-location', key: 'shareLocation', icon: '📍', labelKey: 'guest.nav.shareLocation' },
]

export default function GuestNav({ active }) {
  const { t } = useTranslation()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/90 backdrop-blur-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="เมนูหลัก"
    >
      <div className="mx-auto flex max-w-md items-stretch">
        {ITEMS.map((item) => {
          const isActive = active === item.key
          return (
            <Link
              key={item.key}
              to={item.to}
              aria-current={isActive ? 'page' : undefined}
              className="group flex flex-1 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2"
            >
              <span
                className={`flex h-9 w-full max-w-[3.25rem] items-center justify-center rounded-pill text-2xl leading-none transition-all ${
                  isActive
                    ? 'bg-brand-light scale-105'
                    : 'grayscale-[35%] opacity-80 group-hover:opacity-100'
                }`}
              >
                {item.icon}
              </span>
              <span
                className={`text-[11px] font-semibold leading-tight ${
                  isActive ? 'text-brand-hover' : 'text-ink-muted'
                }`}
              >
                {t(item.labelKey)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
