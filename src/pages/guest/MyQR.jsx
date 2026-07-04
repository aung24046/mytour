import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'

import { supabase } from '../../lib/supabase'
import { getGuestId } from '../../lib/guestSession'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import GuestNav from '../../components/common/GuestNav'

export default function MyQR() {
  const { t } = useTranslation()

  const [guest, setGuest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function loadGuest() {
      setLoading(true)
      setError(null)

      const guestId = getGuestId()
      if (!guestId) {
        setError('no-session')
        setLoading(false)
        return
      }

      const { data, error: fetchError } = await supabase
        .from('guests')
        .select('id, name, nickname, qr_token, check_in_status')
        .eq('id', guestId)
        .single()

      if (!isMounted) return

      if (fetchError) {
        console.error('[MyQR] load failed', fetchError)
        setError('load-error')
      } else {
        setGuest(data)
      }
      setLoading(false)
    }

    loadGuest()
    return () => {
      isMounted = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <AnnouncementBanner />
      <div className="p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 text-xl font-bold text-gray-900">
          {t('guest.myQr.title')}
        </h1>

        <GuestNav active="myQr" />

        <Card className="text-center">
          {loading && <p className="text-gray-500">{t('common.loading')}</p>}

          {error === 'no-session' && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-gray-600">{t('guest.myQr.noSession')}</p>
              <Link to="/" className="w-full">
                <Button>{t('guest.register.title')}</Button>
              </Link>
            </div>
          )}

          {error === 'load-error' && (
            <p className="text-red-500">{t('common.error')}</p>
          )}

          {!loading && !error && guest && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                <QRCodeSVG value={guest.qr_token} size={220} />
              </div>

              <div>
                <p className="text-lg font-semibold text-gray-900">
                  {guest.nickname || guest.name}
                </p>
                {guest.nickname && (
                  <p className="text-sm text-gray-500">{guest.name}</p>
                )}
              </div>

              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  guest.check_in_status
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {guest.check_in_status
                  ? t('staff.checkIn.arrived')
                  : t('staff.checkIn.notArrived')}
              </span>
            </div>
          )}
        </Card>
      </div>
      </div>
    </div>
  )
}
