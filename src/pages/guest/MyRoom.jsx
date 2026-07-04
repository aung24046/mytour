import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import { saveCache, loadCache } from '../../lib/offlineCache'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import GuestNav from '../../components/common/GuestNav'

const ROOM_TYPE_LABELS = {
  single: 'roomTypeSingle',
  twin: 'roomTypeTwin',
  double: 'roomTypeDouble',
  triple: 'roomTypeTriple',
}

const CACHE_KEY = 'my_room'

export default function MyRoom() {
  const { t } = useTranslation()
  const guestId = getGuestId()

  const [room, setRoom] = useState(null)
  const [hotel, setHotel] = useState(null)
  const [roommates, setRoommates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadMyRoom() {
      setLoading(true)
      setError(null)

      if (!guestId) {
        setLoading(false)
        return
      }

      // 1) หา room_id ของฉันจาก room_assignments
      const { data: myAssignment, error: assignError } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('guest_id', guestId)
        .maybeSingle()

      if (!isMounted) return

      if (assignError || !myAssignment) {
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setRoom(cached.room)
          setHotel(cached.hotel)
          setRoommates(cached.roommates)
          setUsingCache(true)
        }
        setLoading(false)
        return
      }

      // 2) โหลดข้อมูลห้อง + โรงแรม + เพื่อนร่วมห้องทั้งหมด
      const [roomRes, allAssignmentsRes] = await Promise.all([
        supabase
          .from('hotel_rooms')
          .select('id, room_number, floor, room_type, max_guests, hotel_id')
          .eq('id', myAssignment.room_id)
          .maybeSingle(),
        supabase
          .from('room_assignments')
          .select('guest_id, guests(id, name, nickname)')
          .eq('room_id', myAssignment.room_id),
      ])

      if (!isMounted) return

      if (roomRes.error || !roomRes.data) {
        setError(t('common.error'))
        setLoading(false)
        return
      }

      let hotelData = null
      if (roomRes.data.hotel_id) {
        const { data: hotelRow } = await supabase
          .from('hotels')
          .select('id, name, check_in_date, check_out_date, general_info')
          .eq('id', roomRes.data.hotel_id)
          .maybeSingle()
        hotelData = hotelRow ?? null
      }

      const mates = (allAssignmentsRes.data ?? [])
        .filter((a) => a.guest_id !== guestId)
        .map((a) => a.guests)
        .filter(Boolean)

      setRoom(roomRes.data)
      setHotel(hotelData)
      setRoommates(mates)
      setUsingCache(false)
      saveCache(CACHE_KEY, { room: roomRes.data, hotel: hotelData, roommates: mates })
      setLoading(false)
    }

    loadMyRoom()

    const channel = supabase
      .channel(`my-room-${guestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_assignments' },
        () => loadMyRoom()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_rooms' },
        () => loadMyRoom()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotels' },
        () => loadMyRoom()
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, t])

  return (
    <div className="min-h-screen bg-gray-50">
      <AnnouncementBanner />
      <div className="p-4">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 text-xl font-bold text-gray-900">{t('guest.myRoom.title')}</h1>

          <GuestNav active="myRoom" />

          {usingCache && (
            <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {t('guest.itinerary.usingCache')}
            </p>
          )}

          {loading && <p className="text-gray-500">{t('common.loading')}</p>}
          {error && <p className="text-red-500">{error}</p>}

          {!loading && !error && !room && (
            <p className="text-gray-500">{t('guest.myRoom.noRoom')}</p>
          )}

          {!loading && !error && room && (
            <>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-xl font-bold text-sky-700">
                    {room.room_number || '—'}
                  </div>
                  <div>
                    <p className="text-lg font-bold text-gray-900">
                      {t('guest.myRoom.roomNumber', { number: room.room_number || '—' })}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t('guest.myRoom.floorLabel', { floor: room.floor || '—' })}
                      {' · '}
                      {t(`guest.myRoom.${ROOM_TYPE_LABELS[room.room_type] ?? 'roomTypeTwin'}`)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 border-t border-gray-100 pt-3">
                  <p className="mb-1.5 text-sm font-semibold text-gray-700">
                    {t('guest.myRoom.roommates')}
                  </p>
                  {roommates.length === 0 ? (
                    <p className="text-sm text-gray-400">{t('guest.myRoom.noRoommates')}</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {roommates.map((g) => (
                        <p key={g.id} className="text-sm text-gray-800">
                          {g.nickname || g.name}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              {hotel && (
                <Card className="mt-3">
                  <p className="font-semibold text-gray-900">{hotel.name}</p>
                  {(hotel.check_in_date || hotel.check_out_date) && (
                    <p className="mt-0.5 text-sm text-gray-500">
                      {hotel.check_in_date} → {hotel.check_out_date}
                    </p>
                  )}
                  {hotel.general_info && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
                      {hotel.general_info}
                    </p>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
