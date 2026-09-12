import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId, useTourPath } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { getStaffSession } from '../../lib/staffSession'
import {
  SESSION_COLS, useQuizSession, useQuizHeartbeat, syncServerClock, serverNow,
} from '../../lib/useQuizSession'
import { submitGuess, fetchMyState } from '../../lib/puzzleHost'
import { useQuizTeams } from '../../lib/useQuizTeams'
import { teamStyle } from '../../lib/quizStyle'
import ClueBoard from '../../components/puzzle/ClueBoard'
import TeamPicker from '../../components/quiz/TeamPicker'
import Button from '../../components/common/Button'
import GuestNav from '../../components/common/GuestNav'
import BackButton from '../../components/common/BackButton'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'

// หน้าเล่นปริศนาใบ้คำของลูกทัวร์
//
// มือถือมี "ปุ่มเดียว" คือส่งคำตอบ — ไม่มีปุ่มขอคำใบ้ ไม่มีตัวเลือกอะไรให้กดผิด
// คำใบ้โผล่มาเองเมื่อคนคุมเกมเปิด (ดูข้อ 4.3 ของ MyTour_WordPuzzle_Design_v1.md)
// ยิ่งจอเล็กบนรถที่โยก มีของให้กดน้อยยิ่งดี
//
// ต่างจากควิซตรงที่ "แสดงรูปใบ้บนมือถือเสมอ" แม้จะมีจอใหญ่ —
// รูปใบ้เป็นรายละเอียดเล็ก (รูปหน้าคนมีกระบนทีวี 19" แถวหลังดูไม่ออกแน่นอน)
// และคนต้องก้มพิมพ์อยู่แล้ว

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

export default function Puzzle() {
  const tourId = useTourId()
  const tp = useTourPath()
  const { t } = useTranslation()

  const guestId = getGuestId(tourId)
  const [staffSession] = useState(() => getStaffSession())

  const [rooms, setRooms] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [player, setPlayer] = useState(null)
  const [visitorName, setVisitorName] = useState('')
  const [typed, setTyped] = useState('')
  const [solved, setSolved] = useState(false)
  const [feedback, setFeedback] = useState(null) // 'wrong' | 'tooFast' | 'closed' | ...
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [myScore, setMyScore] = useState(null)

  const inputRef = useRef(null)
  const questionRef = useRef(null)

  const { session, question, phase, msLeft } = useQuizSession(activeId)
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
      .eq('game_kind', 'puzzle')
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
    const text = typed.trim()
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
        // ล้างช่องให้เลย — ให้แก้คำเดิมทีละตัวคือการทรมานคนบนรถที่โยก
        setTyped('')
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
  const secondsLeft = Math.max(Math.ceil(msLeft / 1000), 0)

  // ── ยังไม่ได้เลือกห้อง ──────────────────────────────────────────
  if (!activeId) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <AnnouncementBanner />
        <div className="flex items-center gap-2">
          <BackButton to={tp('games')} />
          <h1 className="text-2xl font-extrabold text-ink">{t('puzzle.title')}</h1>
        </div>

        {rooms.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-faint">
            {t('puzzle.noRoom')}
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
                    {t(`puzzle.state.${room.state}`, { defaultValue: room.state })}
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
          {teamStyle(myTeam.color_index).badge} {t('puzzle.myTeam')}: {myTeam.name}
        </p>
      )}

      {/* ── รอเริ่ม ───────────────────────────────────────── */}
      {phase === 'lobby' && (
        <div className={`${teamMode ? 'mt-4' : 'mt-10'} space-y-2 text-center`}>
          <p className="text-lg font-bold text-ink">
            {teamMode && !myTeam ? t('puzzle.joinTeamFirst') : t('quiz.waitingHost')}
          </p>
          <ul className="mt-4 space-y-1 text-sm text-ink-muted">
            <li>{t('puzzle.rules.guess')}</li>
            <li>{teamMode ? t('puzzle.rules.teamPoint') : t('puzzle.rules.point')}</li>
            <li>{t('puzzle.rules.unlimited')}</li>
            <li>{teamMode ? t('puzzle.rules.teamWinner') : t('puzzle.rules.winner')}</li>
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
          <p className="mb-2 text-center text-xl font-black text-ink">
            {t('puzzle.syllables', { n: question?.puzzle?.syllable_count ?? '' })}
          </p>

          <ClueBoard clues={question?.clues ?? []} surface="phone" />

          {(session?.hint_payload ?? []).map((h) => (
            <p
              key={h.step}
              className="mt-3 rounded-xl bg-warning-bg px-3 py-2 text-sm font-bold text-warning-text"
            >
              💡 {h.body}
            </p>
          ))}

          <div className="mt-auto pt-4">
            {phase === 'locked' && !solved ? (
              // ปิดรับแล้ว — เก็บช่องพิมพ์ไปเลย ดีกว่าปล่อยให้พิมพ์ต่อแล้วโดนปฏิเสธ
              <div className="rounded-2xl bg-surface-sunken p-4 text-center">
                <p className="font-bold text-ink-muted">{t('puzzle.feedback.closed')}</p>
              </div>
            ) : solved ? (
              <div className="rounded-2xl bg-success-bg p-4 text-center">
                <p className="text-lg font-extrabold text-success-text">{t('puzzle.correct')}</p>
                <p className="mt-1 text-sm text-success-text/80">{t('puzzle.waitReveal')}</p>
              </div>
            ) : (
              <>
                {feedback && feedback !== 'correct' && (
                  <p className="mb-2 text-center text-sm font-bold text-danger-text">
                    {t(`puzzle.feedback.${feedback}`, { defaultValue: t('puzzle.feedback.wrong') })}
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
                    placeholder={t('puzzle.placeholder')}
                    className={`min-h-[56px] flex-1 rounded-2xl border-2 border-line bg-surface px-4 text-lg ${
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
      {/* เฉลย — เรียงเหมือนจอใหญ่: คำเฉลยบน · รูปกินที่ที่เหลือ · ตัวสะกดล่าง
          รูปเดิมถูกล็อกไว้ที่ 208px แล้วมีที่ว่างใต้รูปครึ่งจอ */}
      {phase === 'reveal' && (
        <div className="mt-4 flex flex-1 flex-col items-center gap-2 text-center">
          <p className="text-sm text-ink-muted">{t('quiz.answerIs')}</p>
          <p className="text-3xl font-black text-ink">{reveal.answer}</p>

          {reveal.answer_image_url && (
            <img
              src={reveal.answer_image_url}
              alt={reveal.answer ?? ''}
              className="min-h-0 w-full flex-1 rounded-2xl object-contain"
            />
          )}

          <div className="mt-auto w-full space-y-1.5 pt-2">
            {/* ที่มาของคำตอบ (คนตั้งคำถามเขียนเอง) — แทนการแยกพยางค์แบบเดิม */}
            {reveal.explain && <p className="text-base font-bold text-ink">{reveal.explain}</p>}
            {/* ห้องแบบทีม: บอกว่าทีมไหนได้แต้มข้อนี้ — ทีมเดียวกันจะได้รู้ว่าเพื่อนตอบให้แล้ว */}
            {teamMode && reveal.fastest && (
              <p className="text-sm font-bold text-ink">
                {reveal.fastest.team
                  ? t('puzzle.winnerTeam', { team: reveal.fastest.team, name: reveal.fastest.name })
                  : t('puzzle.winner', { name: reveal.fastest.name })}
              </p>
            )}
            <p
              className={`text-lg font-extrabold ${solved ? 'text-success-text' : 'text-ink-faint'}`}
            >
              {solved ? t('puzzle.youGotIt') : t('puzzle.youMissed')}
            </p>
          </div>
        </div>
      )}

      {(phase === 'scoreboard' || phase === 'finished') && (
        <div className="mt-10 space-y-2 text-center">
          <p className="text-sm text-ink-muted">{t('quiz.yourScore')}</p>
          <p className="text-5xl font-black text-ink">{myScore?.score ?? 0}</p>
          <p className="text-sm text-ink-muted">
            {t('puzzle.solvedCount', { n: myScore?.correct_count ?? 0 })}
          </p>
          {myTeam && (
            <p
              className="mx-auto mt-4 inline-block rounded-full px-4 py-1.5 text-sm font-extrabold text-white"
              style={{ background: teamStyle(myTeam.color_index).color }}
            >
              {teamStyle(myTeam.color_index).badge} {myTeam.name} ·{' '}
              {t('puzzle.teamScore', { score: myTeam.total_score ?? 0 })}
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-center text-sm text-danger-text">{error}</p>}
    </div>
  )
}
