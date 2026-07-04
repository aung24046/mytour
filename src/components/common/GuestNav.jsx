import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const ITEMS = [
  { to: '/itinerary', key: 'itinerary', labelKey: 'guest.itinerary.title' },
  { to: '/my-qr', key: 'myQr', labelKey: 'guest.myQr.title' },
  { to: '/my-room', key: 'myRoom', labelKey: 'guest.myRoom.title' },
  { to: '/bingo', key: 'bingo', labelKey: 'guest.bingo.title' },
  { to: '/share-location', key: 'shareLocation', labelKey: 'guest.shareLocation.title' },
]

export default function GuestNav({ active }) {
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto">
      {ITEMS.map((item) => (
        <GuestNavLink key={item.key} item={item} isActive={active === item.key} />
      ))}
    </div>
  )
}

function GuestNavLink({ item, isActive }) {
  const { t } = useTranslation()
  return (
    <Link
      to={item.to}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
        isActive ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
      }`}
    >
      {t(item.labelKey)}
    </Link>
  )
}
