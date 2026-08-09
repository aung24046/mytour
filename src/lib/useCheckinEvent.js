// useCheckinEvent — ลอจิกเช็คชื่อทั้งหมดอยู่ที่นี่ที่เดียว
//
// ทำไมต้องรวม: หน้าเช็คชื่อ / ผังที่นั่ง / แดชบอร์ด ต่างก็ต้องรู้ว่า "จุดไหนกำลังทำอยู่"
// และ "ใครเช็คแล้ว" ถ้าแต่ละหน้าเขียนเอง สักพักจะเพี้ยนออกจากกัน โดยเฉพาะ optimistic update
// กับคิวออฟไลน์ ซึ่งเป็นบั๊กที่หายากที่สุด
//
// โครงข้อมูล 2 แบบ (ตามของเดิม ไม่ได้เปลี่ยน schema):
//   - จุดหลัก (is_core)  → guests.check_in_status + guests.check_in_time
//   - จุดอื่นๆ           → แถวใน checkin_records (event_id, guest_id)
//
// ออฟไลน์: รองรับทั้งสองแบบแล้ว ผ่าน offlineQueue
//   type 'checkin'         → update guests (เขียนทับค่าล่าสุด = replay ซ้ำได้)
//   type 'checkin_record'  → upsert/delete checkin_records
//     upsert อาศัย unique index (event_id, guest_id) + ignoreDuplicates → replay ซ้ำได้เช่นกัน
//   dedupeKey ของ record = `${eventId}:${guestId}` — ติ๊กแล้วยกเลิกซ้ำๆ ตอนออฟไลน์
//   จะเหลือ action สุดท้ายอันเดียว ไม่ยิงสวนกันตอน sync

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { supabase } from './supabase'
import { enqueue, getQueue, removeFromQueue } from './offlineQueue'
import {
  getSelectedCheckinEventId,
  setSelectedCheckinEventId,
  subscribeSelectedCheckinEvent,
  resolveCheckinEventId,
} from './checkinEvent'

const QUEUE_TYPES = ['checkin', 'checkin_record']

function isOnlineNow() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

export function countPendingCheckins() {
  return getQueue().filter((a) => QUEUE_TYPES.includes(a.type)).length
}

/** ส่งคิวที่ค้างขึ้น Supabase — เรียกได้จากทุกหน้า ปลอดภัยถ้าเรียกซ้อนกัน */
export async function flushCheckinQueue() {
  const queue = getQueue().filter((a) => QUEUE_TYPES.includes(a.type))

  for (const action of queue) {
    let error = null

    if (action.type === 'checkin') {
      ;({ error } = await supabase
        .from('guests')
        .update({ check_in_status: action.status, check_in_time: action.checkInTime })
        .eq('id', action.guestId))
    } else if (action.checked) {
      ;({ error } = await supabase.from('checkin_records').upsert(
        {
          event_id: action.eventId,
          guest_id: action.guestId,
          checked_in_at: action.checkedInAt,
        },
        { onConflict: 'event_id,guest_id', ignoreDuplicates: true }
      ))
    } else {
      ;({ error } = await supabase
        .from('checkin_records')
        .delete()
        .eq('event_id', action.eventId)
        .eq('guest_id', action.guestId))
    }

    if (error) {
      console.error('[checkin] sync คิวไม่สำเร็จ — จะลองใหม่รอบหน้า', action.type, error)
    } else {
      removeFromQueue(action.id)
    }
  }

  return countPendingCheckins()
}

/**
 * @param tourId
 * @param options.guests    รายชื่อลูกทัวร์ของหน้านั้น (ต้องมี id + check_in_status)
 * @param options.setGuests setter ของ state เดียวกัน — ใช้ทำ optimistic update ตอนจุดหลัก
 */
export function useCheckinEvent(tourId, { guests = [], setGuests } = {}) {
  const [events, setEvents] = useState([])
  const [itineraryItems, setItineraryItems] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(() => getSelectedCheckinEventId(tourId))
  const [eventRecords, setEventRecords] = useState([])
  const [togglingId, setTogglingId] = useState(null)
  const [pendingCount, setPendingCount] = useState(() => countPendingCheckins())
  const [isOnline, setIsOnline] = useState(isOnlineNow)

  // ใช้ใน callback ที่ไม่อยากผูก dependency (กัน stale closure แบบเงียบๆ)
  const setGuestsRef = useRef(setGuests)
  setGuestsRef.current = setGuests

  const refreshPending = useCallback(() => {
    setPendingCount(countPendingCheckins())
  }, [])

  const flush = useCallback(async () => {
    const left = await flushCheckinQueue()
    setPendingCount(left)
  }, [])

  const loadEvents = useCallback(async () => {
    const [eventsRes, itemsRes] = await Promise.all([
      supabase
        .from('checkin_events')
        .select('id, title, is_core, itinerary_item_id, sort_order')
        .eq('tour_id', tourId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('itinerary_items')
        .select('id, day_number, scheduled_time, title, location_name')
        .eq('tour_id', tourId)
        .order('day_number', { ascending: true })
        .order('sort_order', { ascending: true }),
    ])

    if (eventsRes.data) {
      setEvents(eventsRes.data)
      setSelectedEventId((prev) =>
        resolveCheckinEventId(eventsRes.data, prev ?? getSelectedCheckinEventId(tourId))
      )
    }
    if (itemsRes.data) setItineraryItems(itemsRes.data)
  }, [tourId])

  // โหลดรายการจุด + ตามการเปลี่ยนแปลงจากเครื่องอื่น
  useEffect(() => {
    loadEvents()

    const channel = supabase
      .channel(`checkin-events-${tourId}-${Math.random().toString(36).slice(2, 9)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checkin_events', filter: `tour_id=eq.${tourId}` },
        () => loadEvents()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tourId, loadEvents])

  // จำจุดที่เลือก + ฟังการเปลี่ยนจากหน้าอื่น/แท็บอื่น
  useEffect(() => {
    return subscribeSelectedCheckinEvent(tourId, (eventId) => {
      if (eventId) setSelectedEventId(eventId)
    })
  }, [tourId])

  useEffect(() => {
    if (selectedEventId && selectedEventId !== getSelectedCheckinEventId(tourId)) {
      setSelectedCheckinEventId(tourId, selectedEventId)
    }
  }, [selectedEventId, tourId])

  const selectEvent = useCallback(
    (eventId) => {
      setSelectedEventId(eventId)
      setSelectedCheckinEventId(tourId, eventId)
    },
    [tourId]
  )

  const selectedEvent = useMemo(
    () => events.find((ev) => ev.id === selectedEventId) ?? null,
    [events, selectedEventId]
  )
  // ก่อนโหลดเสร็จถือว่าเป็นจุดหลักไปก่อน — ตรงกับพฤติกรรมเดิม
  const isCoreEvent = selectedEvent ? selectedEvent.is_core : true

  // โหลด/subscribe checkin_records เฉพาะตอนเลือกจุดที่ไม่ใช่จุดหลัก
  useEffect(() => {
    if (!selectedEventId || isCoreEvent) {
      setEventRecords([])
      return
    }

    let isMounted = true

    async function loadRecords() {
      const { data, error } = await supabase
        .from('checkin_records')
        .select('id, guest_id, checked_in_at')
        .eq('event_id', selectedEventId)

      if (isMounted && !error) setEventRecords(data ?? [])
    }

    loadRecords()

    const channel = supabase
      .channel(`checkin-records-${selectedEventId}-${Math.random().toString(36).slice(2, 9)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'checkin_records',
          filter: `event_id=eq.${selectedEventId}`,
        },
        () => loadRecords()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') loadRecords()
      })

    function handleVisibility() {
      if (document.visibilityState === 'visible') loadRecords()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [selectedEventId, isCoreEvent])

  // เน็ตกลับมา → ส่งคิวที่ค้าง
  useEffect(() => {
    refreshPending()
    flush()

    function handleOnline() {
      setIsOnline(true)
      flush()
    }
    function handleOffline() {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // บาง browser ไม่ยิง online/offline แม่นยำ — ลองเป็นระยะด้วย
    const retry = setInterval(() => {
      if (isOnlineNow()) flush()
    }, 15000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(retry)
    }
  }, [flush, refreshPending])

  const checkedInGuestIds = useMemo(
    () => new Set(eventRecords.map((r) => r.guest_id)),
    [eventRecords]
  )

  const isCheckedIn = useCallback(
    (guest) => {
      if (!guest) return false
      return isCoreEvent ? !!guest.check_in_status : checkedInGuestIds.has(guest.id)
    },
    [isCoreEvent, checkedInGuestIds]
  )

  async function toggleCore(guest) {
    const nextStatus = !guest.check_in_status
    const checkInTime = nextStatus ? new Date().toISOString() : null

    // optimistic — ติ๊กได้ทันทีไม่ว่าจะออนไลน์หรือไม่
    setGuestsRef.current?.((prev) =>
      prev.map((g) =>
        g.id === guest.id ? { ...g, check_in_status: nextStatus, check_in_time: checkInTime } : g
      )
    )

    if (!isOnlineNow()) {
      enqueue({ type: 'checkin', guestId: guest.id, status: nextStatus, checkInTime })
      refreshPending()
      return nextStatus
    }

    const { error } = await supabase
      .from('guests')
      .update({ check_in_status: nextStatus, check_in_time: checkInTime })
      .eq('id', guest.id)

    if (error) {
      console.error('[checkin] toggle จุดหลักไม่สำเร็จ — เข้าคิวไว้', error)
      enqueue({ type: 'checkin', guestId: guest.id, status: nextStatus, checkInTime })
      refreshPending()
    }
    return nextStatus
  }

  async function toggleRecord(guest) {
    const currentlyIn = checkedInGuestIds.has(guest.id)
    const checkedInAt = new Date().toISOString()
    const eventId = selectedEventId

    // optimistic ทั้งสองทาง
    if (currentlyIn) {
      setEventRecords((prev) => prev.filter((r) => r.guest_id !== guest.id))
    } else {
      setEventRecords((prev) => [
        ...prev,
        { id: `local-${eventId}-${guest.id}`, guest_id: guest.id, checked_in_at: checkedInAt },
      ])
    }

    const action = {
      type: 'checkin_record',
      dedupeKey: `${eventId}:${guest.id}`,
      eventId,
      guestId: guest.id,
      checked: !currentlyIn,
      checkedInAt,
    }

    if (!isOnlineNow()) {
      enqueue(action)
      refreshPending()
      return !currentlyIn
    }

    const { error } = currentlyIn
      ? await supabase
          .from('checkin_records')
          .delete()
          .eq('event_id', eventId)
          .eq('guest_id', guest.id)
      : await supabase
          .from('checkin_records')
          .upsert(
            { event_id: eventId, guest_id: guest.id, checked_in_at: checkedInAt },
            { onConflict: 'event_id,guest_id', ignoreDuplicates: true }
          )

    if (error) {
      console.error('[checkin] toggle จุดย่อยไม่สำเร็จ — เข้าคิวไว้', error)
      enqueue(action)
      refreshPending()
    }
    return !currentlyIn
  }

  /** ติ๊ก/ยกเลิกคนหนึ่งคนที่จุดที่เลือกอยู่ — คืนสถานะใหม่ (true = เช็คแล้ว) */
  const toggle = useCallback(
    async (guest) => {
      if (!guest) return false
      setTogglingId(guest.id)
      try {
        return isCoreEvent ? await toggleCore(guest) : await toggleRecord(guest)
      } finally {
        setTogglingId(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    , [isCoreEvent, selectedEventId, checkedInGuestIds]
  )

  /** สร้างจุดใหม่ (จากแผนการเดินทางหรือกำหนดเอง) แล้วสลับไปจุดนั้นเลย */
  const createEvent = useCallback(
    async ({ title, itineraryItemId = null }) => {
      const clean = (title ?? '').trim()
      if (!clean) return { error: new Error('title ว่าง') }

      const maxSort = events.reduce((max, ev) => Math.max(max, ev.sort_order ?? 0), 0)

      const { data, error } = await supabase
        .from('checkin_events')
        .insert({
          tour_id: tourId,
          itinerary_item_id: itineraryItemId,
          title: clean,
          is_core: false,
          sort_order: maxSort + 1,
        })
        .select('id, title, is_core, itinerary_item_id, sort_order')
        .single()

      if (error || !data) {
        console.error('[checkin] สร้างจุดไม่สำเร็จ', error)
        return { error }
      }

      setEvents((prev) => [...prev, data])
      selectEvent(data.id)
      return { data }
    },
    [events, tourId, selectEvent]
  )

  const checkedInCount = useMemo(() => {
    if (isCoreEvent) return guests.filter((g) => g.check_in_status).length
    // นับเฉพาะคนที่ยังอยู่ในรายชื่อจริง (เผื่อมีคนถูกลบออกจากทริป)
    const ids = new Set(guests.map((g) => g.id))
    let n = 0
    for (const id of checkedInGuestIds) if (ids.has(id)) n += 1
    return n
  }, [isCoreEvent, guests, checkedInGuestIds])

  return {
    events,
    itineraryItems,
    selectedEvent,
    selectedEventId,
    selectEvent,
    isCoreEvent,
    isCheckedIn,
    checkedInGuestIds,
    checkedInCount,
    toggle,
    togglingId,
    createEvent,
    reloadEvents: loadEvents,
    pendingCount,
    isOnline,
    flushQueue: flush,
  }
}
