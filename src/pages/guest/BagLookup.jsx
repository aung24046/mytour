import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import Card from '../../components/common/Card'

// หน้า public — ใครก็เข้าได้จากการสแกน QR บนกระเป๋า (อยู่ในที่สาธารณะ)
// ต้องโชว์แค่ "ชื่อเล่น + รูปกระเป๋า" พอให้คนอื่นรู้ว่าเป็นของใคร
// ห้ามโชว์ชื่อเต็ม/เบอร์โทร/ข้อมูลลงทะเบียนอื่นๆ เด็ดขาด (ตามที่ระบุในแผนงาน)
export default function BagLookup() {
  const { t } = useTranslation()
  const { tagCode } = useParams()

  const [bag, setBag] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function loadBag() {
      setLoading(true)
      setError(null)

      const { data: luggageRow, error: luggageError } = await supabase
        .from('luggage')
        .select('id, tag_code, guest_id, photo_url, status')
        .eq('tag_code', tagCode)
        .maybeSingle()

      if (!isMounted) return

      if (luggageError || !luggageRow) {
        setError('not-found')
        setLoading(false)
        return
      }

      if (!luggageRow.guest_id) {
        setError('unassigned')
        setLoading(false)
        return
      }

      // ตั้งใจเลือกแค่ nickname/name เพื่อไว้ fallback — ไม่ดึงเบอร์โทรหรือฟิลด์อื่นมาเลย
      const { data: guest, error: guestError } = await supabase
        .from('guests')
        .select('nickname, name')
        .eq('id', luggageRow.guest_id)
        .maybeSingle()

      if (!isMounted) return

      if (guestError || !guest) {
        setError('not-found')
        setLoading(false)
        return
      }

      setBag({
        photoUrl: luggageRow.photo_url,
        displayName: guest.nickname || guest.name,
        tagCode: luggageRow.tag_code,
      })
      setLoading(false)
    }

    loadBag()
    return () => {
      isMounted = false
    }
  }, [tagCode])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <Card className="text-center">
          {loading && <p className="text-gray-500">{t('common.loading')}</p>}

          {error === 'not-found' && (
            <p className="text-gray-600">{t('guest.bagLookup.notFound')}</p>
          )}

          {error === 'unassigned' && (
            <p className="text-gray-600">{t('guest.bagLookup.unassigned')}</p>
          )}

          {!loading && !error && bag && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm font-medium text-gray-400">{t('guest.bagLookup.title')}</p>

              {bag.photoUrl ? (
                <img
                  src={bag.photoUrl}
                  alt={bag.displayName}
                  className="h-48 w-48 rounded-2xl object-cover shadow-sm ring-1 ring-gray-100"
                />
              ) : (
                <div className="flex h-48 w-48 items-center justify-center rounded-2xl bg-gray-100 text-5xl">
                  🧳
                </div>
              )}

              <p className="text-2xl font-bold text-gray-900">{bag.displayName}</p>
              <p className="font-mono text-xs text-gray-400">{bag.tagCode}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
