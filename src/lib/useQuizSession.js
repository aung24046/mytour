import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from './supabase'

// ติดตาม "ห้องควิซ" หนึ่งห้องแบบเรียลไทม์ — จอเวที มือถือทีมงาน และมือถือลูกทัวร์
// ใช้ hook ตัวเดียวกันหมด จะได้เห็นข้อเดียวกันพร้อมกัน
//
// ทำไมต้องมีหลายชั้นเหมือน AnnouncementBanner (realtime อย่างเดียวไม่พอ):
//   1) Realtime — เร็วสุด ได้ทันทีที่ทีมงานกดเปิดข้อ
//   2) visibilitychange — มือถือปิดจอ/สลับแอป websocket โดนตัด แล้ว event ที่พลาดไม่มีส่งย้อนหลัง
//   3) online — บนรถบัสเน็ตหลุดบ่อยมาก
//   4) poll ทุก 4 วิ — สั้นกว่าแบนเนอร์ประกาศ (45 วิ) เยอะ เพราะควิซพลาดไป 45 วิ = พลาดทั้งข้อ
//      1 แถวต่อครั้ง payload เล็กมาก ยอมจ่ายได้
//
// ⚠️ อย่าเพิ่ม subscribe ตาราง quiz_players หรือ quiz_answers เข้ามาที่นี่
//    80 คนกดตอบพร้อมกัน = 80 event ยิงใส่ทุกเครื่องโดยเปล่าประโยชน์
//    ฝั่งที่ต้องรู้จำนวนให้ poll quiz_answer_count แทน (ดู useQuizAnswerCount)

const POLL_INTERVAL_MS = 4000

// ⚠️ เป็นรายชื่อคอลัมน์แบบระบุเอง ไม่ใช่ select('*') — คอลัมน์ใหม่ต้องมาเติมที่นี่
// ไม่งั้น realtime (payload.new มาครบทุกคอลัมน์) กับ polling (มาเฉพาะที่ระบุ)
// จะให้ค่าไม่ตรงกัน แล้วจะเห็นเป็น "คำใบ้ขึ้นแป๊บนึงแล้วหายไป" ทุก 4 วินาที
export const SESSION_COLS =
  'id, tour_id, set_id, name, bus_id, state, current_index, current_question_id,' +
  ' question_started_at, question_ends_at, locked_at, reveal_payload, join_open,' +
  ' late_join, stage_theme, screen_mode, team_mode, team_size_limit, created_at, ended_at,' +
  ' game_kind, hint_level, hint_payload, revealed_tiles, last_tile_at, solve_limit'

// ---------------------------------------------------------------------
// นาฬิกา server
// ---------------------------------------------------------------------
// ห้ามใช้ Date.now() ของเครื่องตัวเองในการนับถอยหลัง — มือถือแต่ละเครื่องตั้งเวลา
// ต่างกันได้เป็นนาที คนที่นาฬิกาเร็วจะเห็นเวลาหมดก่อนคนอื่นทั้งที่ยังตอบได้
//
// เก็บเป็น module-level ตัวเดียว: หน้าเดียวมีหลาย component ที่ต้องนับเวลา
// (แถบเวลา + ปุ่ม + จอเวที) ไม่ควรยิง RPC วัด offset คนละครั้ง
let clockOffsetMs = 0
let clockSyncPromise = null

export function serverNow() {
  return Date.now() + clockOffsetMs
}

export async function syncServerClock() {
  if (clockSyncPromise) return clockSyncPromise

  clockSyncPromise = (async () => {
    try {
      const t0 = Date.now()
      const { data, error } = await supabase.rpc('quiz_now')
      const t1 = Date.now()
      if (error || !data) return clockOffsetMs

      // สมมติ latency ขาไปขากลับเท่ากัน → เวลาที่ server ตอนที่เราได้รับ ≈ ค่าที่ส่งมา + rtt/2
      const rtt = t1 - t0
      const serverAtT1 = new Date(data).getTime() + rtt / 2
      clockOffsetMs = serverAtT1 - t1
      return clockOffsetMs
    } catch (err) {
      console.warn('[quiz] เทียบนาฬิกากับ server ไม่สำเร็จ ใช้เวลาเครื่องแทน', err)
      return clockOffsetMs
    } finally {
      // ปล่อยให้ sync ใหม่ได้ในรอบหน้า (เช่นเครื่องหลับไปนาน)
      setTimeout(() => {
        clockSyncPromise = null
      }, 60000)
    }
  })()

  return clockSyncPromise
}

// ---------------------------------------------------------------------
// เฟสที่คำนวณจากเวลา ไม่ใช่จาก state ตรงๆ
// ---------------------------------------------------------------------
// state = 'answering' ครอบทั้งช่วงนับถอยหลังและช่วงตอบจริง
// เราตั้งใจไม่มี state 'countdown' ใน DB เพราะจะต้องมีตัวตั้งเวลาฝั่ง server มาพลิกให้
// ฝั่งจอคำนวณเอาเองจาก question_started_at ง่ายกว่าและไม่มีทางหลุด
export function derivePhase(session, nowMs) {
  if (!session) return 'loading'
  if (session.state !== 'answering') return session.state

  const startAt = session.question_started_at ? new Date(session.question_started_at).getTime() : 0
  return nowMs < startAt ? 'countdown' : 'answering'
}

/** เหลืออีกกี่มิลลิวินาที (ติดลบได้ ให้ผู้เรียก clamp เอง) */
export function msLeft(session, nowMs) {
  if (!session?.question_ends_at) return 0
  return new Date(session.question_ends_at).getTime() - nowMs
}

/** อีกกี่มิลลิวินาทีจะเริ่มตอบได้ */
export function msToStart(session, nowMs) {
  if (!session?.question_started_at) return 0
  return new Date(session.question_started_at).getTime() - nowMs
}

// ---------------------------------------------------------------------
// hook หลัก
// ---------------------------------------------------------------------
export function useQuizSession(sessionId) {
  const [session, setSession] = useState(null)
  const [question, setQuestion] = useState(null)
  const [loading, setLoading] = useState(true)
  // ตัวจับเวลาเดียวของหน้า — ทุกอย่างที่ต้องนับถอยหลังอ่านค่านี้
  const [now, setNow] = useState(() => serverNow())

  const mountedRef = useRef(true)
  const questionIdRef = useRef(null)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!sessionId) return
      const { data, error } = await supabase
        .from('quiz_sessions')
        .select(SESSION_COLS)
        .eq('id', sessionId)
        .maybeSingle()

      if (!mountedRef.current) return
      if (error) {
        console.error('[quiz] โหลดห้องไม่สำเร็จ', error)
        return
      }
      setSession(data ?? null)
      if (!silent) setLoading(false)
    },
    [sessionId]
  )

  useEffect(() => {
    mountedRef.current = true
    syncServerClock()
    return () => {
      mountedRef.current = false
    }
  }, [])

  // เดินนาฬิกาถี่พอให้แถบเวลาลื่น แต่ไม่ถี่จนกินแบต
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 100)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      return undefined
    }
    load()

    const topic = `quiz-session-${sessionId}-${Math.random().toString(36).slice(2, 9)}`
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quiz_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          // payload.new มาครบทั้งแถวอยู่แล้ว — merge ตรงๆ ไม่ต้อง refetch
          if (payload.new?.id) setSession(payload.new)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') load({ silent: true })
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[quiz] realtime ต่อไม่ติด — ใช้ polling แทน', status)
        }
      })

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        syncServerClock()
        load({ silent: true })
      }
    }
    const handleOnline = () => load({ silent: true })

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true })
    }, POLL_INTERVAL_MS)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
      clearInterval(poll)
    }
  }, [sessionId, load])

  // ตัวคำถามโหลดแยก และโหลดใหม่เฉพาะตอนเปลี่ยนข้อจริงๆ
  // (ถ้าโหลดทุกครั้งที่ session เปลี่ยน จะยิงซ้ำทุกครั้งที่ทีมงานกดเฉลย)
  useEffect(() => {
    const qid = session?.current_question_id ?? null
    if (qid === questionIdRef.current) return
    questionIdRef.current = qid

    if (!qid) {
      setQuestion(null)
      return
    }
    supabase
      .from('quiz_questions')
      .select('id, set_id, sort_order, kind, text, media_url, media_kind, options, numeric_unit, time_limit_sec')
      .eq('id', qid)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!mountedRef.current) return
        // ข้อของเกมปริศนามีเนื้อเพิ่มอีกสองตาราง — ดึงต่อให้เลยเพื่อให้ทุกจอ
        // (เวที / ทีมงาน / ลูกทัวร์) ได้ก้อนเดียวกันจาก hook เดียวกัน
        if (data?.kind === 'puzzle') {
          const [{ data: meta }, { data: clues }] = await Promise.all([
            supabase
              .from('quiz_puzzle')
              .select('syllable_count, hint_count')
              .eq('question_id', qid)
              .maybeSingle(),
            supabase
              .from('quiz_puzzle_clues')
              .select('id, sort_order, clue_kind, body')
              .eq('question_id', qid)
              .order('sort_order'),
          ])
          if (!mountedRef.current) return
          setQuestion({ ...data, puzzle: meta ?? null, clues: clues ?? [] })
          return
        }
        // ข้อของ What Words มีโจทย์ (ช่องที่ซ่อนแล้ว) + หมวดหมู่อยู่อีกตาราง
        // ★ ตารางนี้ไม่มีตัวที่ซ่อน (อยู่ quiz_keys.words_cells ที่ปิดจาก anon)
        //   ตัวที่คนคุมเกมเปิดแล้วมากับ session.hint_payload = [{ slot, char, m }]
        //   pool = กองตัวสลับของ Word Shuffle (What Words = null) — เกมนั้นใช้ข้อชนิด words เดียวกัน
        if (data?.kind === 'words') {
          const { data: words } = await supabase
            .from('quiz_words')
            .select('category, cells, hidden_count, pool')
            .eq('question_id', qid)
            .maybeSingle()
          if (!mountedRef.current) return
          setQuestion({ ...data, words: words ?? null })
          return
        }
        // ข้อของเกมเปิดแผ่นป้ายมีกระดานอยู่อีกตาราง — ดึงต่อให้เลยด้วยเหตุผลเดียวกัน
        // ★ ตารางนี้ไม่มี URL ภาพจริง (ภาพคือเฉลย อยู่ใน quiz_keys ที่ปิดจาก anon)
        //   จอที่มี token ต้องไปเอาเองผ่าน quiz_tiles_image
        if (data?.kind === 'tiles') {
          const { data: tiles } = await supabase
            .from('quiz_tiles')
            .select(
              'grid_rows, grid_cols, open_step, cover_image_url,' +
              ' crop_x, crop_y, crop_w, crop_h, image_aspect'
            )
            .eq('question_id', qid)
            .maybeSingle()
          if (!mountedRef.current) return
          setQuestion({ ...data, tiles: tiles ?? null })
          return
        }
        setQuestion(data ?? null)
      })
  }, [session?.current_question_id])

  const phase = derivePhase(session, now)

  return {
    session,
    question,
    phase,
    now,
    loading,
    reload: load,
    msLeft: msLeft(session, now),
    msToStart: msToStart(session, now),
  }
}

// ---------------------------------------------------------------------
// จำนวนคนที่ตอบแล้ว (ฝั่งทีมงานเท่านั้น)
// ---------------------------------------------------------------------
// poll ไม่ใช่ realtime โดยตั้งใจ — เหตุผลอยู่หัวไฟล์
// "ครบ" นับจากคนที่ยัง online เท่านั้น ไม่ใช่คนในห้องทั้งหมด
// ถ้านับรวมคนที่ปิดแอปไปแล้ว ปุ่ม "ปิดรับ + เฉลยเลย" จะไม่มีวันเด้ง
export function useQuizAnswerCount(sessionId, questionId, active) {
  const [count, setCount] = useState({ answered: 0, online: 0, total: 0 })

  useEffect(() => {
    if (!sessionId || !questionId || !active) return undefined

    let alive = true
    async function tick() {
      const { data } = await supabase.rpc('quiz_answer_count', {
        p_session_id: sessionId,
        p_question_id: questionId,
        p_online_window_sec: 60,
      })
      const row = Array.isArray(data) ? data[0] : data
      if (alive && row) setCount(row)
    }

    tick()
    // เช็ค visibility แบบเดียวกับ polling จุดอื่นในไฟล์นี้ — จอทีมงานที่ปิดไว้
    // ไม่ต้องยิง RPC ทุก 1.5 วินาที
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tick()
    }, 1500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId, questionId, active])

  return count
}

// ---------------------------------------------------------------------
// นับคนในห้อง (เข้าแล้ว / ยังออนไลน์) — ใช้ได้ทุกช่วงของเกม รวมห้องรอ
// ---------------------------------------------------------------------
// ★ มีไว้เพราะตัวเลข "ออนไลน์" ของ quiz_puzzle_stats / quiz_tiles_stats ต้องมีข้อปัจจุบัน
//   ห้องรอยังไม่มีข้อ → หน้าคนคุมเกมไม่เคยดึงเลย ขึ้น "ออนไลน์ 0 คน" ทั้งที่มีคนเข้าแล้ว
//   (เจ้าของโปรเจกต์เจอตอนทดสอบ What Words 11 ก.ย. 2026)
// ออนไลน์ = เต้นหัวใจ (useQuizHeartbeat) ภายใน 60 วิ — ช่วงเวลาเดียวกับ p_online_window_sec ของ RPC
//   เทียบกับ serverNow() ไม่ใช่ Date.now() — นาฬิกามือถือทีมงานเพี้ยนได้เป็นนาที
// อ่าน quiz_players ตรงๆ (หน้าคุมควิซก็อ่านแบบนี้) poll ไม่ใช่ realtime ด้วยเหตุผลเดียวกับหัวไฟล์
const ONLINE_WINDOW_MS = 60000

export function useRoomHeadcount(sessionId, active = true) {
  const [count, setCount] = useState({ joined: 0, online: 0, loaded: false })

  useEffect(() => {
    if (!sessionId || !active) return undefined
    let alive = true

    async function tick() {
      const { data, error } = await supabase
        .from('quiz_players')
        .select('last_seen_at')
        .eq('session_id', sessionId)
      if (!alive || error) return
      const cutoff = serverNow() - ONLINE_WINDOW_MS
      const rows = data ?? []
      setCount({
        joined: rows.length,
        online: rows.filter((r) => r.last_seen_at && new Date(r.last_seen_at).getTime() > cutoff).length,
        loaded: true,
      })
    }

    tick()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tick()
    }, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId, active])

  return count
}

// ---------------------------------------------------------------------
// บอก server ว่ายังอยู่
// ---------------------------------------------------------------------
export function useQuizHeartbeat(playerId) {
  useEffect(() => {
    if (!playerId) return undefined

    const beat = () => {
      supabase.rpc('quiz_heartbeat', { p_player_id: playerId })
    }
    beat()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') beat()
    }, 20000)

    // ⚠️ visibilitychange ยิงทั้งตอนซ่อนและตอนกลับมา — ต้องเต้นเฉพาะตอนกลับมา
    //    ถ้าเต้นตอนกดปิดจอด้วย คนที่ปิดแอปไปแล้วจะยังนับเป็น online อีก 60 วิ
    //    (p_online_window_sec) แล้ว allIn ของหน้าทีมงานจะไม่มีวันเป็นจริง
    //    ซึ่งย้อนแย้งกับเหตุผลที่ last_seen_at มีอยู่ตั้งแต่แรก
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [playerId])
}
