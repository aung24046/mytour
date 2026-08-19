import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId, useTourPath } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { getStaffSession } from '../../lib/staffSession'
import {
  SESSION_COLS,
  useQuizSession,
  useQuizHeartbeat,
  syncServerClock,
} from '../../lib/useQuizSession'
import { optionStyles, optionLabels, teamStyle } from '../../lib/quizStyle'
import OptionShape from '../../components/quiz/OptionShape'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import GuestNav from '../../components/common/GuestNav'
import BackButton from '../../components/common/BackButton'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'

// หน้าเล่นควิซของลูกทัวร์
//
// โครงเดียวกับ BingoCard: ทีมงานเปิดห้อง → ที่นี่ขึ้นรายการห้อง → กดเข้าร่วม
// ไม่มี PIN ไม่มีรหัสห้อง ไม่ต้องพิมพ์ชื่อ (ยกเว้นคนนอกระบบ ดู VISITOR_KEY)
//
// สิ่งที่ตั้งใจ "ไม่" ทำ:
//   - ไม่แสดงข้อความคำถามซ้ำบนมือถือถ้ามีจอใหญ่ (screen_mode ≠ 'none')
//     ให้คนเงยหน้าดูจอ = บรรยากาศงานเลี้ยง ไม่ใช่ทุกคนก้มมือถือ
//   - ไม่บอกว่าตอบถูกหรือผิดทันที ต้องรอทีมงานกดเฉลยพร้อมกันทุกคน
//     (ฝั่ง server ก็ไม่ส่งค่านั้นกลับมาให้อยู่แล้ว — ดู quiz_submit)

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

// ---------------------------------------------------------------------
// เลือกห้อง
// ---------------------------------------------------------------------
function RoomPicker({ rooms, onPick, joining, t }) {
  return (
    <div className="space-y-2.5">
      {rooms.map((room) => (
        <button
          key={room.id}
          type="button"
          disabled={joining}
          onClick={() => onPick(room)}
          className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left shadow-card active:scale-[0.99] disabled:opacity-60"
        >
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-brand text-white">
            <Icon name="game" size={24} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-extrabold text-ink">{room.name}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold text-success-text">
              <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              {room.state === 'lobby' ? t('quiz.roomWaiting') : t('quiz.roomPlaying')}
            </span>
          </span>
          <Icon name="chevronRight" size={18} className="flex-none text-ink-faint" />
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------
// ห้องรอแบบทีม — ลูกทัวร์ตั้งทีมกันเอง
// ---------------------------------------------------------------------
// ตั้งใจให้ "ใครกดเข้าทีมไหนก็ได้" ไม่มีเชิญ ไม่มีรหัส เพราะคนที่จะจับกลุ่มกัน
// เขานั่งข้างกันอยู่แล้ว คุยกันด้วยปากเร็วกว่าระบบเชิญใดๆ
//
// ผลที่ตามมาคือทีมจะขนาดไม่เท่ากันแน่นอน — คะแนนทีมจึงคิดเป็น "เฉลี่ยต่อคน"
// ไม่ใช่ผลรวม (ดู quiz_team_leaderboard) ไม่งั้นทีมใหญ่ชนะตั้งแต่ยังไม่เริ่มเล่น
function TeamPicker({ teams, myTeamId, sizeLimit, onCreate, onJoin, busy, t }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-ink">{t('quiz.team.pick')}</p>

      <div className="space-y-2">
        {teams.map((team) => {
          const st = teamStyle(team.color_index)
          const mine = team.id === myTeamId
          const full = sizeLimit > 0 && team.member_count >= sizeLimit && !mine
          return (
            <button
              key={team.id}
              type="button"
              disabled={busy || full}
              onClick={() => onJoin(team.id)}
              className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition active:scale-[0.99] disabled:opacity-40 ${
                mine ? 'border-transparent' : 'border-line bg-surface'
              }`}
              style={mine ? { background: st.color, color: 'white' } : undefined}
            >
              <span className="text-xl leading-none">{st.badge}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-extrabold">{team.name}</span>
                <span className={`text-xs ${mine ? 'opacity-80' : 'text-ink-muted'}`}>
                  {t('quiz.team.members', { n: team.member_count })}
                  {full ? ` · ${t('quiz.team.full')}` : ''}
                </span>
              </span>
              {mine && <Icon name="check" size={20} />}
            </button>
          )
        })}
      </div>

      {creating ? (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoFocus
            placeholder={t('quiz.team.namePlaceholder')}
            className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2.5 text-base font-bold text-ink outline-none focus:border-brand"
          />
          <Button
            fullWidth={false}
            disabled={!name.trim() || busy}
            onClick={() => {
              onCreate(name.trim())
              setName('')
              setCreating(false)
            }}
          >
            {t('quiz.team.create')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} />
          {t('quiz.team.newTeam')}
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// ปุ่มตอบ
// ---------------------------------------------------------------------
function AnswerButtons({ question, disabled, chosen, onPick, t }) {
  const styles = optionStyles(question.kind)
  const labels = optionLabels(question, t)

  return (
    <div className="grid grid-cols-2 gap-3">
      {labels.map((label, i) => {
        const s = styles[i] ?? styles[0]
        const isChosen = chosen === i
        const dim = chosen !== null && !isChosen
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onPick(i)}
            // ปุ่มต้องใหญ่พอกดตอนรถโยก — ขั้นต่ำ 1 ใน 4 ของความสูงจอ
            className={`flex min-h-[22vh] flex-col items-center justify-center gap-2 rounded-2xl px-3 py-4 text-white shadow-card transition active:scale-[0.97] disabled:active:scale-100 ${
              dim ? 'opacity-30' : ''
            } ${isChosen ? 'ring-4 ring-white ring-offset-2 ring-offset-canvas' : ''}`}
            style={{ background: s.color }}
          >
            <OptionShape shape={s.shape} size={38} />
            <span className="line-clamp-3 text-center text-base font-extrabold leading-tight">
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------
// ช่องกรอกตัวเลข
// ---------------------------------------------------------------------
// คีย์บอร์ดมือถือขึ้นมาบังครึ่งจอ — ปุ่มส่งต้องลอยอยู่เหนือคีย์บอร์ดเสมอ
// ไม่งั้นคนกรอกเสร็จแล้วกดส่งไม่ได้จนหมดเวลา (เจ็บมาแล้วในฟอร์มลงทะเบียน)
function NumberAnswer({ question, disabled, submitted, onSubmit, t }) {
  const [value, setValue] = useState('')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('quiz.numberPlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-3xl font-extrabold text-ink outline-none"
        />
        {question.numeric_unit && (
          <span className="flex-none text-base font-bold text-ink-muted">
            {question.numeric_unit}
          </span>
        )}
      </div>

      <div
        className="sticky bottom-0 pb-[env(safe-area-inset-bottom)]"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <Button
          type="button"
          disabled={disabled || value === ''}
          onClick={() => onSubmit(Number(value))}
        >
          {submitted ? t('quiz.sent') : t('quiz.send')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
export default function Quiz() {
  const tourId = useTourId()
  const tp = useTourPath()
  const { t } = useTranslation()

  const guestId = getGuestId(tourId)
  // ต้อง freeze ไว้ครั้งเดียว — getStaffSession() คืน object ใหม่ทุกครั้งที่เรียก
  // ถ้าเรียกตรงๆ ใน body ตัว join จะถูกสร้างใหม่ทุก render แล้ว effect ที่ผูกกับมัน
  // จะยิง quiz_join ซ้ำไม่รู้จบ
  const [staffSession] = useState(() => getStaffSession())

  const [rooms, setRooms] = useState([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [player, setPlayer] = useState(null)
  const [joining, setJoining] = useState(false)
  const [visitorName, setVisitorName] = useState('')
  const [error, setError] = useState('')

  const [chosen, setChosen] = useState(null)
  const [myRank, setMyRank] = useState(null)
  const [teams, setTeams] = useState([])
  const [teamBusy, setTeamBusy] = useState(false)
  const answeredForRef = useRef(null)

  const { session, question, phase, msLeft, msToStart, loading } = useQuizSession(activeId)
  useQuizHeartbeat(player?.id)

  // ── รายการห้องที่เปิดอยู่ ────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    if (!tourId) return

    // ห้องที่ผูกกับรถคันหนึ่ง ควรเห็นเฉพาะคนบนรถคันนั้น — ไม่งั้นกดผิดห้องกันทั้งคัน
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
      .neq('state', 'finished')
      .order('created_at', { ascending: false })

    const visible = (data ?? []).filter((s) => !s.bus_id || s.bus_id === myBusId)
    setRooms(visible)
    setLoadingRooms(false)

    // มีห้องเดียว → เข้าเลย ไม่ต้องให้เลือก
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
      setJoining(true)
      setError('')

      const args = { p_session_id: sessionId, p_name: nameOverride ?? null }
      if (guestId) {
        Object.assign(args, { p_kind: 'guest', p_guest_id: guestId })
      } else if (staffSession?.staff?.id) {
        Object.assign(args, { p_kind: 'staff', p_staff_id: staffSession.staff.id })
      } else if (nameOverride) {
        Object.assign(args, { p_kind: 'visitor', p_device_key: visitorDeviceKey() })
      } else {
        // คนนอกระบบล้วน — ต้องรู้จะเรียกว่าอะไรก่อนถึงขึ้นกระดานได้
        setJoining(false)
        setActiveId(sessionId)
        return
      }

      const { data, error: err } = await supabase.rpc('quiz_join', args)
      setJoining(false)

      if (err) {
        setError(err.message)
        return
      }
      setPlayer(Array.isArray(data) ? data[0] : data)
      setActiveId(sessionId)
    },
    [guestId, staffSession]
  )

  // เข้าห้องอัตโนมัติเมื่อรู้ว่าเป็นใครแล้ว (ลูกทัวร์/ทีมงาน)
  useEffect(() => {
    if (!activeId || player) return
    if (!guestId && !staffSession?.staff?.id) return
    join(activeId)
  }, [activeId, player, guestId, staffSession, join])

  // ── ข้อใหม่ = ล้างคำตอบเดิม ──────────────────────────────────────
  // แล้วถามกลับว่าข้อนี้เราตอบไปหรือยัง — แอปเด้ง/รีเฟรชกลางข้อได้เสมอบนรถ
  // ถ้าไม่ถาม พอกลับเข้ามาจะเห็นปุ่มว่างเหมือนยังไม่ตอบ แล้วกดซ้ำจนงงว่าทำไมไม่ติด
  useEffect(() => {
    const qid = session?.current_question_id ?? null
    // ⚠️ อย่ารวมสอง guard นี้เป็นอันเดียว — session กับ player มาคนละ request
    //    ถ้า session มาถึงก่อน (เคสปกติ) รอบแรกจะตั้ง ref ไว้แล้ว return ตรง !player?.id
    //    พอ player มาถึง effect รันใหม่แต่ติด guard ตัวแรก = ไม่เคยยิง quiz_my_answer เลย
    //    ซึ่งคือเคสรีเฟรช/แอปเด้งกลางข้อพอดี — เคสที่ effect นี้เขียนมาแก้
    if (qid !== answeredForRef.current) {
      answeredForRef.current = qid
      setChosen(null)
    }

    if (!qid || !player?.id) return
    supabase
      .rpc('quiz_my_answer', {
        p_session_id: session.id,
        p_player_id: player.id,
        p_question_id: qid,
      })
      .then(({ data }) => {
        const row = Array.isArray(data) ? data[0] : data
        if (row) setChosen(row.choice_index ?? -1)
      })
  }, [session?.current_question_id, session?.id, player?.id])

  // ── อันดับตัวเองตอนเฉลย ──────────────────────────────────────────
  useEffect(() => {
    if (!player?.id || !['reveal', 'scoreboard', 'finished'].includes(phase)) return
    supabase
      .from('quiz_players')
      .select('score, correct_count')
      .eq('id', player.id)
      .maybeSingle()
      .then(({ data }) => setMyRank(data ?? null))
  }, [phase, player?.id, session?.current_index])

  // ── ทีม ──────────────────────────────────────────────────────────
  // realtime ของ quiz_teams ทำให้ทุกคนเห็นทีมใหม่โผล่ทันทีที่มีคนสร้าง
  // ถ้าไม่มี จะมีคนตั้งทีมชื่อซ้ำกันเพราะไม่เห็นของคนอื่น แล้วเจอ error งงๆ
  const loadTeams = useCallback(async () => {
    if (!activeId || !session?.team_mode) return
    const { data } = await supabase.rpc('quiz_team_leaderboard', { p_session_id: activeId })
    setTeams(data ?? [])
  }, [activeId, session?.team_mode])

  useEffect(() => {
    if (!session?.team_mode || !activeId) return undefined
    loadTeams()

    const ch = supabase
      .channel(`quiz-teams-${activeId}-${Math.random().toString(36).slice(2, 7)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_teams', filter: `session_id=eq.${activeId}` },
        () => loadTeams()
      )
      .subscribe()

    // จำนวนสมาชิกไม่ได้มาทาง realtime (quiz_players ไม่ได้ publish โดยตั้งใจ)
    // จึงต้อง poll เบาๆ ระหว่างอยู่ในห้องรอเท่านั้น
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && session?.state === 'lobby') loadTeams()
    }, 5000)

    return () => {
      supabase.removeChannel(ch)
      clearInterval(timer)
    }
  }, [activeId, session?.team_mode, session?.state, loadTeams])

  const createTeam = useCallback(
    async (name) => {
      if (!player?.id) return
      setTeamBusy(true)
      setError('')
      const { error: err } = await supabase.rpc('quiz_create_team', {
        p_session_id: activeId,
        p_player_id: player.id,
        p_name: name,
      })
      setTeamBusy(false)
      if (err) {
        setError(err.message)
        return
      }
      // อ่านแถวตัวเองใหม่ ไม่เดาค่า team_id เอง — ฝั่ง DB เป็นคนตัดสินว่าเข้าทีมไหน
      const { data: me } = await supabase
        .from('quiz_players')
        .select('*')
        .eq('id', player.id)
        .maybeSingle()
      if (me) setPlayer(me)
      loadTeams()
    },
    [activeId, player?.id, loadTeams]
  )

  const joinTeam = useCallback(
    async (teamId) => {
      if (!player?.id) return
      setTeamBusy(true)
      setError('')
      const { data, error: err } = await supabase.rpc('quiz_join_team', {
        p_session_id: activeId,
        p_player_id: player.id,
        p_team_id: teamId,
      })
      setTeamBusy(false)
      if (err) setError(err.message)
      else {
        setPlayer(Array.isArray(data) ? data[0] : data)
        loadTeams()
      }
    },
    [activeId, player?.id, loadTeams]
  )

  // team_id ของ player อาจเก่า (ตั้ง 'pending' ไว้ตอนสร้างทีม) — เชื่อ teams เป็นหลัก
  const myTeam = useMemo(() => {
    if (!player?.id) return null
    return teams.find((tm) => tm.id === player.team_id) ?? null
  }, [teams, player?.team_id, player?.id])

  const submit = useCallback(
    async (choiceIndex, numberValue) => {
      if (!player?.id || !session?.current_question_id) return
      setChosen(choiceIndex ?? -1)

      const { data, error: err } = await supabase.rpc('quiz_submit', {
        p_session_id: session.id,
        p_player_id: player.id,
        p_question_id: session.current_question_id,
        p_choice: choiceIndex ?? null,
        p_number: numberValue ?? null,
      })

      // เน็ตหลุดกลางส่ง = เคสหลักบนรถบัส ไม่ใช่เคสหายาก
      // ถ้าไม่รับ error ตรงนี้ chosen ที่ตั้งแบบ optimistic ไว้ข้างบนจะค้าง
      // หน้าจอขึ้น "ส่งคำตอบแล้ว รอเฉลย" ทั้งที่ DB ไม่มีแถว แล้วลูกทัวร์นั่งรอเก้อทั้งข้อ
      if (err) {
        setError(t('quiz.err.network'))
        setChosen(null)
        return
      }

      // ตั้งใจไม่บอกถูก/ผิดตรงนี้ — server ก็ไม่ได้ส่งมา
      if (data?.status && !['ok', 'already'].includes(data.status)) {
        setError(t(`quiz.err.${data.status}`, { defaultValue: t('quiz.err.closed') }))
        setChosen(null)
      }
    },
    [player, session, t]
  )

  const revealPayload = session?.reveal_payload ?? {}
  const myAnswerCorrect = useMemo(() => {
    if (phase !== 'reveal' || chosen === null || chosen < 0) return null
    if (revealPayload.correct_index === undefined) return null
    return chosen === revealPayload.correct_index
  }, [phase, chosen, revealPayload])

  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000))
  const countdown = Math.max(0, Math.ceil(msToStart / 1000))
  const hasBigScreen = session?.screen_mode && session.screen_mode !== 'none'

  // ── หน้าจอ ───────────────────────────────────────────────────────
  if (!activeId) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <AnnouncementBanner />
        <div className="flex items-center gap-2">
          <BackButton to={tp('games')} />
          <h1 className="text-2xl font-extrabold text-ink">{t('quiz.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{t('quiz.pickRoom')}</p>

        <div className="mt-4">
          {loadingRooms ? (
            <p className="text-sm text-ink-muted">{t('common.loading')}</p>
          ) : rooms.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center">
              <Icon name="game" size={32} className="mx-auto text-ink-faint" />
              <p className="mt-2 text-sm font-semibold text-ink-muted">{t('quiz.noRoom')}</p>
            </div>
          ) : (
            <RoomPicker rooms={rooms} onPick={(r) => join(r.id)} joining={joining} t={t} />
          )}
        </div>

        <GuestNav active="games" />
      </div>
    )
  }

  // คนนอกระบบ (ไกด์ท้องถิ่นที่เพิ่งขึ้นรถ) — จุดเดียวในเกมที่ต้องพิมพ์ชื่อ
  if (!player && !guestId && !staffSession?.staff?.id) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-6">
        <div className="flex items-center gap-2">
          <BackButton to={tp('games')} />
          <h1 className="text-xl font-extrabold text-ink">{t('quiz.visitorTitle')}</h1>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{t('quiz.visitorHint')}</p>
        <input
          value={visitorName}
          onChange={(e) => setVisitorName(e.target.value)}
          maxLength={24}
          placeholder={t('quiz.visitorPlaceholder')}
          className="mt-4 w-full rounded-control border border-line bg-surface px-4 py-3 text-lg font-bold text-ink outline-none focus:border-brand"
        />
        <div className="mt-3">
          <Button
            disabled={!visitorName.trim() || joining}
            onClick={() => join(activeId, visitorName.trim())}
          >
            {t('quiz.joinRoom')}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-danger-text">{error}</p>}
        <GuestNav active="games" />
      </div>
    )
  }

  if (loading || !session) {
    return (
      <div className="mx-auto max-w-md px-4 pt-10 text-center text-sm text-ink-muted">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-24 pt-4">
      <header className="flex items-center justify-between gap-2">
        <BackButton to={tp('games')} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          {session.name}
        </span>
        {myTeam && (
          <span
            className="flex-none rounded-full px-2.5 py-1 text-xs font-extrabold text-white"
            style={{ background: teamStyle(myTeam.color_index).color }}
          >
            {myTeam.name}
          </span>
        )}
        {myRank && (
          <span className="rounded-full bg-surface-sunken px-3 py-1 text-xs font-extrabold text-ink">
            {myRank.score} {t('quiz.points')}
          </span>
        )}
      </header>

      {/* รอเริ่ม */}
      {phase === 'lobby' &&
        (session.team_mode ? (
          <div className="flex-1 pt-4">
            <TeamPicker
              teams={teams}
              myTeamId={player?.team_id ?? null}
              sizeLimit={session.team_size_limit ?? 0}
              onCreate={createTeam}
              onJoin={joinTeam}
              busy={teamBusy}
              t={t}
            />
            <p className="mt-5 text-center text-sm text-ink-muted">
              {myTeam ? t('quiz.waitingHost') : t('quiz.team.mustPick')}
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-lighter">
              <Icon name="clock" size={30} className="text-brand" />
            </span>
            <p className="text-lg font-extrabold text-ink">{t('quiz.waitingHost')}</p>
            <p className="text-sm text-ink-muted">{t('quiz.waitingHint')}</p>
          </div>
        ))}

      {/* นับถอยหลัง — ทุกเครื่องนับไปที่วินาทีเดียวกันเพราะใช้เวลาจาก server */}
      {phase === 'countdown' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-sm font-bold text-ink-muted">{t('quiz.getReady')}</p>
          <p className="text-8xl font-black text-brand">{countdown || 1}</p>
        </div>
      )}

      {/* ตอบ */}
      {phase === 'answering' && question && (
        <div className="flex flex-1 flex-col gap-3 pt-3">
          <div className="flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (msLeft / (question.time_limit_sec * 1000)) * 100)
                  )}%`,
                }}
              />
            </div>
            <span className="w-10 text-right text-xl font-black tabular-nums text-ink">
              {secondsLeft}
            </span>
          </div>

          {/* มีจอใหญ่ → ไม่ต้องอ่านคำถามซ้ำบนมือถือ ให้เงยหน้าดูจอ
              ไม่มีจอใหญ่ → ต้องเห็นทั้งคำถามและสื่อประกอบบนมือถือ ไม่งั้นตอบไม่ได้ */}
          {!hasBigScreen && (
            <>
              <p className="text-lg font-extrabold leading-snug text-ink">{question.text}</p>
              {question.media_url &&
                (question.media_kind === 'video' ? (
                  <video
                    key={question.id}
                    src={question.media_url}
                    autoPlay
                    muted
                    playsInline
                    loop
                    className="max-h-[22vh] w-full rounded-2xl bg-black object-contain"
                  />
                ) : (
                  <img
                    src={question.media_url}
                    alt=""
                    className="max-h-[22vh] w-full rounded-2xl object-contain"
                  />
                ))}
            </>
          )}

          {chosen !== null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <Icon name="checkCircle" size={40} className="text-success" />
              <p className="text-lg font-extrabold text-ink">{t('quiz.answerSent')}</p>
              <p className="text-sm text-ink-muted">{t('quiz.waitReveal')}</p>
            </div>
          ) : question.kind === 'numeric' ? (
            <NumberAnswer
              question={question}
              disabled={false}
              submitted={false}
              onSubmit={(n) => submit(null, n)}
              t={t}
            />
          ) : (
            <AnswerButtons
              question={question}
              disabled={false}
              chosen={chosen}
              onPick={(i) => submit(i, null)}
              t={t}
            />
          )}
        </div>
      )}

      {/* ปิดรับแล้ว รอเฉลย */}
      {phase === 'locked' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Icon name="lock" size={36} className="text-ink-faint" />
          <p className="text-lg font-extrabold text-ink">{t('quiz.locked')}</p>
          <p className="text-sm text-ink-muted">{t('quiz.waitReveal')}</p>
        </div>
      )}

      {/* เฉลย */}
      {phase === 'reveal' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          {myAnswerCorrect === null ? (
            <>
              <Icon name="checkCircle" size={40} className="text-ink-faint" />
              <p className="text-lg font-extrabold text-ink">{t('quiz.revealed')}</p>
            </>
          ) : myAnswerCorrect ? (
            <>
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-success text-white">
                <Icon name="check" size={40} />
              </span>
              <p className="text-2xl font-black text-success-text">{t('quiz.correct')}</p>
            </>
          ) : (
            <>
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white text-4xl font-black">
                ✕
              </span>
              <p className="text-2xl font-black text-danger-text">{t('quiz.wrong')}</p>
            </>
          )}

          {revealPayload.correct_number !== undefined && (
            <p className="text-lg font-extrabold text-ink">
              {t('quiz.answerIs')} {revealPayload.correct_number}
            </p>
          )}
          {revealPayload.explain && (
            <p className="max-w-xs text-sm text-ink-muted">{revealPayload.explain}</p>
          )}
          {myRank && (
            <p className="mt-2 text-sm font-bold text-ink">
              {t('quiz.yourScore')}: {myRank.score}
            </p>
          )}
        </div>
      )}

      {/* กระดานอันดับ / จบเกม */}
      {(phase === 'scoreboard' || phase === 'finished') && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Icon name="star" size={36} className="text-accent" />
          <p className="text-lg font-extrabold text-ink">
            {phase === 'finished' ? t('quiz.gameOver') : t('quiz.scoreboard')}
          </p>
          {myRank && (
            <p className="text-sm text-ink-muted">
              {t('quiz.summary', { score: myRank.score, correct: myRank.correct_count })}
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-center text-sm font-semibold text-danger-text">{error}</p>}
      <GuestNav active="games" />
    </div>
  )
}
