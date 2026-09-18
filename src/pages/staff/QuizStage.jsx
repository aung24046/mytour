import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useQuizSession, useRoomPlayers } from '../../lib/useQuizSession'
import { resolveHostToken, fetchLeaderboard, fetchTeamLeaderboard } from '../../lib/quizHost'
import { optionStyles, optionLabels, stagePreset, stageSkin, teamStyle } from '../../lib/quizStyle'
import OptionShape from '../../components/quiz/OptionShape'
import StageRoster from '../../components/quiz/StageRoster'

// จอใหญ่ — เปิดแท็บแยกบนโปรเจกเตอร์หรือทีวีบนรถ
//
// ไม่มีปุ่มสั่งงานแม้แต่ปุ่มเดียว (แบบเดียวกับ LuckyDrawStage)
// ทุกอย่างสั่งจากมือถือทีมงาน จอนี้แค่สะท้อนสถานะห้องออกมา
//
// จอนี้มีสองแกนที่ไม่เกี่ยวกัน — อย่าเอามารวมกัน
//
// stage_theme = บรรยากาศ (ดู stageSkin())
//   day  : ค่าเริ่มต้น พื้นเข้มไล่เฉด ตัวเลือกทึบ ฟอนต์ Noto Sans Thai Looped
//   neon : งานเลี้ยงกลางคืนที่ปิดไฟ ตัวเลือกเป็นกรอบเรืองแสงพื้นโปร่ง
//          เพราะบล็อกสีเต็มจอในห้องมืดแยงตาจนอ่านข้อความในบล็อกไม่ออก
//
// screen_mode เปลี่ยนหน้าตาจริง ไม่ใช่แค่ขนาดฟอนต์ — ดู stagePreset()
//   projector : งานเลี้ยง จอ 16:9 คนดูห่าง 10 เมตร  → Top 10 + อนิเมชันเต็มที่
//   bus_tv    : ทีวี 15-19" บนรถ แถวหลังไกลกว่า      → Top 3 + ตัดอนิเมชัน
//               (เครื่องเล่นบนรถซีพียูอ่อน กระตุกจะดูแย่กว่าไม่มีเลย)

export default function QuizStage() {
  const { sessionId } = useParams()
  const { t } = useTranslation()

  const [token, setToken] = useState(null)
  const [board, setBoard] = useState([])
  const [liveNumbers, setLiveNumbers] = useState([])
  const [setMedia, setSetMedia] = useState([])
  const [teamBoard, setTeamBoard] = useState([])

  const { session, question, phase, msLeft, msToStart } = useQuizSession(sessionId)

  useEffect(() => {
    setToken(resolveHostToken(sessionId))
  }, [sessionId])

  const preset = stagePreset(session?.screen_mode)
  const skin = stageSkin(session?.stage_theme)
  const styles = optionStyles(question?.kind)
  const labels = useMemo(() => optionLabels(question, t), [question, t])
  const reveal = session?.reveal_payload ?? {}

  // รายการสื่อของทั้งชุด — โหลดครั้งเดียวเพื่อเอาไป preload ข้อถัดไป
  // (ตารางคำถามเปิดให้อ่านอยู่แล้ว เฉลยอยู่คนละตารางจึงไม่รั่ว)
  useEffect(() => {
    if (!session?.set_id) return
    supabase
      .from('quiz_questions')
      .select('id, sort_order, media_url, media_kind')
      .eq('set_id', session.set_id)
      .order('sort_order')
      .then(({ data }) => setSetMedia(data ?? []))
  }, [session?.set_id])

  // โหลดสื่อของข้อถัดไปไว้ล่วงหน้าตั้งแต่ข้อนี้ยังเล่นอยู่
  // ถ้าไม่ทำ พอเปิดข้อที่มีวิดีโอบนรถบัส จอจะว่างอยู่หลายวินาทีระหว่างโหลด
  // ซึ่งกินเวลาตอบของลูกทัวร์ไปด้วย เพราะนาฬิกาเดินแล้ว
  useEffect(() => {
    const next = setMedia[(session?.current_index ?? -1) + 1]
    if (!next?.media_url) return

    if (next.media_kind === 'video') {
      const v = document.createElement('video')
      v.preload = 'auto'
      v.muted = true
      v.src = next.media_url
      v.load()
      return () => {
        v.src = ''
      }
    }
    const img = new Image()
    img.src = next.media_url
    return undefined
  }, [setMedia, session?.current_index])

  // คนในห้อง — จอใหญ่ขึ้น "ชื่อ" ไม่ใช่แค่ตัวเลข (ดูเหตุผลใน StageRoster.jsx)
  //   hook ตัวเดียวกับมือถือคนคุมเกม จะได้ไม่มีทางที่สองจอนับไม่ตรงกัน
  const room = useRoomPlayers(sessionId, phase === 'lobby')

  // ห้องรอแบบทีม — ทีมโผล่เพิ่มได้ตลอดจนกว่าจะเริ่มเกม
  useEffect(() => {
    if (phase !== 'lobby' || !session?.team_mode) return undefined
    const tick = () => fetchTeamLeaderboard(sessionId).then(setTeamBoard)
    tick()
    const timer = setInterval(tick, 3000)
    return () => clearInterval(timer)
  }, [phase, sessionId, session?.team_mode])

  useEffect(() => {
    if (!['reveal', 'scoreboard', 'finished'].includes(phase)) return
    fetchLeaderboard(sessionId, preset.leaderboardRows).then(setBoard)
    if (session?.team_mode) fetchTeamLeaderboard(sessionId).then(setTeamBoard)
  }, [phase, sessionId, session?.current_index, session?.team_mode, preset.leaderboardRows])

  // ข้อเดาตัวเลข: 45 วิที่เงียบสนิทบนเวทีคือความอึดอัด
  // โชว์ตัวเลขที่ทยอยส่งเข้ามาแทน (ไม่บอกว่าใครตอบ ไม่บอกเฉลย)
  useEffect(() => {
    if (phase !== 'answering' || question?.kind !== 'numeric' || !token) {
      setLiveNumbers([])
      return undefined
    }
    let alive = true
    const tick = async () => {
      const { data } = await supabase.rpc('quiz_live_numbers', {
        p_session_id: sessionId,
        p_question_id: question.id,
        p_token: token,
      })
      if (alive) setLiveNumbers((data ?? []).map((r) => Number(r.value)))
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [phase, question?.kind, question?.id, sessionId, token])

  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000))
  const countdown = Math.max(0, Math.ceil(msToStart / 1000))
  const totalAnswers = reveal.answered ?? 0

  const shell = 'flex min-h-screen w-full flex-col items-center justify-center p-8'
  // ส่งสกินผ่าน inline style ไม่ใช่คลาส เพราะค่ามาจาก DB ตอน runtime
  // Tailwind ตัดคลาสที่ไม่ปรากฏเป็นข้อความตรงๆ ในไฟล์ทิ้งตอน build
  const skinStyle = {
    background: skin.page,
    color: skin.ink,
    fontFamily: skin.font,
  }

  if (!session) {
    return <div className={shell} style={skinStyle}>{t('common.loading')}</div>
  }

  // ── รอเริ่ม ────────────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div className={shell} style={skinStyle}>
        <p className="text-2xl font-bold opacity-70">{session.name}</p>
        <p className="mt-4 text-[9rem] font-black leading-none tabular-nums">{room.joined}</p>
        <p className="mt-1 text-3xl font-bold opacity-70">{t('quiz.stage.joined')}</p>

        {/* ชื่อคนที่เข้ามาแล้ว — คนที่ยังไม่เข้าจะเห็นว่าตัวเองไม่อยู่บนจอ แล้วเข้าเอง */}
        <StageRoster players={room.players} className="mt-6 max-h-[34vh] max-w-6xl" />

        {/* โหมดทีม: จอใหญ่ต้องโชว์ทีมที่ตั้งกันแล้ว ไม่งั้นคนที่ยังไม่เลือก
            ต้องก้มดูมือถือทีละคน ซึ่งช้ากว่าเงยหน้าดูจอมาก */}
        {session.team_mode && teamBoard.length > 0 && (
          <div className="mt-8 flex max-w-4xl flex-wrap justify-center gap-3">
            {teamBoard.map((team) => {
              const st = teamStyle(team.color_index)
              return (
                <span
                  key={team.id}
                  className="flex items-center gap-2 rounded-full px-5 py-2.5 text-2xl font-extrabold"
                  style={{ background: st.color }}
                >
                  {st.badge} {team.name}
                  <span className="text-xl font-bold opacity-70">{team.member_count}</span>
                </span>
              )
            })}
          </div>
        )}

        <p className="mt-10 text-xl opacity-50">{t('quiz.stage.waitingHost')}</p>
      </div>
    )
  }

  // ── นับถอยหลัง ─────────────────────────────────────────────────
  if (phase === 'countdown') {
    return (
      <div className={shell} style={skinStyle}>
        {question && (
          <p className={`max-w-5xl text-center font-black leading-tight ${preset.questionClass}`}>
            {question.text}
          </p>
        )}
        <p className="mt-10 text-[10rem] font-black leading-none">{countdown || 1}</p>
      </div>
    )
  }

  // ── ตอบ / ปิดรับ / เฉลย ────────────────────────────────────────
  if (['answering', 'locked', 'reveal'].includes(phase) && question) {
    const revealed = phase === 'reveal'

    return (
      <div className="flex min-h-screen w-full flex-col p-6" style={skinStyle}>
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold opacity-60">
            {t('staff.quiz.questionNo', { n: (session.current_index ?? 0) + 1 })}
          </span>
          {phase === 'answering' && (
            <span
              className={`font-black tabular-nums ${preset.timerClass}`}
              style={{ color: skin.accent }}
            >
              {secondsLeft}
            </span>
          )}
          {phase === 'locked' && (
            <span className="text-2xl font-bold opacity-60">{t('quiz.stage.locked')}</span>
          )}
        </div>

        <p
          className={`mt-4 text-center font-black leading-tight ${preset.questionClass}`}
        >
          {question.text}
        </p>

        {question.media_url && question.media_kind === 'video' && (
          // ต้อง muted ไม่งั้นเบราว์เซอร์บล็อก autoplay แล้วจอจะค้างเป็นเฟรมแรก
          // เสียงบนรถบัสไม่ควรดังอยู่แล้ว ลำโพงรถใช้ประกาศ
          <video
            key={question.id}
            src={question.media_url}
            autoPlay
            muted
            playsInline
            loop
            className="mx-auto mt-4 max-h-[28vh] rounded-2xl object-contain"
          />
        )}

        {question.media_url && question.media_kind !== 'video' && (
          <img
            src={question.media_url}
            alt=""
            className="mx-auto mt-4 max-h-[28vh] rounded-2xl object-contain"
          />
        )}

        {/* ข้อเดาตัวเลข — จุดที่ทยอยขึ้นระหว่างรอ */}
        {question.kind === 'numeric' ? (
          <div className="mt-auto flex flex-col items-center gap-4 pb-6">
            {revealed ? (
              <>
                <p className="text-3xl font-bold opacity-60">{t('quiz.answerIs')}</p>
                <p className="text-[8rem] font-black leading-none">{reveal.correct_number}</p>
                <div className="flex gap-6 text-2xl font-bold">
                  {(reveal.closest ?? []).map((c, i) => (
                    <span key={i} style={i === 0 ? { color: skin.accent } : { opacity: 0.7 }}>
                      {i + 1}. {c.name} · {c.value}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap justify-center gap-2">
                  {liveNumbers.map((n, i) => (
                    <span
                      key={i}
                      className="rounded-full px-4 py-2 text-2xl font-bold tabular-nums"
                      style={{ background: skin.panel }}
                    >
                      {n}
                    </span>
                  ))}
                </div>
                <p className="text-2xl font-bold opacity-50">
                  {liveNumbers.length} {t('quiz.stage.sent')}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="mt-auto grid grid-cols-2 gap-4 pb-4">
            {labels.map((label, i) => {
              const s = styles[i] ?? styles[0]
              const isCorrect = revealed && reveal.correct_index === i
              const dim = revealed && !isCorrect
              const n = reveal.stats?.[String(i)] ?? 0
              const pct = totalAnswers ? Math.round((n / totalAnswers) * 100) : 0

              return (
                <div
                  key={i}
                  className={`relative flex min-h-[18vh] items-center gap-4 overflow-hidden px-6 py-4 ${
                    preset.animate ? 'transition-all duration-300' : ''
                  } ${dim ? 'opacity-25' : ''}`}
                  style={{
                    borderRadius: skin.radius,
                    // neon: กรอบเรืองแสงพื้นโปร่ง / day: บล็อกสีทึบตัวหนังสือขาว
                    background: skin.outlineOptions ? 'transparent' : s.color,
                    color: skin.outlineOptions ? s.color : '#fff',
                    border: skin.outlineOptions ? `3px solid ${s.color}` : 'none',
                    boxShadow: skin.outlineOptions
                      ? `inset 0 0 90px -40px ${s.color}, 0 0 26px -12px ${s.color}`
                      : 'none',
                    outline: isCorrect ? `8px solid ${skin.gold}` : 'none',
                    outlineOffset: '3px',
                  }}
                >
                  <OptionShape shape={s.shape} size={64} />
                  {preset.showOptionText && (
                    <span className={`min-w-0 flex-1 font-extrabold leading-tight ${preset.optionClass}`}>
                      {label}
                    </span>
                  )}
                  {revealed && (
                    <span className="flex-none text-3xl font-black tabular-nums">
                      {n} · {pct}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {revealed && reveal.explain && (
          <p className="pb-4 text-center text-2xl opacity-70">{reveal.explain}</p>
        )}
      </div>
    )
  }

  // ── กระดานอันดับ / จบเกม ───────────────────────────────────────
  return (
    <div className={shell} style={skinStyle}>
      <p className="text-3xl font-bold opacity-60">
        {phase === 'finished' ? t('quiz.stage.gameOver') : t('quiz.stage.leaderboard')}
      </p>

      {session.team_mode ? (
        <>
          {/* คะแนนทีมคือ "เฉลี่ยต่อคน" ไม่ใช่ผลรวม — เพราะลูกทัวร์เลือกทีมเอง
              ทีมจึงขนาดไม่เท่ากัน ต้องโชว์จำนวนคนกำกับด้วย ไม่งั้นตัวเลขดูลอยมา */}
          <ol className="mt-8 w-full max-w-3xl space-y-3">
            {teamBoard.slice(0, preset.leaderboardRows).map((team) => {
              const st = teamStyle(team.color_index)
              return (
                <li
                  key={team.id}
                  className="flex items-center gap-5 px-6 py-4"
                  style={{
                    background: team.rank === 1 ? st.color : skin.panel,
                    borderRadius: skin.radius,
                  }}
                >
                  <span className="w-14 text-4xl font-black tabular-nums">{team.rank}</span>
                  <span className="text-4xl leading-none">{st.badge}</span>
                  <span className="min-w-0 flex-1 truncate text-4xl font-extrabold">
                    {team.name}
                  </span>
                  <span className="text-2xl font-bold opacity-70">
                    {team.member_count} {t('quiz.stage.people')}
                  </span>
                  <span className="text-4xl font-black tabular-nums">{team.avg_score}</span>
                </li>
              )
            })}
          </ol>

          <p className="mt-6 text-xl opacity-50">{t('quiz.stage.avgNote')}</p>
        </>
      ) : (
        <ol className="mt-8 w-full max-w-3xl space-y-3">
          {board.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-5 px-6 py-4"
              style={{
                background: row.rank === 1 ? skin.gold : skin.panel,
                color: row.rank === 1 ? '#241a00' : skin.ink,
                borderRadius: skin.radius,
              }}
            >
              <span className="w-14 text-4xl font-black tabular-nums">{row.rank}</span>
              <span className="min-w-0 flex-1 truncate text-4xl font-extrabold">
                {row.display_name}
              </span>
              <span className="text-4xl font-black tabular-nums">{row.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
