import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from './supabase'

// ติดตามห้องสุ่มหนึ่งห้องแบบเรียลไทม์ แล้วบอกว่า "ตอนนี้ควรเล่นอะไรอยู่"
//
// จอโปรเจกเตอร์กับมือถือลูกทัวร์ใช้ hook เดียวกัน จะได้เห็นรอบเดียวกันพร้อมกัน
// ตัวตัดสินว่า "มีรอบใหม่" คือ drawn_at ไม่ใช่ pending — เพราะทีมงานกด
// "ไม่อยู่ สุ่มใหม่" แล้ว pending เปลี่ยนคนแต่จำนวนเท่าเดิม ถ้าเทียบด้วย pending
// อย่างเดียวบางครั้งจะไม่รู้ว่าต้องเล่นอนิเมชันใหม่
//
// phase:
//   idle    — ยังไม่เคยสุ่ม หรือรอบก่อนจบไปแล้ว
//   drawing — กำลังเล่นอนิเมชัน (ยังไม่เฉลย)
//   reveal  — เฉลยผู้ชนะแล้ว

export const ROOM_COLS =
  'id, tour_id, name, filter_kind, filter_bus, custom_name, custom_ids, excluded_ids, nicknames, extras,' +
  ' checkin_only, no_repeat, need_confirm, use_prizes, draw_count, reveal_animation, stage_theme,' +
  ' round_no, round_seed, pending, pending_prize_id, drawn_at, current_prize_id, status'

export function useDrawRoom(tourId, roomId) {
  const [room, setRoom] = useState(null)
  const [prizes, setPrizes] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  const [phase, setPhase] = useState('idle')
  const [winners, setWinners] = useState([])
  const lastDrawRef = useRef(null)

  const applyRoom = useCallback((next) => {
    if (!next) return
    setRoom(next)

    const stamp = next.drawn_at ? `${next.round_no}:${next.drawn_at}` : null
    const list = next.pending ?? []

    if (stamp && list.length > 0 && stamp !== lastDrawRef.current) {
      // รอบใหม่ — เริ่มอนิเมชันพร้อมกันทุกจอ
      lastDrawRef.current = stamp
      setWinners(list)
      setPhase('drawing')
      return
    }

    if (list.length === 0 && lastDrawRef.current) {
      // ทีมงานยืนยันแล้ว (pending ถูกล้าง) — ค้างผลไว้บนจอ ไม่กระโดดกลับหน้าว่าง
      setPhase((p) => (p === 'drawing' ? 'drawing' : 'reveal'))
    }
  }, [])

  const reload = useCallback(async () => {
    if (!roomId) return
    const [r, p, rs] = await Promise.all([
      supabase.from('draw_rooms').select(ROOM_COLS).eq('id', roomId).maybeSingle(),
      supabase.from('draw_prizes').select('*').eq('room_id', roomId).order('sort_order'),
      supabase.from('draw_results').select('*').eq('room_id', roomId).order('created_at'),
    ])
    setPrizes(p.data ?? [])
    setResults(rs.data ?? [])
    applyRoom(r.data)
    setLoading(false)
  }, [roomId, applyRoom])

  useEffect(() => {
    if (!roomId) {
      setLoading(false)
      return undefined
    }
    reload()

    const ch = supabase
      .channel(`draw-room-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'draw_rooms', filter: `id=eq.${roomId}` },
        (payload) => applyRoom(payload.new)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'draw_results', filter: `room_id=eq.${roomId}` },
        () => {
          supabase
            .from('draw_results')
            .select('*')
            .eq('room_id', roomId)
            .order('created_at')
            .then(({ data }) => setResults(data ?? []))
          supabase
            .from('draw_prizes')
            .select('*')
            .eq('room_id', roomId)
            .order('sort_order')
            .then(({ data }) => setPrizes(data ?? []))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [roomId, reload, applyRoom])

  /** เรียกเมื่ออนิเมชันเล่นจบ — เปลี่ยนจาก "กำลังสุ่ม" เป็น "เฉลย" */
  const finishReveal = useCallback(() => setPhase('reveal'), [])

  return { room, prizes, results, winners, phase, loading, finishReveal, reload }
}

/** หาห้องที่ควรแสดงเมื่อไม่ได้ระบุมาใน URL — ห้องที่เพิ่งสุ่มล่าสุดคือห้องที่กำลังเล่นอยู่ */
export async function pickActiveRoomId(tourId) {
  if (!tourId) return null
  const { data } = await supabase
    .from('draw_rooms')
    .select('id, drawn_at, created_at')
    .eq('tour_id', tourId)
    .eq('status', 'open')
  if (!data?.length) return null
  const sorted = [...data].sort(
    (a, b) =>
      new Date(b.drawn_at ?? b.created_at).getTime() - new Date(a.drawn_at ?? a.created_at).getTime()
  )
  return sorted[0].id
}
