import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useQuizSession, useRoomPlayers } from '../../lib/useQuizSession'
import {
  nextQuestion, lockAndReveal, setSessionState, resolveHostToken, stageUrl,
  fetchTeamLeaderboard, renameTeam, deleteTeam,
} from '../../lib/quizHost'
import { teamStyle } from '../../lib/quizStyle'
import {
  fetchWordsKey, openLetter, undoLetter, fetchWordsStats, fetchNearMisses, acceptAnswer,
  useWordsAnswerMode,
} from '../../lib/wordsHost'
import { hostCells, poolTiles } from '../../lib/wordsMask'
import { wordGame, useGameT } from '../../lib/wordGames'
import WordBoard from '../../components/words/WordBoard'
import ShufflePool from '../../components/words/ShufflePool'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'
import HostClaim from '../../components/quiz/HostClaim'
import PlayerRoster from '../../components/quiz/PlayerRoster'

// มือถือคนคุมเกม What Words / Word Shuffle — จอสั่งงานอย่างเดียว โครงเดียวกับ PuzzleHost
// game = 'words' | 'shuffle' — Word Shuffle เพิ่มแค่กองตัวสลับใต้กระดาน (ตัวที่เปิดแล้วจางลง)
//
// สิ่งที่หน้านี้มีแล้วเกมอื่นไม่มี: กระดานคำแบบ "เห็นตัวที่ซ่อนจางๆ"
//   คนคุมเกมต้องรู้ว่ากำลังจะเปิดตัวไหนให้ทั้งห้อง ไม่ใช่กดแล้วค่อยเห็นพร้อมลูกทัวร์
//   แตะช่องจางๆ = เปิดตัวนั้น · ปุ่ม "เปิดตัวถัดไป" = เปิดจากซ้ายไปขวา
// ตัวที่ซ่อนมาจาก quiz_words_key (ต้องมี token) — ตารางที่ลูกทัวร์อ่านได้ไม่มีตัวจริง
//
// ชุดแบบ "ไม่ต้องตอบ" (answer_mode = 'none'): ไม่มีใครส่งคำตอบ จึงซ่อนทุกอย่างที่เกี่ยวกับการตอบ
//   (ตอบถูกกี่คน · คนแรกที่ถูก · คำที่เกือบถูก · กระดานอันดับ) เหลือกระดานคำ + ปุ่มเปิดตัว + เฉลย

const UNDO_WINDOW_MS = 5000
const EMPTY_STATS = { solved: 0, guesses: 0, online: 0, total: 0 }

export default function WordsHost({ game: gameKey = 'words' }) {
  const G = wordGame(gameKey)
  const { sessionId } = useParams()
  const { t } = useTranslation()
  const tw = useGameT(G)

  const [ready, setReady] = useState(false)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [near, setNear] = useState([])
  const [key, setKey] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [teamBoard, setTeamBoard] = useState([])
  const [noTeamCount, setNoTeamCount] = useState(0)

  const { session, question, phase, msLeft, now } = useQuizSession(sessionId)
  const answerMode = useWordsAnswerMode(session?.set_id)
  // จำนวนคนนับเองทุกช่วง — ตัวเลขออนไลน์ของ stats มีเฉพาะตอนมีข้อ (ห้องรอเลยขึ้น 0 เสมอ)
  // รายชื่อ + จำนวนคนในห้อง — hook ตัวเดียวกันทั้ง 5 เกม
  const room = useRoomPlayers(sessionId)
  const headcount = room
  const watchOnly = answerMode === 'none'
  const typing = answerMode === 'type' // ระหว่างโหลด (null) ไม่ขึ้นตัวเลขการตอบ

  useEffect(() => {
    setReady(Boolean(resolveHostToken(sessionId)))
  }, [sessionId])

  const questionId = session?.current_question_id ?? null
  const live = phase === 'answering' || phase === 'countdown' || phase === 'locked'

  // คำตอบของข้อปัจจุบัน — ดึงใหม่ทุกครั้งที่เปลี่ยนข้อ
  useEffect(() => {
    setKey(null)
    setStats(EMPTY_STATS)
    setNear([])
    if (!ready || !questionId) return
    let alive = true
    fetchWordsKey(sessionId)
      .then((k) => {
        if (alive && k?.question_id === questionId) setKey(k)
      })
      .catch((err) => alive && setError(err.message ?? String(err)))
    return () => {
      alive = false
    }
  }, [ready, sessionId, questionId])

  // poll ไม่ใช่ realtime โดยตั้งใจ — 40 คนเดารัวๆ = event ท่วมจอทุกเครื่อง
  const tick = useCallback(async () => {
    if (!sessionId || !questionId) return
    try {
      const [s, n] = await Promise.all([
        fetchWordsStats(sessionId, questionId),
        fetchNearMisses(sessionId, questionId),
      ])
      setStats(s)
      setNear(n)
    } catch {
      // เน็ตสะดุดบนรถเป็นเรื่องปกติ — รอบหน้าค่อยว่ากัน
    }
  }, [sessionId, questionId])

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

  // ── ทีม ── (โครงเดียวกับ PuzzleHost — คะแนนทีม = คะแนนรวม)
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
      // รอบหน้าค่อยว่ากัน
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

  const opened = session?.hint_payload ?? []
  const cells = useMemo(() => hostCells(key?.cells ?? [], opened), [key?.cells, opened])
  const hiddenTotal = (key?.cells ?? []).filter((x) => x.h).length
  const openedCount = opened.filter((o) => Number.isInteger(o?.slot)).length
  const canUndo =
    live && session?.last_tile_at && now - new Date(session.last_tile_at).getTime() < UNDO_WINDOW_MS

  // เครื่องนี้ยังไม่มี token ของห้อง — ใส่ PIN ทีมงานแล้วคุมต่อได้เลย (ไม่ต้องกลับไปเปิดห้องใหม่)
  if (!ready) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <StaffHeader icon="lock" title={tw('title')} subtitle={session?.name ?? ''} />
        <HostClaim sessionId={sessionId} onClaimed={() => setReady(true)} />
      </div>
    )
  }

  const teamMode = Boolean(session?.team_mode)
  const secondsLeft = Math.max(Math.ceil(msLeft / 1000), 0)
  const canOpen = live && phase !== 'countdown' && !busy

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <StaffHeader icon={G.icon} title={tw('title')} subtitle={session?.name ?? ''} />

      <div className="mx-auto max-w-md space-y-4 p-4">
        {error && (
          <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
        )}

        <a
          href={stageUrl(sessionId, G.kind)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-bold text-ink"
        >
          <Icon name="expand" size={16} />
          {tw('host.openStage')}
        </a>

        {/* ── คำของข้อนี้ + เปิดตัวที่ซ่อน ─────────────────────── */}
        {questionId && key && (
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full bg-brand-lighter px-2.5 py-0.5 text-xs font-bold text-brand">
                {tw('category', { name: question?.words?.category ?? '' })}
              </span>
              <span className="text-xs text-ink-muted">
                {tw('host.answerIs', { answer: key.answer })}
              </span>
            </div>

            <WordBoard
              cells={cells}
              surface="phone"
              onSlotClick={canOpen ? (slot) => run(() => openLetter(sessionId, slot)) : undefined}
            />
            {G.shuffle && question?.words?.pool && (
              <ShufflePool tiles={poolTiles(question.words.pool, cells)} boardCells={cells} surface="phone" />
            )}
            <p className="text-center text-xs text-ink-faint">{tw('host.tapHint')}</p>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={!canOpen || openedCount >= hiddenTotal}
                onClick={() => run(() => openLetter(sessionId, null))}
              >
                {tw('host.openNext', { opened: openedCount, total: hiddenTotal })}
              </Button>
              {canUndo && (
                <Button
                  variant="ghost"
                  fullWidth={false}
                  className="px-3 py-2 text-sm"
                  disabled={busy}
                  onClick={() => run(() => undoLetter(sessionId))}
                >
                  {tw('host.undo')}
                </Button>
              )}
            </div>
          </section>
        )}

        {/* ── สถานะ ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <p className="text-sm font-bold text-ink">
            {tw('host.progress', {
              index: (session?.current_index ?? -1) + 1,
              state: tw(`state.${phase}`, { defaultValue: phase }),
            })}
            {live && phase === 'answering' ? ` · ${secondsLeft} ${tw('host.sec')}` : ''}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {phase === 'lobby' || !questionId
              ? tw('host.lobbyCount', { joined: headcount.joined, online: headcount.online })
              : watchOnly
                ? tw('host.watchStats', { online: headcount.online })
                : tw('host.stats', {
                    solved: stats.solved,
                    online: headcount.online,
                    guesses: stats.guesses,
                  })}
          </p>

          {typing && stats.winner_name && (phase === 'answering' || phase === 'locked' || phase === 'reveal') && (
            <p className="mt-2 rounded-xl bg-success-bg px-3 py-2 text-sm font-bold text-success-text">
              {tw(stats.winner_team ? 'host.solvedByTeam' : 'host.solvedBy', {
                name: stats.winner_name,
                team: stats.winner_team,
                sec: stats.winner_seconds ?? 0,
              })}
            </p>
          )}

          {typing && session?.solve_limit != null && (
            <p className="mt-1 text-xs text-ink-faint">
              {session.solve_limit === 0
                ? tw('host.roomSolveLimitOff')
                : tw('host.roomSolveLimit', { n: session.solve_limit })}
            </p>
          )}
        </section>

        {/* ── คนในห้อง ───────────────────────────────────────── */}
        {/* ห้องรอเปิดรายชื่อค้างไว้ — ช่วงที่ต้องดูว่าใครยังไม่เข้าคือก่อนเริ่มเกม */}
        <PlayerRoster
          players={room.players}
          joined={room.joined}
          online={room.online}
          loaded={room.loaded}
          defaultOpen={phase === 'lobby'}
        />

        {/* ── ทีม ───────────────────────────────────────────── */}
        {teamMode && (
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <p className="text-sm font-bold text-ink">{tw('host.teams')}</p>

            {noTeamCount > 0 && phase === 'lobby' && (
              <p className="mt-2 rounded-xl bg-warning-bg px-3 py-2 text-sm font-semibold text-warning-text">
                {tw('host.noTeamWarn', { n: noTeamCount })}
              </p>
            )}

            {teamBoard.length === 0 ? (
              <p className="mt-1 text-sm text-ink-faint">{tw('host.noTeams')}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {teamBoard.map((team) => {
                  const st = teamStyle(team.color_index)
                  return (
                    <li key={team.id} className="flex items-center gap-2 text-sm">
                      <span className="h-3.5 w-3.5 flex-none rounded-full" style={{ background: st.color }} />
                      <span className="min-w-0 flex-1 truncate font-bold text-ink">{team.name}</span>
                      <span className="flex-none text-xs text-ink-muted">
                        {tw('host.teamRow', { n: team.member_count, score: team.total_score })}
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

        {/* ── คำตอบที่เกือบถูก ─────────────────────────────── */}
        {typing && near.length > 0 && phase !== 'reveal' && (
          <section className="rounded-2xl border border-warning bg-warning-bg p-4">
            <p className="text-sm font-bold text-warning-text">{tw('host.nearTitle')}</p>
            <p className="mt-0.5 text-xs text-warning-text/80">{tw('host.nearHint')}</p>
            <ul className="mt-2 space-y-1.5">
              {near.map((n) => (
                <li key={n.guess_text} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-bold text-ink">{n.guess_text}</span>
                  <span className="text-xs text-ink-muted">
                    {tw('host.nearPeople', { n: n.people })}
                  </span>
                  <Button
                    fullWidth={false}
                    className="px-3 py-1.5 text-sm"
                    disabled={busy}
                    onClick={() => run(() => acceptAnswer(sessionId, questionId, n.guess_text))}
                  >
                    {tw('host.accept')}
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
              {phase === 'lobby' ? tw('host.start') : tw('host.next')}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => run(() => lockAndReveal(sessionId))}>
              {watchOnly ? tw('host.reveal') : tw('host.lockReveal')}
            </Button>
          )}

          <div className="flex gap-2">
            {/* ไม่ต้องตอบ = ไม่มีคะแนน กระดานอันดับจะว่างเปล่า */}
            {typing && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => setSessionState(sessionId, 'scoreboard'))}
              >
                {tw('host.scoreboard')}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => setSessionState(sessionId, 'finished'))}
            >
              {tw('host.finish')}
            </Button>
          </div>
        </section>

        {answerMode && (
          <p className="text-center text-xs text-ink-faint">
            {watchOnly ? tw('host.watchReminder') : tw('host.shoutReminder')}
          </p>
        )}
      </div>
    </div>
  )
}
