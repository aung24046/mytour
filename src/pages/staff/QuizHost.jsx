import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession } from '../../lib/staffSession'
import { useQuizSession, useQuizAnswerCount } from '../../lib/useQuizSession'
import {
  resolveHostToken, nextQuestion, lockAnswers, revealAnswer, lockAndReveal,
  setSessionState, removePlayer, fetchPendingPlayers, fetchLeaderboard, stageUrl,
  fetchTeamLeaderboard, renameTeam, deleteTeam, replaySession,
} from '../../lib/quizHost'
import { optionStyles, optionLabels, teamStyle } from '../../lib/quizStyle'
import OptionShape from '../../components/quiz/OptionShape'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// จอสั่งงานของคนคุมเกม — ถือมือเดียว อีกมือถือไมค์
//
// หลักการเดียวกับ BingoHost: ต้องมีปุ่มหนีทุกสถานการณ์
// หน้างานจริงมีเรื่องไม่คาดคิดเสมอ (ไมค์ดับ อาหารมาเสิร์ฟ แขกเข้าห้องน้ำ)
// ปุ่มที่ขาดไม่ได้คือ "ข้ามข้อนี้" — รูปไม่ขึ้นหรือคำถามผิดต้องหนีได้ทันที
//
// ปุ่มเด่นที่สุดคือ "ปิดรับ + เฉลยเลย" ซึ่งจะสว่างขึ้นเองเมื่อทุกคนที่ยัง online ส่งครบ
// 45 วิของข้อเดาตัวเลขเป็นแค่เพดาน ไม่ใช่เวลาที่ต้องยืนรอจริง

export default function QuizHost() {
  const { sessionId } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const staffSession = getStaffSession()

  const [token, setToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState([])
  const [board, setBoard] = useState([])
  const [players, setPlayers] = useState([])
  const [showPlayers, setShowPlayers] = useState(false)
  const [copied, setCopied] = useState(false)
  const [teamBoard, setTeamBoard] = useState([])

  const { session, question, phase, msLeft, loading } = useQuizSession(sessionId)

  useEffect(() => {
    setToken(resolveHostToken(sessionId))
  }, [sessionId])

  const answering = phase === 'answering' || phase === 'countdown'
  const count = useQuizAnswerCount(sessionId, session?.current_question_id, answering)

  // ทุกคนที่ยัง online ส่งครบแล้วหรือยัง
  // ⚠️ เทียบกับ online ไม่ใช่ total — คนที่แบตหมด/ปิดแอปไปแล้วต้องไม่ค้างเกมไว้ทั้งห้อง
  const allIn = count.online > 0 && count.answered >= count.online

  useEffect(() => {
    if (!answering || !session?.current_question_id) {
      setPending([])
      return undefined
    }
    let alive = true
    const tick = async () => {
      const rows = await fetchPendingPlayers(sessionId, session.current_question_id, 3)
      if (alive) setPending(rows)
    }
    tick()
    const timer = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [answering, sessionId, session?.current_question_id])

  useEffect(() => {
    if (!['reveal', 'scoreboard', 'finished'].includes(phase)) return
    fetchLeaderboard(sessionId, 10).then(setBoard)
  }, [phase, sessionId, session?.current_index])

  useEffect(() => {
    if (!session?.team_mode) return undefined
    const tick = () => fetchTeamLeaderboard(sessionId).then(setTeamBoard)
    tick()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tick()
    }, 5000)
    return () => clearInterval(timer)
  }, [sessionId, session?.team_mode])

  const loadPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('quiz_players')
      .select('id, display_name, kind, score, team_id, last_seen_at')
      .eq('session_id', sessionId)
      .order('joined_at')
    setPlayers(data ?? [])
  }, [sessionId])

  useEffect(() => {
    loadPlayers()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadPlayers()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadPlayers])

  const run = useCallback(async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  // เล่นชุดเดิมซ้ำ = เปิดห้องใหม่จาก set เดิม แล้วเด้งไปคุมห้องใหม่ทันที
  // (ห้องเก่ายังอยู่ครบสำหรับดูรายงานย้อนหลัง)
  const handleReplay = useCallback(() => {
    run(async () => {
      const row = await replaySession({
        session,
        staffId: staffSession?.staff?.id ?? null,
      })
      if (row?.session_id) navigate(`/staff/quiz/host/${row.session_id}`)
    })
  }, [run, session, staffSession, navigate])

  const noTeamCount = useMemo(
    () => (session?.team_mode ? players.filter((p) => !p.team_id).length : 0),
    [players, session?.team_mode]
  )

  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000))
  const labels = useMemo(() => optionLabels(question, t), [question, t])
  const styles = optionStyles(question?.kind)

  if (!token) {
    return (
      <div className="min-h-screen bg-canvas">
        <StaffHeader title={t('staff.quiz.hostTitle')} icon="game" backTo="/staff/quiz" />
        <div className="mx-auto max-w-md px-4 pt-8 text-center">
          <Icon name="lock" size={36} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-base font-extrabold text-ink">{t('staff.quiz.noToken')}</p>
          <p className="mt-1 text-sm text-ink-muted">{t('staff.quiz.noTokenHint')}</p>
        </div>
      </div>
    )
  }

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-canvas">
        <StaffHeader title={t('staff.quiz.hostTitle')} icon="game" backTo="/staff/quiz" />
        <p className="mx-auto max-w-md px-4 pt-8 text-center text-sm text-ink-muted">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas pb-20">
      <StaffHeader
        title={session.name}
        subtitle={t(`staff.quiz.state.${session.state}`)}
        icon="game"
        backTo="/staff/quiz"
      />

      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {error && (
          <p className="rounded-control bg-danger-bg px-3 py-2 text-sm font-semibold text-danger-text">
            {error}
          </p>
        )}

        {/* ── ลิงก์จอใหญ่ ────────────────────────────────────── */}
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3">
          <Icon name="expand" size={18} className="flex-none text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
            {t('staff.quiz.stageHint')}
          </span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(stageUrl(sessionId))
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="flex-none rounded-full bg-surface-sunken px-3 py-1.5 text-xs font-bold text-ink"
          >
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          <a
            href={stageUrl(sessionId)}
            target="_blank"
            rel="noreferrer"
            className="flex-none rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white"
          >
            {t('staff.quiz.openStage')}
          </a>
        </div>

        {/* ── สถานะข้อปัจจุบัน ───────────────────────────────── */}
        {session.state === 'lobby' ? (
          <div className="rounded-2xl border border-line bg-surface p-5 text-center shadow-card">
            <p className="text-4xl font-black text-ink">{players.length}</p>
            <p className="mt-1 text-sm text-ink-muted">{t('staff.quiz.joined')}</p>
            <div className="mt-4">
              <Button disabled={busy} onClick={() => run(() => nextQuestion(sessionId, -1))}>
                {t('staff.quiz.startGame')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-ink-muted">
                {t('staff.quiz.questionNo', { n: (session.current_index ?? 0) + 1 })}
                {question ? ` · ${t(`quiz.kind.${question.kind}`)}` : ''}
              </span>
              {answering && (
                <span className="text-2xl font-black tabular-nums text-ink">{secondsLeft}</span>
              )}
            </div>

            {question && (
              <p className="mt-1.5 text-base font-extrabold leading-snug text-ink">
                {question.text}
              </p>
            )}

            {/* ตัวเลือก + เฉลยให้ทีมงานเห็นเสมอ (คนคุมเกมต้องรู้คำตอบ) */}
            {question && question.kind !== 'numeric' && (
              <div className="mt-2 space-y-1">
                {labels.map((label, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm"
                    style={{ '--opt': (styles[i] ?? styles[0]).color }}
                  >
                    <OptionShape
                      shape={(styles[i] ?? styles[0]).shape}
                      size={14}
                      className="text-[color:var(--opt)]"
                    />
                    <span
                      className={
                        session.reveal_payload?.correct_index === i
                          ? 'font-extrabold text-success-text'
                          : 'text-ink-muted'
                      }
                    >
                      {label}
                    </span>
                    {session.reveal_payload?.stats?.[String(i)] !== undefined && (
                      <span className="ml-auto text-xs font-bold text-ink-faint">
                        {session.reveal_payload.stats[String(i)]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {answering && (
              <>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-2xl font-black tabular-nums text-ink">
                    {count.answered}
                  </span>
                  <span className="text-sm font-bold text-ink-muted">
                    / {count.online} {t('staff.quiz.online')}
                  </span>
                  {allIn && (
                    <span className="ml-auto rounded-full bg-success-bg px-2.5 py-1 text-xs font-extrabold text-success-text">
                      {t('staff.quiz.allIn')}
                    </span>
                  )}
                </div>

                {/* ชื่อคนที่ยังไม่ส่ง — ไว้เรียกไมค์ "รออีกคนเดียวนะครับ พี่สมชาย" */}
                {pending.length > 0 && (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    {t('staff.quiz.waitingFor')}: {pending.map((p) => p.display_name).join(', ')}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── ปุ่มสั่งงาน ─────────────────────────────────────── */}
        {session.state !== 'lobby' && session.state !== 'finished' && (
          <div className="space-y-2">
            {/* ต้องเป็น phase === 'answering' ไม่ใช่ answering (ซึ่งรวม countdown ด้วย)
                ไม่งั้นกดปิดรับ+เฉลยได้ตั้งแต่ยังนับถอยหลัง = เฉลยข้อที่ยังไม่มีใครได้ตอบ */}
            {phase === 'answering' && (
              <Button
                disabled={busy}
                variant={allIn ? 'accent' : 'primary'}
                onClick={() => run(() => lockAndReveal(sessionId))}
              >
                {t('staff.quiz.lockAndReveal')}
              </Button>
            )}

            {session.state === 'locked' && (
              <Button disabled={busy} onClick={() => run(() => revealAnswer(sessionId))}>
                {t('staff.quiz.reveal')}
              </Button>
            )}

            {['reveal', 'scoreboard'].includes(session.state) && (
              <Button
                disabled={busy}
                onClick={() => run(() => nextQuestion(sessionId, session.current_index))}
              >
                {t('staff.quiz.nextQuestion')}
              </Button>
            )}

            {session.state === 'reveal' && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => run(() => setSessionState(sessionId, 'scoreboard'))}
              >
                {t('staff.quiz.showBoard')}
              </Button>
            )}

            <div className="flex gap-2">
              {phase === 'answering' && (
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => run(() => lockAnswers(sessionId))}
                >
                  {t('staff.quiz.lockOnly')}
                </Button>
              )}
              <Button
                variant="ghost"
                className="flex-1"
                disabled={busy}
                onClick={() => run(() => nextQuestion(sessionId, session.current_index))}
              >
                {t('staff.quiz.skip')}
              </Button>
            </div>

            <Button
              variant="danger"
              disabled={busy}
              onClick={() => run(() => setSessionState(sessionId, 'finished'))}
            >
              {t('staff.quiz.finish')}
            </Button>
          </div>
        )}

        {/* ── จบเกมแล้ว — เล่นชุดเดิมซ้ำ / ดูสรุป ───────── */}
        {session.state === 'finished' && (
          <div className="space-y-2 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <p className="text-sm text-ink-muted">{t('staff.quiz.replayHint')}</p>
            <Button disabled={busy} onClick={handleReplay}>
              {t('staff.quiz.replay')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigate(`/staff/quiz/report/${sessionId}`)}
            >
              {t('staff.quiz.viewReport')}
            </Button>
          </div>
        )}

        {/* ── กระดานอันดับ ───────────────────────────────────── */}
        {board.length > 0 && (
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-muted">
              {t('staff.quiz.leaderboard')}
            </h2>
            <ol className="mt-2 space-y-1">
              {board.map((row) => (
                <li key={row.id} className="flex items-center gap-2 text-sm">
                  <span className="w-5 font-black text-ink-faint">{row.rank}</span>
                  <span className="min-w-0 flex-1 truncate font-bold text-ink">
                    {row.display_name}
                  </span>
                  <span className="font-extrabold tabular-nums text-ink">{row.score}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* ── ทีม ─────────────────────────────────────────────── */}
        {session.team_mode && (
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-muted">
              {t('staff.quiz.teams')}
            </h2>

            {/* คนที่ยังไม่เลือกทีมจะได้ 0 ทั้งเกมและไม่มีผลกับทีมไหนเลย
                ต้องเตือนก่อนกดเริ่ม ไม่ใช่ให้ไปรู้ตอนจบเกม */}
            {noTeamCount > 0 && session.state === 'lobby' && (
              <p className="mt-2 rounded-control bg-warning-bg px-3 py-2 text-sm font-semibold text-warning-text">
                {t('staff.quiz.noTeamWarn', { n: noTeamCount })}
              </p>
            )}

            <ul className="mt-2 space-y-1.5">
              {teamBoard.map((team) => {
                const st = teamStyle(team.color_index)
                return (
                  <li key={team.id} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-3.5 w-3.5 flex-none rounded-full"
                      style={{ background: st.color }}
                    />
                    <span className="min-w-0 flex-1 truncate font-bold text-ink">
                      {team.name}
                    </span>
                    <span className="flex-none text-xs text-ink-muted">
                      {team.member_count} {t('staff.quiz.players')} · {team.avg_score}
                    </span>
                    {/* ชื่อทีมลูกทัวร์พิมพ์เอง แล้วขึ้นจอใหญ่ต่อหน้าทุกคน — ต้องแก้ได้ทันที */}
                    <button
                      type="button"
                      aria-label={t('common.edit')}
                      onClick={() => {
                        const next = window.prompt(t('staff.quiz.renameTeam'), team.name)
                        if (next && next.trim()) {
                          run(async () => {
                            await renameTeam(sessionId, team.id, next.trim())
                            fetchTeamLeaderboard(sessionId).then(setTeamBoard)
                          })
                        }
                      }}
                      className="flex-none rounded-full p-1 text-ink-faint hover:bg-surface-sunken"
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      type="button"
                      aria-label={t('common.delete')}
                      onClick={() =>
                        run(async () => {
                          await deleteTeam(sessionId, team.id)
                          fetchTeamLeaderboard(sessionId).then(setTeamBoard)
                          loadPlayers()
                        })
                      }
                      className="flex-none rounded-full p-1 text-ink-faint hover:bg-danger-bg hover:text-danger-text"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* ── คนในห้อง ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <button
            type="button"
            onClick={() => setShowPlayers((v) => !v)}
            className="flex w-full items-center gap-2"
          >
            <Icon name="people" size={18} className="text-ink-muted" />
            <span className="flex-1 text-left text-sm font-extrabold text-ink">
              {t('staff.quiz.playersInRoom', { n: players.length })}
            </span>
            <Icon
              name="chevronRight"
              size={16}
              className={`text-ink-faint transition ${showPlayers ? 'rotate-90' : ''}`}
            />
          </button>

          {showPlayers && (
            <ul className="mt-2 space-y-1">
              {players.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{p.display_name}</span>
                  {p.kind === 'visitor' && (
                    <span className="flex-none rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold text-ink-faint">
                      {t('staff.quiz.visitor')}
                    </span>
                  )}
                  {/* visitor พิมพ์ชื่อเองได้ และชื่อนั้นขึ้นจอใหญ่ต่อหน้าทุกคน — ต้องเตะออกได้ */}
                  <button
                    type="button"
                    aria-label={t('staff.quiz.kick')}
                    onClick={() => {
                      // ถังขยะ 15px บนมือถือที่ถือมือเดียว — กดพลาดแล้วคนนั้น
                      // เสียคะแนนทั้งหมด (quiz_answers cascade) และต้องเข้าห้องใหม่
                      if (!window.confirm(t('staff.quiz.confirmKick', { name: p.display_name }))) {
                        return
                      }
                      run(async () => {
                        await removePlayer(sessionId, p.id)
                        loadPlayers()
                      })
                    }}
                    className="flex-none rounded-full p-1 text-ink-faint hover:bg-danger-bg hover:text-danger-text"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
