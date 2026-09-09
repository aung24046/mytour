import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId, useTourPath } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { getStaffSession } from '../../lib/staffSession'
import { SESSION_COLS, useQuizSession, useQuizHeartbeat, syncServerClock } from '../../lib/useQuizSession'
import { submitTileGuess, fetchMyTileState, fetchCurrentTileImage } from '../../lib/tileHost'
import { openCount, tileCount } from '../../lib/tileGrid'
import TileBoard from '../../components/tiles/TileBoard'
import Button from '../../components/common/Button'
import GuestNav from '../../components/common/GuestNav'
import BackButton from '../../components/common/BackButton'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'

// หน้าเล่นเกมเปิดแผ่นป้ายของลูกทัวร์
//
// ★ มือถือเห็นภาพใต้แผ่นที่เปิดแล้ว (เจ้าของโปรเจกต์ตัดสิน 10 ก.ย. 2026)
//   เดิมตั้งใจไม่ส่งเลยเพราะภาพคือเฉลย แต่พอเล่นจริงลูกทัวร์เห็นแค่ตารางตัวเลขเปล่าๆ
//   เล่นไม่รู้เรื่อง — เกมที่ไม่มีใครเห็นแย่กว่าการรั่วที่ไม่มีใครไปแคะ
//
//   แต่ยังไม่ได้แปลว่าแจกฟรีทุกอย่าง: ภาพมาทาง quiz_tiles_current_image ซึ่งคืนเฉพาะ
//   "ข้อปัจจุบันที่เปิดแล้ว" ข้อเดียว ไม่ใช่ทั้งชุด คนที่เปิด devtools เห็นได้อย่างมาก
//   คือภาพของข้อที่กำลังเล่นอยู่ตรงหน้า
//
// ★ หน้าจอตอนหมดโควตาต้องไม่ใช่ช่องพิมพ์สีเทาพร้อมข้อความว่าคุณหมดสิทธิ์
//   โควตาจำกัดทำให้สภาพนี้เป็นเรื่องปกติของทุกข้อ ไม่ใช่เคสขอบ —
//   เขายังดูเกมอยู่ แค่ตอบไม่ได้ กระดานจึงต้องยังเปิดต่อให้เห็น

const VISITOR_KEY = 'mytour.quiz.visitor'

function visitorDeviceKey() {
  try {
    let v = localStorage.getItem(VISITOR_KEY)
    if (!v) {
      v = `v-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
      localStorage.setItem(VISITOR_KEY, v)
    }
    return v
  } catch {
    return `v-${Math.random().toString(36).slice(2)}`
  }
}

export default function Tiles() {
  const tourId = useTourId()
  const tp = useTourPath()
  const { t } = useTranslation()

  const guestId = getGuestId(tourId)
  const [staffSession] = useState(() => getStaffSession())

  const [rooms, setRooms] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [player, setPlayer] = useState(null)
  const [setMeta, setSetMeta] = useState(null)
  const [visitorName, setVisitorName] = useState('')
  const [typed, setTyped] = useState('')
  const [solved, setSolved] = useState(false)
  const [left, setLeft] = useState(null)      // null = ไม่จำกัด
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [myScore, setMyScore] = useState(null)

  const [tileImage, setTileImage] = useState(null)

  const questionRef = useRef(null)
  const { session, question, phase } = useQuizSession(activeId)
  useQuizHeartbeat(player?.id)

  const grid = question?.tiles ?? { grid_rows: 3, grid_cols: 4 }
  const total = tileCount(grid.grid_rows, grid.grid_cols)
  const opened = openCount(session?.revealed_tiles, grid.grid_rows, grid.grid_cols)
  const reveal = session?.reveal_payload ?? {}
  const revealing = phase === 'reveal' && reveal.kind === 'tiles'
  // ภาพที่เอามาวางใต้แผ่น — ตอนเฉลย reveal_payload พามาให้อยู่แล้ว ใช้เป็นตาข่ายรองรับ
  const boardImage = tileImage ?? (revealing ? reveal.tile_image_url ?? null : null)
  const answerMode = setMeta?.answer_mode ?? 'type'
  const exhausted = left !== null && left <= 0

  const loadRooms = useCallback(async () => {
    if (!tourId) return
    let myBusId = null
    if (guestId) {
      const { data: g } = await supabase.from('guests').select('bus_id').eq('id', guestId).maybeSingle()
      myBusId = g?.bus_id ?? null
    }
    const { data } = await supabase
      .from('quiz_sessions')
      .select(SESSION_COLS)
      .eq('tour_id', tourId)
      .eq('game_kind', 'tiles')
      .neq('state', 'finished')
      .order('created_at', { ascending: false })

    const visible = (data ?? []).filter((s) => !s.bus_id || s.bus_id === myBusId)
    setRooms(visible)
    if (visible.length === 1) setActiveId((prev) => prev ?? visible[0].id)
  }, [tourId, guestId])

  useEffect(() => {
    syncServerClock()
    loadRooms()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !activeId) loadRooms()
    }, 8000)
    return () => clearInterval(timer)
  }, [loadRooms, activeId])

  // กติกาของชุด (โหมดตอบ + โควตา) — ต้องรู้ว่าจะแสดงช่องพิมพ์ไหม
  useEffect(() => {
    const setId = session?.set_id
    if (!setId) return
    supabase
      .from('quiz_sets')
      .select('answer_mode, attempt_limit')
      .eq('id', setId)
      .maybeSingle()
      .then(({ data }) => setSetMeta(data ?? null))
  }, [session?.set_id])

  const join = useCallback(
    async (sessionId, nameOverride) => {
      const args = { p_session_id: sessionId, p_name: nameOverride ?? null }
      if (guestId) Object.assign(args, { p_kind: 'guest', p_guest_id: guestId })
      else if (staffSession?.staff?.id)
        Object.assign(args, { p_kind: 'staff', p_staff_id: staffSession.staff.id })
      else if (nameOverride)
        Object.assign(args, { p_kind: 'visitor', p_device_key: visitorDeviceKey() })
      else {
        setActiveId(sessionId)
        return
      }
      const { data, error: err } = await supabase.rpc('quiz_join', args)
      if (err) {
        setError(err.message)
        return
      }
      setPlayer(Array.isArray(data) ? data[0] : data)
      setActiveId(sessionId)
    },
    [guestId, staffSession]
  )

  useEffect(() => {
    if (!activeId || player) return
    if (!guestId && !staffSession?.staff?.id) return
    join(activeId)
  }, [activeId, player, guestId, staffSession, join])

  // ข้อใหม่ = ล้างของเดิม แล้วถามกลับว่าเราตอบไปหรือยัง
  // แอปเด้ง/รีเฟรชกลางข้อเกิดได้เสมอบนรถ ถ้าไม่ถาม จะเห็นช่องว่างเหมือนยังไม่ตอบ
  useEffect(() => {
    const qid = session?.current_question_id ?? null
    if (qid !== questionRef.current) {
      questionRef.current = qid
      setTyped('')
      setSolved(false)
      setFeedback(null)
      setLeft(setMeta?.attempt_limit ?? null)
    }
    if (!qid || !player?.id) return
    fetchMyTileState({ sessionId: session.id, playerId: player.id, questionId: qid })
      .then((s) => {
        setSolved(Boolean(s?.solved))
        if (setMeta?.attempt_limit != null) {
          setLeft(Math.max(setMeta.attempt_limit - (s?.guesses ?? 0), 0))
        }
      })
      .catch(() => {})
  }, [session?.current_question_id, session?.id, player?.id, setMeta?.attempt_limit])

  // ดึงภาพของข้อปัจจุบัน — server คืนให้เฉพาะเมื่อเปิดข้อแล้ว จึงต้องลองใหม่
  // เมื่อเฟสขยับ (lobby → countdown → answering) ไม่ใช่ยิงครั้งเดียวตอนเปลี่ยนข้อ
  useEffect(() => {
    setTileImage(null)
  }, [session?.current_question_id])

  useEffect(() => {
    const qid = session?.current_question_id
    if (!qid || !session?.id || tileImage || phase === 'lobby') return undefined
    let alive = true
    fetchCurrentTileImage(session.id)
      .then((url) => { if (alive && url) setTileImage(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [session?.id, session?.current_question_id, phase, tileImage])

  useEffect(() => {
    if (!player?.id || !['reveal', 'scoreboard', 'finished'].includes(phase)) return
    supabase
      .from('quiz_players')
      .select('score, correct_count')
      .eq('id', player.id)
      .maybeSingle()
      .then(({ data }) => setMyScore(data ?? null))
  }, [phase, player?.id, session?.current_index])

  async function handleSend() {
    const text = typed.trim()
    if (!text || busy || solved || exhausted) return
    setBusy(true)
    try {
      const res = await submitTileGuess({
        sessionId: session.id,
        playerId: player.id,
        questionId: session.current_question_id,
        text,
      })
      if (res.attempts_left !== undefined) setLeft(res.attempts_left)
      if (res.correct) {
        setSolved(true)
        setTyped('')
        setFeedback('correct')
      } else if (res.status === 'ok') {
        // ล้างช่องให้เลย — ให้แก้คำเดิมทีละตัวคือการทรมานคนบนรถที่โยก
        setTyped('')
        setFeedback('wrong')
      } else {
        setFeedback(res.status)
      }
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  // ── ยังไม่ได้เลือกห้อง ──────────────────────────────────────────
  if (!activeId) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <AnnouncementBanner />
        <div className="flex items-center gap-2">
          <BackButton to={tp('games')} />
          <h1 className="text-2xl font-extrabold text-ink">{t('tiles.title')}</h1>
        </div>
        {rooms.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-faint">
            {t('tiles.noRoom')}
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {rooms.map((room) => (
              <li key={room.id}>
                <button type="button" onClick={() => join(room.id)}
                        className="w-full rounded-2xl border border-line bg-surface p-4 text-left shadow-card active:scale-[0.99]">
                  <span className="block font-bold text-ink">{room.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {t(`tiles.state.${room.state}`, { defaultValue: room.state })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <GuestNav active="games" />
      </div>
    )
  }

  // ── คนนอกระบบยังไม่ได้บอกชื่อ ───────────────────────────────────
  if (!player) {
    return (
      <div className="mx-auto max-w-md space-y-3 px-4 pb-28 pt-6">
        <h1 className="text-xl font-extrabold text-ink">{t('quiz.visitorTitle')}</h1>
        <p className="text-sm text-ink-muted">{t('quiz.visitorHint')}</p>
        <input value={visitorName} onChange={(e) => setVisitorName(e.target.value)}
               placeholder={t('quiz.visitorPlaceholder')}
               className="w-full rounded-xl border border-line bg-surface px-3 py-2.5" />
        <Button onClick={() => join(activeId, visitorName.trim())} disabled={!visitorName.trim()}>
          {t('quiz.joinRoom')}
        </Button>
        {error && <p className="text-sm text-danger-text">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pb-4 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-ink">{session?.name}</h1>
        <span className="text-sm font-bold text-ink-muted">{opened}/{total}</span>
      </div>

      {question?.text && (
        <p className="mt-2 text-center text-base font-bold text-ink">{question.text}</p>
      )}

      <div className="mt-3">
        <TileBoard
          rows={grid.grid_rows}
          cols={grid.grid_cols}
          crop={{ x: grid.crop_x, y: grid.crop_y, w: grid.crop_w, h: grid.crop_h }}
          imageUrl={boardImage}
          imageAspect={grid.image_aspect}
          coverImageUrl={grid.cover_image_url}
          revealed={session?.revealed_tiles ?? []}
          showNumbers={!revealing}
        />
      </div>

      {revealing && (
        <div className="mt-4 text-center">
          <p className="text-2xl font-extrabold text-ink">{reveal.answer}</p>
          {reveal.fastest && (
            <p className="mt-1 text-sm text-ink-muted">
              🎉 {t('tiles.guest.winner', { name: reveal.fastest.name })}
            </p>
          )}
          {reveal.explain && <p className="mt-1 text-sm text-ink-muted">{reveal.explain}</p>}
        </div>
      )}

      <div className="mt-auto pt-4">
        {answerMode === 'none' ? (
          <p className="text-center text-sm text-ink-faint">{t('tiles.guest.watchOnly')}</p>
        ) : solved ? (
          <p className="rounded-2xl bg-success-bg px-4 py-3 text-center font-bold text-success-text">
            {t('tiles.guest.youGotIt')}
          </p>
        ) : revealing || phase === 'scoreboard' || phase === 'finished' ? (
          myScore ? (
            <p className="text-center text-sm text-ink-muted">
              {t('tiles.guest.myScore', { score: myScore.score })}
            </p>
          ) : null
        ) : exhausted ? (
          // ไม่ใช่ช่องพิมพ์สีเทา — เขายังดูเกมอยู่ แค่ตอบไม่ได้
          <p className="rounded-2xl bg-neutral-bg px-4 py-3 text-center text-sm font-semibold text-ink-muted">
            {t('tiles.guest.outOfTries')}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={typed}
                onChange={(e) => { setTyped(e.target.value); setFeedback(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
                placeholder={t('tiles.guest.placeholder')}
                enterKeyHint="send"
                className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-3 text-base"
              />
              <Button fullWidth={false} className="px-5" onClick={handleSend}
                      disabled={busy || !typed.trim()}>
                {t('tiles.guest.send')}
              </Button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className={feedbackClass(feedback)}>
                {feedback ? t(`tiles.guest.feedback.${feedback}`, { defaultValue: '' }) : ''}
              </span>
              {left !== null && (
                <span className="font-semibold text-ink-muted">
                  {t('tiles.guest.triesLeft', { n: left })}
                </span>
              )}
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-center text-sm text-danger-text">{error}</p>}
      </div>
    </div>
  )
}

function feedbackClass(f) {
  if (f === 'correct') return 'font-bold text-success-text'
  if (f === 'wrong') return 'font-bold text-danger-text'
  return 'text-ink-faint'
}
