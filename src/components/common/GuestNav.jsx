import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

const ITEMS = [
  { to: '/', key: 'home', icon: 'home', labelKey: 'guest.nav.home' },
  { to: '/itinerary', key: 'itinerary', icon: 'map', labelKey: 'guest.nav.itinerary' },
  { to: '/my-qr', key: 'myQr', icon: 'ticket', labelKey: 'guest.nav.myQr' },
  { to: '/my-room', key: 'myRoom', icon: 'bed', labelKey: 'guest.nav.myRoom' },
  { to: '/bingo', key: 'bingo', icon: 'target', labelKey: 'guest.nav.bingo' },
  { to: '/share-location', key: 'shareLocation', icon: 'location', labelKey: 'guest.nav.shareLocation' },
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
              <span className={`flex h-9 w-full max-w-[3.25rem] items-center justify-center rounded-[10px] transition-all ${
                isActive ? 'scale-105 bg-brand-light text-brand-hover' : 'text-ink-muted opacity-80 group-hover:text-brand group-hover:opacity-100'
              }`}>
                <Icon name={item.icon} size={22} filled={isActive} interactive />
              </span>
              <span className={`text-[11px] font-semibold leading-tight ${
                isActive ? 'text-brand-hover' : 'text-ink-muted'
              }`}>
                {t(item.labelKey)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
