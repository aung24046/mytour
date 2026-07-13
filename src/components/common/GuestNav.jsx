import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// แถบเมนูล่าง — QR ย้ายมาเป็นปุ่มวงกลม/สี่เหลี่ยมมนยกลอยกลางแถบ (สไตล์แอปเป๋าตัง)
const SIDE_ITEMS = {
  left: [
    { to: '/', key: 'home', icon: 'home', labelKey: 'guest.nav.home' },
    { to: '/itinerary', key: 'itinerary', icon: 'map', labelKey: 'guest.nav.itinerary' },
  ],
  right: [
    { to: '/my-room', key: 'myRoom', icon: 'bed', labelKey: 'guest.nav.myRoom' },
    { to: '/my-seat', key: 'mySeat', icon: 'seat', labelKey: 'guest.nav.mySeat' },
  ],
}

function NavItem({ item, active }) {
  const { t } = useTranslation()
  const isActive = active === item.key
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      className="group flex flex-1 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2"
    >
      <span
        className={`flex h-9 w-full max-w-[3.25rem] items-center justify-center rounded-[10px] transition-all ${
          isActive
            ? 'scale-105 bg-brand-light text-brand-hover'
            : 'text-ink-muted opacity-80 group-hover:text-brand group-hover:opacity-100'
        }`}
      >
        <Icon name={item.icon} size={22} filled={isActive} interactive />
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
}

export default function GuestNav({ active }) {
  const { t } = useTranslation()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/90 backdrop-blur-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="เมนูหลัก"
    >
      <div className="mx-auto flex max-w-md items-end">
        {SIDE_ITEMS.left.map((item) => (
          <NavItem key={item.key} item={item} active={active} />
        ))}

        {/* ปุ่ม QR เด่นตรงกลาง */}
        <Link
          to="/my-qr"
          aria-current={active === 'myQr' ? 'page' : undefined}
          className="flex flex-1 flex-col items-center"
        >
          <span className="-mt-7 flex h-[58px] w-[58px] items-center justify-center rounded-[20px] bg-brand-gradient text-white shadow-brand ring-4 ring-white transition active:scale-95">
            <Icon name="ticket" size={30} />
          </span>
          <span className="mt-0.5 pb-1.5 text-[11px] font-semibold leading-tight text-brand-hover">
            {t('guest.nav.myQr')}
          </span>
        </Link>

        {SIDE_ITEMS.right.map((item) => (
          <NavItem key={item.key} item={item} active={active} />
        ))}
      </div>
    </nav>
  )
}
