import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId, useTourPath } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { getStaffSession } from '../../lib/staffSession'
import {
  SESSION_COLS, useQuizSession, useQuizHeartbeat, syncServerClock, serverNow,
} from '../../lib/useQuizSession'
import { submitGuess, fetchMyState, useWordsAnswerMode } from '../../lib/wordsHost'
import {
  applyOpened, revealCells, poolTiles, joinCells,
  applyPlaced, nextEmptySlot, isArranged, slotsLeft, reconcilePlaced, markPicked,
} from '../../lib/wordsMask'
import { wordGame, useGameT } from '../../lib/wordGames'
import { useQuizTeams } from '../../lib/useQuizTeams'
import { teamStyle } from '../../lib/quizStyle'
import WordBoard from '../../components/words/WordBoard'
import ShufflePool from '../../components/words/ShufflePool'
import TeamPicker from '../../components/quiz/TeamPicker'
import Button from '../../components/common/Button'
import GuestNav from '../../components/common/GuestNav'
import BackButton from '../../components/common/BackButton'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'

// หน้าเล่น What Words / Word Shuffle ของลูกทัวร์ — โครงเดียวกับ guest/Puzzle.jsx
// game = 'words' | 'shuffle' — Word Shuffle เพิ่มกองตัวสลับใต้กระดาน ที่เหลือเหมือนกันทุกอย่าง
//
// ★ วิธีตอบต่างกันตามเกม (18 ก.ย. 2026)
//   What Words  = พิมพ์ตอบ (ตัวอักษรหายไป ไม่มีทางรู้ว่าต้องใช้ตัวไหน)
//   Word Shuffle = แตะเรียงตัวอักษรจากกอง แล้วกดยืนยัน — ไม่มีช่องพิมพ์เลย
//     เจ้าของโปรเจกต์: ตัวอักษรครบอยู่ในกองแล้ว การบังคับให้พิมพ์คือการวัดว่าสะกดถูกไหม
//     ซึ่งเป็นคนละเกมกับการเรียงตัวอักษร (และพิมพ์ไทยบนรถที่โยกคือฝันร้าย)
//
// มือถือมี "ปุ่มเดียว" คือส่งคำตอบ เหมือนปริศนาใบ้คำ
// หมวดหมู่ขึ้นพร้อมโจทย์ทันที (เจ้าของโปรเจกต์เคาะ) และตัวที่คนคุมเกมเปิดแล้ว
// โผล่ในช่องเองทาง session.hint_payload — ไม่มีปุ่มขอตัวช่วย
//
// แสดงกระดานคำบนมือถือเสมอแม้มีจอใหญ่ — สระ/วรรณยุกต์ตัวเล็กบนทีวีแถวหลังดูไม่ออก
// และคนต้องก้มพิมพ์อยู่แล้ว
//
// ชุดแบบ "ไม่ต้องตอบ" (quiz_sets.answer_mode = 'none' — เหมือนเกมเปิดแผ่นป้าย):
//   มือถือเป็นจอดูอย่างเดียว ไม่มีช่องพิมพ์ ไม่มีคะแนน — ทายกันปากเปล่า คนคุมเกมเฉลยเอง

const VISITOR_KEY = 'mytour.quiz.visitor'

// ช่องที่แตะได้ตอนเรียงตัวอักษร: ช่องว่าง = เลือกเป็นที่วางตัวถัดไป · ช่องที่วางแล้ว = เอาตัวคืนกอง
const ARRANGE_STATES = ['hidden', 'filled']

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

export default function Words({ game: gameKey = 'words' }) {
  const G = wordGame(gameKey)
  const tourId = useTourId()
  const tp = useTourPath()
  const { t } = useTranslation()
  const tw = useGameT(G)

  const guestId = getGuestId(tourId)
  const [staffSession] = useState(() => getStaffSession())

  const [rooms, setRooms] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [player, setPlayer] = useState(null)
  const [visitorName, setVisitorName] = useState('')
  const [typed, setTyped] = useState('')
  // Word Shuffle: ตัวที่ผู้เล่นวางเอง { [ช่อง]: ลำดับป้ายในกอง } · cursor = ช่องที่ตัวถัดไปจะลง
  const [placed, setPlaced] = useState({})
  const [cursor, setCursor] = useState(null)
  const [solved, setSolved] = useState(false)
  const [feedback, setFeedback] = useState(null) // 'wrong' | 'tooFast' | 'closed' | ...
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [myScore, setMyScore] = useState(null)

  const inputRef = useRef(null)
  const questionRef = useRef(null)

  const { session, question, phase, msLeft } = useQuizSession(activeId)
  const answerMode = useWordsAnswerMode(session?.set_id)
  const watchOnly = answerMode === 'none'
  const typing = answerMode === 'type' // ระหว่างโหลด (null) ไม่ขึ้นทั้งช่องพิมพ์และข้อความดูอย่างเดียว
  useQuizHeartbeat(player?.id)

  // ทีม — ของกลางตัวเดียวกับควิซและเปิดแผ่นป้าย (อย่าทำสำเนา)
  const teamMode = Boolean(session?.team_mode)
  const { teams, myTeam, teamBusy, createTeam, joinTeam, reloadTeams } = useQuizTeams({
    sessionId: activeId,
    teamMode: session?.team_mode,
    sessionState: session?.state,
    player,
    setPlayer,
    onError: setError,
  })

  // ── รายการห้องที่เปิดอยู่ ────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    if (!tourId) return
    let myBusId = null
    if (guestId) {
      const { data: g } = await supabase
        .from('guests')
        .select('bus_id')
        .eq('id', guestId)
        .maybeSingle()
      myBusId = g?.bus_id ?? null
    }

    const { data } = await supabase
      .from('quiz_sessions')
      .select(SESSION_COLS)
      .eq('tour_id', tourId)
      .eq('game_kind', G.kind)
      .neq('state', 'finished')
      .order('created_at', { ascending: false })

    const visible = (data ?? []).filter((s) => !s.bus_id || s.bus_id === myBusId)
    setRooms(visible)
    if (visible.length === 1) setActiveId((prev) => prev ?? visible[0].id)
  }, [tourId, guestId, G.kind])

  useEffect(() => {
    syncServerClock()
    loadRooms()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !activeId) loadRooms()
    }, 8000)
    return () => clearInterval(timer)
  }, [loadRooms, activeId])

  // ── เข้าห้อง ─────────────────────────────────────────────────────
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

  // ── ข้อใหม่ = ล้างของเดิม แล้วถามกลับว่าเราตอบไปหรือยัง ─────────
  // แอปเด้ง/รีเฟรชกลางข้อเกิดได้เสมอบนรถ ถ้าไม่ถาม จะเห็นช่องว่างเหมือนยังไม่ตอบ
  useEffect(() => {
    const qid = session?.current_question_id ?? null
    if (qid !== questionRef.current) {
      questionRef.current = qid
      setTyped('')
      setPlaced({})
      setCursor(null)
      setSolved(false)
      setFeedback(null)
    }
    if (!qid || !player?.id) return
    fetchMyState({ sessionId: session.id, playerId: player.id, questionId: qid })
      .then((s) => setSolved(Boolean(s?.solved)))
      .catch(() => {})
  }, [session?.current_question_id, session?.id, player?.id])

  useEffect(() => {
    if (!player?.id || !['reveal', 'scoreboard', 'finished'].includes(phase)) return
    // คะแนนทีมไม่มากับ realtime (quiz_players ไม่ publish) — ดึงใหม่ตอนเฉลย/กระดาน
    if (teamMode) reloadTeams()
    supabase
      .from('quiz_players')
      .select('score, correct_count')
      .eq('id', player.id)
      .maybeSingle()
      .then(({ data }) => setMyScore(data ?? null))
  }, [phase, player?.id, session?.current_index, teamMode, reloadTeams])

  async function handleSend() {
    // เรียงตัวอักษร = คำตอบคือสิ่งที่อยู่บนกระดาน ไม่ใช่สิ่งที่พิมพ์
    const text = (arranging ? joinCells(boardCells) : typed).trim()
    if (!text || busy || solved) return
    setBusy(true)
    try {
      const res = await submitGuess({
        sessionId: session.id,
        playerId: player.id,
        questionId: session.current_question_id,
        text,
      })
      if (res.correct) {
        setSolved(true)
        setTyped('')
        setFeedback('correct')
      } else if (res.status === 'ok') {
        // ★ ตอบผิดแล้วเก็บของที่เรียงไว้ ไม่ล้างกอง (เจ้าของโปรเจกต์เคาะ 18 ก.ย. 2026)
        //   เรียงมา 10 ตัวแล้วโดนล้างทั้งกระดานเพราะสลับผิดคู่เดียว = เลิกเล่น
        //   ช่องพิมพ์ยังล้างเหมือนเดิม — แก้คำเดิมทีละตัวบนรถที่โยกคือการทรมาน
        if (!arranging) setTyped('')
        setFeedback('wrong')
        setShake((n) => n + 1)
      } else {
        setFeedback(res.status)
      }
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  const reveal = session?.reveal_payload ?? {}
  const playCells = useMemo(
    () => applyOpened(question?.words?.cells ?? [], session?.hint_payload ?? []),
    [question?.words?.cells, session?.hint_payload]
  )
  const answerCells = useMemo(() => revealCells(reveal.words_cells ?? []), [reveal.words_cells])
  const secondsLeft = Math.max(Math.ceil(msLeft / 1000), 0)

  // ── Word Shuffle: กองตัวอักษร + ตัวที่ผู้เล่นวางเอง ──────────────
  // ตรรกะทั้งหมดอยู่ใน wordsMask.js (ทดสอบแล้ว) ที่นี่แค่ต่อสายกับหน้าจอ
  const tiles = useMemo(
    () => (G.shuffle ? poolTiles(question?.words?.pool ?? [], playCells) : []),
    [G.shuffle, question?.words?.pool, playCells]
  )
  // ห้องแบบ "ไม่ต้องตอบ" ไม่ให้เรียง — มือถือเป็นจอดูอย่างเดียวเหมือนเดิม
  const arranging = G.shuffle && typing && tiles.length > 0
  const boardCells = useMemo(
    () => (arranging ? applyPlaced(playCells, placed, tiles) : playCells),
    [arranging, playCells, placed, tiles]
  )
  const poolView = useMemo(() => markPicked(tiles, placed), [tiles, placed])
  const cursorSlot = boardCells[cursor]?.state === 'hidden' ? cursor : null
  const ready = arranging && isArranged(boardCells)
  const canArrange = arranging && !solved && phase === 'answering'

  // คนคุมเกมเปิดตัวใหม่ระหว่างที่เรากำลังเรียง — ป้ายที่เราถืออยู่อาจถูกใช้ไปแล้ว
  // ถ้าไม่ปรับ ผู้เล่นจะเห็นตัวเดียวกันอยู่ทั้งในช่องและในกอง
  useEffect(() => {
    if (!arranging) return
    setPlaced((prev) => {
      if (!Object.keys(prev).length) return prev
      const next = reconcilePlaced(prev, playCells, tiles)
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([slot, ti]) => prev[slot] === ti)
      return same ? prev : next
    })
  }, [arranging, playCells, tiles])

  /** แตะป้ายในกอง → ลงช่องที่เลือกไว้ ไม่ได้เลือกก็ลงช่องว่างช่องแรก */
  function pickTile(i) {
    const tile = tiles[i]
    if (!tile || tile.used || poolView[i]?.picked) return
    const slot = cursorSlot ?? nextEmptySlot(boardCells, 0)
    if (slot === null) return
    const next = { ...placed, [slot]: i }
    setPlaced(next)
    // เลื่อนไปช่องว่างถัดไปให้เลย — แตะรัวๆ ทีละตัวได้โดยไม่ต้องเล็งช่อง
    setCursor(nextEmptySlot(applyPlaced(playCells, next, tiles), slot + 1))
    setFeedback(null)
  }

  /** แตะช่องบนกระดาน → ช่องที่วางแล้วเอาตัวคืนกอง · ช่องว่างเลือกเป็นที่วางตัวถัดไป */
  function tapSlot(slot) {
    if (boardCells[slot]?.state === 'filled') {
      const next = { ...placed }
      delete next[slot]
      setPlaced(next)
    }
    setCursor(slot)
    setFeedback(null)
  }

  function clearPlaced() {
    setPlaced({})
    setCursor(null)
    setFeedback(null)
  }

  // ── ยังไม่ได้เลือกห้อง ──────────────────────────────────────────
  if (!activeId) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <AnnouncementBanner />
        <div className="flex items-center gap-2">
          <BackButton to={tp('games')} />
          <h1 className="text-2xl font-extrabold text-ink">{tw('title')}</h1>
        </div>

        {rooms.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-faint">
            {tw('noRoom')}
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => join(room.id)}
                  className="w-full rounded-2xl border border-line bg-surface p-4 text-left shadow-card active:scale-[0.99]"
                >
                  <span className="block font-bold text-ink">{room.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {tw(`state.${room.state}`, { defaultValue: room.state })}
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

  // ── ยังไม่รู้จะเรียกว่าอะไร (คนนอกระบบ) ─────────────────────────
  if (!player) {
    return (
      <div className="mx-auto max-w-md space-y-3 px-4 pb-28 pt-6">
        <div className="flex items-center gap-2">
          <BackButton to={tp('games')} />
          <h1 className="text-xl font-extrabold text-ink">{t('quiz.visitorTitle')}</h1>
        </div>
        <p className="text-sm text-ink-muted">{t('quiz.visitorHint')}</p>
        <input
          value={visitorName}
          onChange={(e) => setVisitorName(e.target.value)}
          placeholder={t('quiz.visitorPlaceholder')}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2.5"
        />
        <Button onClick={() => join(activeId, visitorName.trim())} disabled={!visitorName.trim()}>
          {t('quiz.joinRoom')}
        </Button>
        {error && <p className="text-sm text-danger-text">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pb-4 pt-4">
      {/* ปุ่มย้อนกลับต้องอยู่ "ในห้อง" ด้วย ไม่ใช่เฉพาะหน้ารายการห้อง —
          เข้าเกมแล้วออกไม่ได้คือเหตุผลเดียวที่คนต้องพึ่งปุ่มลอย "หน้าหลัก"
          ซึ่งเด้งข้ามหน้ารวมเกมไปหน้าแรกของทริปเลย */}
      <div className="flex items-center gap-2">
        <BackButton to={tp('games')} />
        <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold text-ink">
          {session?.name}
        </h1>
        {phase === 'answering' && (
          <span className="flex-none tabular-nums text-sm font-bold text-ink-muted">
            ⏱ {secondsLeft}
          </span>
        )}
      </div>

      {/* ป้ายทีมของตัวเอง — ระหว่างเล่นต้องเห็นว่าตัวเองอยู่ทีมไหน ไม่งั้นลืม */}
      {myTeam && phase !== 'lobby' && (
        <p
          className="mt-1 self-start rounded-full px-2.5 py-0.5 text-xs font-bold text-white"
          style={{ background: teamStyle(myTeam.color_index).color }}
        >
          {teamStyle(myTeam.color_index).badge} {tw('myTeam')}: {myTeam.name}
        </p>
      )}

      {/* ── รอเริ่ม ───────────────────────────────────────── */}
      {phase === 'lobby' && (
        <div className={`${teamMode ? 'mt-4' : 'mt-10'} space-y-2 text-center`}>
          <p className="text-lg font-bold text-ink">
            {teamMode && !myTeam ? tw('joinTeamFirst') : t('quiz.waitingHost')}
          </p>
          <ul className="mt-4 space-y-1 text-sm text-ink-muted">
            <li>{tw('rules.guess')}</li>
            {G.shuffle && !watchOnly && <li>{tw('rules.tap')}</li>}
            {watchOnly ? (
              <li>{tw('rules.watchOnly')}</li>
            ) : (
              <>
                <li>{teamMode ? tw('rules.teamPoint') : tw('rules.point')}</li>
                <li>{tw('rules.unlimited')}</li>
                <li>{teamMode ? tw('rules.teamWinner') : tw('rules.winner')}</li>
              </>
            )}
          </ul>

          {/* ห้องแบบทีม — เลือก/ตั้งทีมในห้องรอ (ตั้งทีมใหม่ได้เฉพาะก่อนเริ่มเกม) */}
          {teamMode && (
            <div className="pt-4 text-left">
              <TeamPicker
                teams={teams}
                myTeamId={player?.team_id ?? null}
                sizeLimit={session?.team_size_limit ?? 0}
                onCreate={createTeam}
                onJoin={joinTeam}
                busy={teamBusy}
                t={t}
              />
            </div>
          )}
        </div>
      )}

      {phase === 'countdown' && (
        <p className="mt-16 text-center text-8xl font-black text-ink">
          {Math.max(
            Math.ceil((new Date(session.question_started_at).getTime() - serverNow()) / 1000),
            1
          )}
        </p>
      )}

      {/* ── กำลังเล่น ─────────────────────────────────────── */}
      {(phase === 'answering' || phase === 'locked') && (
        <div className="mt-3 flex flex-1 flex-col">
          {/* หมวดหมู่ = คำใบ้ ขึ้นพร้อมโจทย์ */}
          {question?.words?.category && (
            <p className="mb-2 self-center rounded-full bg-brand-lighter px-4 py-1 text-base font-extrabold text-brand">
              {tw('category', { name: question.words.category })}
            </p>
          )}

          <div
            // ตอบผิด = สั่นทั้งกระดาน (key บังคับให้อนิเมชันเล่นซ้ำทุกครั้งที่ผิด)
            key={arranging ? shake : undefined}
            className={`rounded-2xl border border-line bg-surface px-2 py-4 shadow-card ${
              arranging && feedback === 'wrong' ? 'animate-shake-once' : ''
            }`}
          >
            <WordBoard
              cells={boardCells}
              surface="phone"
              className="text-ink"
              clickStates={ARRANGE_STATES}
              selectedSlot={canArrange ? cursorSlot : null}
              onSlotClick={canArrange ? tapSlot : undefined}
            />
            {G.shuffle && tiles.length > 0 && (
              <ShufflePool
                tiles={poolView}
                boardCells={boardCells}
                surface="phone"
                className="mt-3"
                onPick={canArrange ? pickTile : undefined}
              />
            )}
          </div>

          {(question?.words?.hidden_count ?? 0) > 0 && (
            <p className="mt-2 text-center text-xs text-ink-faint">
              {tw('hiddenInfo', {
                n: question.words.hidden_count,
                opened: playCells.filter((x) => x.state === 'opened').length,
              })}
            </p>
          )}

          <div className="mt-auto pt-4">
            {answerMode === null ? null : watchOnly ? (
              // ไม่ต้องตอบ — ข้อความเดียวกับเกมเปิดแผ่นป้าย ไม่ใช่ช่องพิมพ์สีเทา (จะดูเหมือนเน็ตหลุด)
              <p className="rounded-2xl bg-surface-sunken p-4 text-center text-sm font-semibold text-ink-muted">
                {tw('watchOnly')}
              </p>
            ) : phase === 'locked' && !solved ? (
              // ปิดรับแล้ว — เก็บช่องพิมพ์ไปเลย ดีกว่าปล่อยให้พิมพ์ต่อแล้วโดนปฏิเสธ
              <div className="rounded-2xl bg-surface-sunken p-4 text-center">
                <p className="font-bold text-ink-muted">{tw('feedback.closed')}</p>
              </div>
            ) : solved ? (
              <div className="rounded-2xl bg-success-bg p-4 text-center">
                <p className="text-lg font-extrabold text-success-text">{tw('correct')}</p>
                <p className="mt-1 text-sm text-success-text/80">{tw('waitReveal')}</p>
              </div>
            ) : arranging ? (
              // เรียงตัวอักษร — ไม่มีช่องพิมพ์เลย ปุ่มยืนยันกดได้เมื่อครบทุกช่อง
              <div className="space-y-2">
                {feedback && feedback !== 'correct' && (
                  <p className="text-center text-sm font-bold text-danger-text">
                    {tw(`feedback.${feedback}`, { defaultValue: tw('feedback.wrong') })}
                  </p>
                )}
                <p className="text-center text-xs text-ink-faint">
                  {ready ? tw('arrange.ready') : tw('arrange.left', { n: slotsLeft(boardCells) })}
                </p>
                <div className="flex gap-2">
                  <Button
                    fullWidth={false}
                    variant="ghost"
                    className="min-h-[56px] flex-none px-4"
                    onClick={clearPlaced}
                    disabled={busy || Object.keys(placed).length === 0}
                  >
                    {tw('arrange.clear')}
                  </Button>
                  <Button
                    fullWidth={false}
                    className="min-h-[56px] flex-1"
                    onClick={handleSend}
                    disabled={busy || !ready}
                  >
                    {tw('arrange.confirm')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {feedback && feedback !== 'correct' && (
                  <p className="mb-2 text-center text-sm font-bold text-danger-text">
                    {tw(`feedback.${feedback}`, { defaultValue: tw('feedback.wrong') })}
                  </p>
                )}
                <div className="flex gap-2" key={shake}>
                  <input
                    ref={inputRef}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSend()
                    }}
                    // แถบเดาคำภาษาไทยชอบแก้คำที่พิมพ์ถูกแล้วให้ผิด
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    enterKeyHint="send"
                    placeholder={tw('placeholder')}
                    className={`min-h-[56px] min-w-0 flex-1 rounded-2xl border-2 border-line bg-surface px-4 text-lg ${
                      feedback === 'wrong' ? 'animate-shake-once' : ''
                    }`}
                  />
                  <Button
                    fullWidth={false}
                    className="min-h-[56px] px-5"
                    onClick={handleSend}
                    disabled={busy || !typed.trim()}
                  >
                    {t('quiz.send')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── เฉลย ─────────────────────────────────────────── */}
      {phase === 'reveal' && (
        <div className="mt-4 flex flex-1 flex-col items-center gap-3 text-center">
          {reveal.category && (
            <p className="rounded-full bg-brand-lighter px-4 py-1 text-sm font-extrabold text-brand">
              {tw('category', { name: reveal.category })}
            </p>
          )}
          <p className="text-sm text-ink-muted">{t('quiz.answerIs')}</p>
          <div className="w-full rounded-2xl border border-line bg-surface px-2 py-4 shadow-card">
            <WordBoard cells={answerCells} surface="phone" className="text-ink" />
          </div>

          <div className="mt-auto w-full space-y-1.5 pt-2">
            {reveal.explain && <p className="text-sm text-ink-muted">{reveal.explain}</p>}
            {/* ห้องแบบทีม: บอกว่าทีมไหนได้แต้มข้อนี้ — ทีมเดียวกันจะได้รู้ว่าเพื่อนตอบให้แล้ว */}
            {typing && teamMode && reveal.fastest && (
              <p className="text-sm font-bold text-ink">
                {reveal.fastest.team
                  ? tw('winnerTeam', { team: reveal.fastest.team, name: reveal.fastest.name })
                  : tw('winner', { name: reveal.fastest.name })}
              </p>
            )}
            {/* ไม่ต้องตอบ = ไม่มีใคร "ตอบถูก/ยังไม่ได้" — อย่าบอกทุกคนว่าพลาด */}
            {typing && (
              <p
                className={`text-lg font-extrabold ${solved ? 'text-success-text' : 'text-ink-faint'}`}
              >
                {solved ? tw('youGotIt') : tw('youMissed')}
              </p>
            )}
          </div>
        </div>
      )}

      {(phase === 'scoreboard' || phase === 'finished') && watchOnly && (
        <div className="mt-16 space-y-2 text-center">
          <p className="text-2xl font-extrabold text-ink">
            {phase === 'finished' ? tw('watchOnlyEnd') : tw('watchOnlyBreak')}
          </p>
          <p className="text-sm text-ink-muted">{tw('watchOnlyNoScore')}</p>
        </div>
      )}

      {(phase === 'scoreboard' || phase === 'finished') && typing && (
        <div className="mt-10 space-y-2 text-center">
          <p className="text-sm text-ink-muted">{t('quiz.yourScore')}</p>
          <p className="text-5xl font-black text-ink">{myScore?.score ?? 0}</p>
          <p className="text-sm text-ink-muted">
            {tw('solvedCount', { n: myScore?.correct_count ?? 0 })}
          </p>
          {myTeam && (
            <p
              className="mx-auto mt-4 inline-block rounded-full px-4 py-1.5 text-sm font-extrabold text-white"
              style={{ background: teamStyle(myTeam.color_index).color }}
            >
              {teamStyle(myTeam.color_index).badge} {myTeam.name} ·{' '}
              {tw('teamScore', { score: myTeam.total_score ?? 0 })}
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-center text-sm text-danger-text">{error}</p>}
    </div>
  )
}
