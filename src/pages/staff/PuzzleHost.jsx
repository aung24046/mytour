import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useQuizSession, useRoomHeadcount } from '../../lib/useQuizSession'
import {
  nextQuestion, lockAndReveal, setSessionState, resolveHostToken, stageUrl,
  fetchTeamLeaderboard, renameTeam, deleteTeam,
} from '../../lib/quizHost'
import { teamStyle } from '../../lib/quizStyle'
import {
  openHint, fetchPuzzleStats, fetchNearMisses, acceptAnswer,
} from '../../lib/puzzleHost'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'
import HostClaim from '../../components/quiz/HostClaim'

// มือถือคนคุมเกม — จอสั่งงานอย่างเดียว
//
// สองอย่างที่หน้านี้มีแล้วควิซไม่มี:
//   1. ปุ่มเปิดคำใบ้ — และต้อง "เห็นเนื้อคำใบ้ก่อนกด" เพราะคนคุมเกมต้องรู้ว่า
//      กำลังจะแจกอะไรให้ห้อง ไม่ใช่กดแล้วค่อยอ่านพร้อมลูกทัวร์
//   2. รายการคำที่เกือบถูก — ไม่มีวันเขียนกฎครอบคลุมภาษาไทยได้หมด
//      แต่คนถือไมค์ตัดสินได้ในครึ่งวินาทีว่า "กะละแม" คือคนที่รู้คำตอบ

export default function PuzzleHost() {
  const { sessionId } = useParams()
  const { t } = useTranslation()

  const [ready, setReady] = useState(false)
  const [stats, setStats] = useState({ solved: 0, guesses: 0, online: 0, total: 0 })
  const [near, setNear] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hintPreview, setHintPreview] = useState([])
  const [teamBoard, setTeamBoard] = useState([])
  const [noTeamCount, setNoTeamCount] = useState(0)

  const { session, question, phase, msLeft } = useQuizSession(sessionId)
  const headcount = useRoomHeadcount(sessionId)

  useEffect(() => {
    setReady(Boolean(resolveHostToken(sessionId)))
  }, [sessionId])

  const questionId = session?.current_question_id ?? null
  const live = phase === 'answering' || phase === 'countdown' || phase === 'locked'

  // poll ไม่ใช่ realtime โดยตั้งใจ — 40 คนเดารัวๆ = event ท่วมจอทุกเครื่อง
  const tick = useCallback(async () => {
    if (!sessionId || !questionId) return
    try {
      const [s, n] = await Promise.all([
        fetchPuzzleStats(sessionId, questionId),
        fetchNearMisses(sessionId, questionId),
      ])
      setStats(s)
      setNear(n)
    } catch {
      // เน็ตสะดุดบนรถเป็นเรื่องปกติ — รอบหน้าค่อยว่ากัน ไม่ต้องขึ้น error ให้ตกใจ
    }
  }, [sessionId, questionId])

  // ข้อใหม่ = ล้างตัวเลขข้อเก่า ไม่งั้นชื่อผู้ชนะข้อที่แล้วค้างอยู่จนกว่า poll รอบแรกจะกลับมา
  useEffect(() => {
    setStats({ solved: 0, guesses: 0, online: 0, total: 0 })
    setNear([])
  }, [questionId])

  // เฉลยเองอัตโนมัติ (ครบจำนวนคนตอบถูก) = poll หยุดทันทีที่เฟสเปลี่ยน
  // ดึงอีกรอบตอนเข้าเฉลย ชื่อคน/ทีมที่ตอบถูกจะได้ไม่หลุดไป
  useEffect(() => {
    if (phase === 'reveal') tick()
  }, [phase, tick])

  useEffect(() => {
    if (!live) return undefined
    tick()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tick()
    }, 1500)
    return () => clearInterval(timer)
  }, [live, tick])

  // ── ทีม ── กระดานทีม + คนที่ยังไม่เลือกทีม (poll เบาๆ แบบเดียวกับ QuizHost)
  // คะแนนทีมของเกมนี้ = คะแนนรวม (quiz_team_leaderboard เรียงด้วย total_score ให้แล้ว)
  const loadTeams = useCallback(async () => {
    if (!sessionId) return
    try {
      const [board, { data: players }] = await Promise.all([
        fetchTeamLeaderboard(sessionId),
        supabase.from('quiz_players').select('team_id').eq('session_id', sessionId),
      ])
      setTeamBoard(board ?? [])
      setNoTeamCount((players ?? []).filter((p) => !p.team_id).length)
    } catch {
      // เน็ตสะดุด — รอบหน้าค่อยว่ากัน
    }
  }, [sessionId])

  useEffect(() => {
    if (!session?.team_mode) return undefined
    loadTeams()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadTeams()
    }, 5000)
    return () => clearInterval(timer)
  }, [session?.team_mode, loadTeams])

  // เนื้อคำใบ้ขั้นถัดไป — ต้องเห็นก่อนกด
  // ดึงมาจาก hint_payload ที่เปิดไปแล้ว + ขั้นถัดไปดึงตอนกดจริง (เฉลยอยู่ในตารางปิด)
  useEffect(() => {
    setHintPreview(session?.hint_payload ?? [])
  }, [session?.hint_payload])

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      tick()
      if (session?.team_mode) loadTeams()
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  // เครื่องนี้ยังไม่มี token ของห้อง — ใส่ PIN ทีมงานแล้วคุมต่อได้เลย (ไม่ต้องกลับไปเปิดห้องใหม่)
  if (!ready) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <StaffHeader icon="lock" title={t('puzzle.title')} subtitle={session?.name ?? ''} />
        <HostClaim sessionId={sessionId} onClaimed={() => setReady(true)} />
      </div>
    )
  }

  const teamMode = Boolean(session?.team_mode)
  const hintTotal = question?.puzzle?.hint_count ?? 0
  const hintLevel = session?.hint_level ?? 0
  const secondsLeft = Math.max(Math.ceil(msLeft / 1000), 0)

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <StaffHeader icon="game" title={t('puzzle.title')} subtitle={session?.name ?? ''} />

      <div className="mx-auto max-w-md space-y-4 p-4">
        {error && (
          <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
        )}

        <a
          href={stageUrl(sessionId, 'puzzle')}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-bold text-ink"
        >
          <Icon name="expand" size={16} />
          {t('puzzle.host.openStage')}
        </a>

        {/* ── สถานะ ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <p className="text-sm font-bold text-ink">
            {t('puzzle.host.progress', {
              index: (session?.current_index ?? -1) + 1,
              state: t(`puzzle.state.${phase}`, { defaultValue: phase }),
            })}
            {live && phase === 'answering' ? ` · ${secondsLeft} ${t('puzzle.host.sec')}` : ''}
          </p>

          {/* "เดามาแล้ว 74 ครั้ง แต่ถูก 12" = ห้องกำลังตัน
              ต่างจาก "เดา 15 ถูก 12" = ข้อง่ายไป — ตัวเลขคู่นี้คือสิ่งที่ใช้ตัดสิน
              ว่าจะเปิดคำใบ้ขั้นถัดไปหรือปิดรับเลย */}
          <p className="mt-1 text-sm text-ink-muted">
            {/* ห้องรอยังไม่มีข้อ = stats ไม่เคยดึง — นับคนเองจาก useRoomHeadcount */}
            {phase === 'lobby' || !questionId
              ? t('puzzle.host.lobbyCount', { joined: headcount.joined, online: headcount.online })
              : t('puzzle.host.stats', {
                  solved: stats.solved,
                  online: headcount.online,
                  guesses: stats.guesses,
                })}
          </p>

          {/* ใครตอบถูกคนแรก (และทีมไหน) — ห้องแบบทีมตั้งไว้ 1 คนจะเฉลยเองทันที
              คนคุมเกมต้องรู้ชื่อทีมเพื่อประกาศ ไม่ใช่เห็นแค่ "ตอบถูก 1" */}
          {stats.winner_name && (phase === 'answering' || phase === 'locked' || phase === 'reveal') && (
            <p className="mt-2 rounded-xl bg-success-bg px-3 py-2 text-sm font-bold text-success-text">
              {t(stats.winner_team ? 'puzzle.host.solvedByTeam' : 'puzzle.host.solvedBy', {
                name: stats.winner_name,
                team: stats.winner_team,
                sec: stats.winner_seconds ?? 0,
              })}
            </p>
          )}

          {session?.solve_limit != null && (
            <p className="mt-1 text-xs text-ink-faint">
              {session.solve_limit === 0
                ? t('puzzle.host.roomSolveLimitOff')
                : t('puzzle.host.roomSolveLimit', { n: session.solve_limit })}
            </p>
          )}
        </section>

        {/* ── ทีม ───────────────────────────────────────────── */}
        {teamMode && (
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <p className="text-sm font-bold text-ink">{t('puzzle.host.teams')}</p>

            {/* คนที่ไม่มีทีมตอบถูกก็ไม่เข้าคะแนนทีมไหนเลย — เตือนก่อนกดเริ่ม */}
            {noTeamCount > 0 && phase === 'lobby' && (
              <p className="mt-2 rounded-xl bg-warning-bg px-3 py-2 text-sm font-semibold text-warning-text">
                {t('puzzle.host.noTeamWarn', { n: noTeamCount })}
              </p>
            )}

            {teamBoard.length === 0 ? (
              <p className="mt-1 text-sm text-ink-faint">{t('puzzle.host.noTeams')}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {teamBoard.map((team) => {
                  const st = teamStyle(team.color_index)
                  return (
                    <li key={team.id} className="flex items-center gap-2 text-sm">
                      <span className="h-3.5 w-3.5 flex-none rounded-full" style={{ background: st.color }} />
                      <span className="min-w-0 flex-1 truncate font-bold text-ink">{team.name}</span>
                      <span className="flex-none text-xs text-ink-muted">
                        {t('puzzle.host.teamRow', { n: team.member_count, score: team.total_score })}
                      </span>
                      {/* ชื่อทีมลูกทัวร์พิมพ์เอง แล้วขึ้นจอใหญ่ — ต้องแก้/ลบได้ทันที */}
                      <button
                        type="button"
                        aria-label={t('common.edit')}
                        onClick={() => {
                          const next = window.prompt(t('staff.quiz.renameTeam'), team.name)
                          if (next && next.trim()) {
                            run(async () => {
                              await renameTeam(sessionId, team.id, next.trim())
                              loadTeams()
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
                            loadTeams()
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
            )}
          </section>
        )}

        {/* ── คำใบ้ ─────────────────────────────────────────── */}
        {hintTotal > 0 && (
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <p className="text-sm font-bold text-ink">
              {t('puzzle.host.hintTitle', { level: hintLevel, total: hintTotal })}
            </p>

            {hintPreview.map((h) => (
              <p key={h.step} className="mt-1 text-sm text-ink-muted">
                💡 {h.body}
              </p>
            ))}

            {hintLevel < hintTotal && (
              <Button
                className="mt-3"
                variant="secondary"
                disabled={busy || !live}
                onClick={() => run(() => openHint(sessionId, hintLevel + 1))}
              >
                {t('puzzle.host.openHint', { n: hintLevel + 1, total: hintTotal })}
              </Button>
            )}
          </section>
        )}

        {/* ── คำตอบที่เกือบถูก ─────────────────────────────── */}
        {near.length > 0 && phase !== 'reveal' && (
          <section className="rounded-2xl border border-warning bg-warning-bg p-4">
            <p className="text-sm font-bold text-warning-text">{t('puzzle.host.nearTitle')}</p>
            <p className="mt-0.5 text-xs text-warning-text/80">{t('puzzle.host.nearHint')}</p>
            <ul className="mt-2 space-y-1.5">
              {near.map((n) => (
                <li key={n.guess_text} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-bold text-ink">{n.guess_text}</span>
                  <span className="text-xs text-ink-muted">
                    {t('puzzle.host.nearPeople', { n: n.people })}
                  </span>
                  <Button
                    fullWidth={false}
                    className="px-3 py-1.5 text-sm"
                    disabled={busy}
                    onClick={() => run(() => acceptAnswer(sessionId, questionId, n.guess_text))}
                  >
                    {t('puzzle.host.accept')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── ปุ่มคุมเกม ────────────────────────────────────── */}
        <section className="space-y-2">
          {phase === 'lobby' || phase === 'scoreboard' || phase === 'reveal' ? (
            <Button
              disabled={busy}
              onClick={() => run(() => nextQuestion(sessionId, session?.current_index ?? -1))}
            >
              {phase === 'lobby' ? t('puzzle.host.start') : t('puzzle.host.next')}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => run(() => lockAndReveal(sessionId))}>
              {t('puzzle.host.lockReveal')}
            </Button>
          )}

          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => setSessionState(sessionId, 'scoreboard'))}
            >
              {t('puzzle.host.scoreboard')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => setSessionState(sessionId, 'finished'))}
            >
              {t('puzzle.host.finish')}
            </Button>
          </div>
        </section>

        <p className="text-center text-xs text-ink-faint">{t('puzzle.host.shoutReminder')}</p>
      </div>
    </div>
  )
}
