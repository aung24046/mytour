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

  // ลูกทัวร์คนเดียวสามารถมีห้องพักได้หลายห้อง (คนละโรงแรม/คนละคืน) — เก็บเป็น array ของ "stays"
  // แต่ละ stay คือ { room, hotel, roommates } หนึ่งชุด
  const [stays, setStays] = useState([])
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

      // 1) หา room_id ทั้งหมดของฉันจาก room_assignments — แก้บั๊ก "ห้องที่สองไม่แสดง"
      // เดิมใช้ .maybeSingle() ซึ่งจะ error ทันทีถ้ามีมากกว่า 1 แถว (คนเดียวอยู่ได้หลายห้อง/หลายโรงแรม
      // ตามการแก้ไขฝั่ง staff ก่อนหน้านี้) ทำให้ query ล้มเหลวไปเข้าโหมด fallback/แคชเงียบๆ
      const { data: myAssignments, error: assignError } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('guest_id', guestId)

      if (!isMounted) return

      if (assignError || !myAssignments || myAssignments.length === 0) {
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setStays(cached)
          setUsingCache(true)
        }
        setLoading(false)
        return
      }

      const roomIds = [...new Set(myAssignments.map((a) => a.room_id))]

      // 2) โหลดข้อมูลห้องทั้งหมด + โรงแรมที่เกี่ยวข้อง + เพื่อนร่วมห้องของทุกห้อง
      const [roomsRes, allAssignmentsRes] = await Promise.all([
        supabase
          .from('hotel_rooms')
          .select('id, room_number, floor, room_type, max_guests, hotel_id')
          .in('id', roomIds),
        supabase
          .from('room_assignments')
          .select('room_id, guest_id, guests(id, name, nickname)')
          .in('room_id', roomIds),
      ])

      if (!isMounted) return

      if (roomsRes.error || !roomsRes.data) {
        setError(t('common.error'))
        setLoading(false)
        return
      }

      const hotelIds = [...new Set(roomsRes.data.map((r) => r.hotel_id).filter(Boolean))]
      let hotelsById = {}
      if (hotelIds.length > 0) {
        const { data: hotelsData } = await supabase
          .from('hotels')
          .select('id, name, check_in_date, check_out_date, general_info')
          .in('id', hotelIds)
        for (const h of hotelsData ?? []) hotelsById[h.id] = h
      }

      const assignmentsByRoom = {}
      for (const a of allAssignmentsRes.data ?? []) {
        if (!assignmentsByRoom[a.room_id]) assignmentsByRoom[a.room_id] = []
        assignmentsByRoom[a.room_id].push(a)
      }

      const nextStays = roomsRes.data
        .map((room) => ({
          room,
          hotel: room.hotel_id ? (hotelsById[room.hotel_id] ?? null) : null,
          roommates: (assignmentsByRoom[room.id] ?? [])
            .filter((a) => a.guest_id !== guestId)
            .map((a) => a.guests)
            .filter(Boolean),
        }))
        // เรียงตามวันเข้าพักก่อน-หลัง ให้ลูกทัวร์เห็นลำดับทริปถูกต้อง
        .sort((a, b) => {
          const dateA = a.hotel?.check_in_date ?? ''
          const dateB = b.hotel?.check_in_date ?? ''
          return dateA.localeCompare(dateB)
        })

      setStays(nextStays)
      setUsingCache(false)
      saveCache(CACHE_KEY, nextStays)
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
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <span aria-hidden="true">🛏️</span>{t('guest.myRoom.title')}
          </h1>

          <GuestNav active="myRoom" />

          {usingCache && (
            <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {t('guest.itinerary.usingCache')}
            </p>
          )}

          {loading && <p className="text-gray-500">{t('common.loading')}</p>}
          {error && <p className="text-red-500">{error}</p>}

          {!loading && !error && stays.length === 0 && (
            <p className="text-gray-500">{t('guest.myRoom.noRoom')}</p>
          )}

          {!loading && !error && stays.length > 0 && (
            <div className="flex flex-col gap-5">
              {stays.map(({ room, hotel, roommates }, index) => (
                <div key={room.id}>
                  {/* โชว์ชื่อโรงแรมเป็นหัวข้อกำกับไว้ก่อน เผื่อลูกทัวร์มีมากกว่า 1 ที่พักในทริปเดียว */}
                  {hotel && (
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {stays.length > 1 ? `${t('guest.myRoom.stayNumber', { number: index + 1 })} — ` : ''}
                      {hotel.name}
                    </p>
                  )}

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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
