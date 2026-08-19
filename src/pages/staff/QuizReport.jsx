import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession } from '../../lib/staffSession'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import { fetchReport, fetchLeaderboard, fetchTeamLeaderboard } from '../../lib/quizHost'
import OptionShape from '../../components/quiz/OptionShape'
import { optionStyles, teamStyle } from '../../lib/quizStyle'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// สรุปหลังเกม
//
// ค่าของควิซไม่ได้จบตอนเกมจบ — ของที่มีประโยชน์จริงคือ "ข้อไหนใช้ไม่ได้"
// เพื่อเอาไปแก้ก่อนใช้ชุดนี้กับกรุ๊ปหน้า:
//   • ถูกเกิน 90%  = ง่ายจนไม่ได้คัดใคร ทุกคนได้คะแนนเท่ากันหมด เสียเวลาไปหนึ่งข้อ
//   • ถูกต่ำกว่า 20% = ยากเกินหรือคำถามกำกวม คนเดามั่วกันทั้งห้อง
// ทั้งสองแบบทำให้เกมจืด แต่คนละสาเหตุ จึงต้องแยกป้ายให้เห็นทันทีว่าเป็นแบบไหน
//
// ใช้ PIN ไม่ใช่ host_token เพราะหน้านี้เปิดดูทีหลังได้ (คนละวัน คนละเครื่อง)
// ตอนนั้น token ที่อยู่ใน sessionStorage ของแท็บที่คุมเกมหายไปแล้ว

const EASY_THRESHOLD = 90
const HARD_THRESHOLD = 20

function PinGate({ onUnlock, t }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  return (
    <div className="mx-auto max-w-md px-4 pt-10 text-center">
      <Icon name="lock" size={32} className="mx-auto text-ink-faint" />
      <p className="mt-3 text-base font-extrabold text-ink">{t('staff.quiz.pinTitle')}</p>
      <p className="mt-1 text-sm text-ink-muted">{t('staff.quiz.reportPinHint')}</p>
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        className="mt-4 w-full rounded-control border border-line bg-surface px-4 py-3 text-center text-2xl font-black tracking-[0.4em] text-ink outline-none focus:border-brand"
      />
      {error && <p className="mt-2 text-sm font-semibold text-danger-text">{error}</p>}
      <div className="mt-3">
        <Button
          disabled={!pin.trim()}
          onClick={async () => {
            const ok = await onUnlock(pin.trim())
            if (!ok) setError(t('staff.quiz.pinWrong'))
          }}
        >
          {t('common.confirm')}
        </Button>
      </div>
    </div>
  )
}

function Bar({ pct, tone }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function QuizReport() {
  const { sessionId } = useParams()
  const { t } = useTranslation()
  const staffId = getStaffSession()?.staff?.id ?? null

  const [pin, setPin] = useState(() => getQuizPin())
  const [unlocked, setUnlocked] = useState(false)
  const [session, setSession] = useState(null)
  const [rows, setRows] = useState([])
  const [board, setBoard] = useState([])
  const [teamBoard, setTeamBoard] = useState([])

  const load = useCallback(
    async (thePin) => {
      try {
        const data = await fetchReport({ sessionId, staffId, pin: thePin })
        setRows(data)
        return true
      } catch {
        return false
      }
    },
    [sessionId, staffId]
  )

  useEffect(() => {
    supabase
      .from('quiz_sessions')
      .select('id, name, team_mode, ended_at, created_at')
      .eq('id', sessionId)
      .maybeSingle()
      .then(({ data }) => setSession(data ?? null))
  }, [sessionId])

  useEffect(() => {
    if (!unlocked) return
    fetchLeaderboard(sessionId, 20).then(setBoard)
    if (session?.team_mode) fetchTeamLeaderboard(sessionId).then(setTeamBoard)
  }, [unlocked, sessionId, session?.team_mode])

  // มี PIN ค้างจากหน้าอื่นในแท็บเดียวกัน → ใช้เลย ไม่ต้องถามซ้ำ
  useEffect(() => {
    if (!pin || unlocked) return
    load(pin).then((ok) => setUnlocked(ok))
  }, [pin, unlocked, load])

  async function handleUnlock(value) {
    const ok = await load(value)
    if (!ok) return false
    saveQuizPin(value)
    setPin(value)
    setUnlocked(true)
    return true
  }

  const summary = useMemo(() => {
    const played = rows.filter((r) => r.answered > 0)
    if (played.length === 0) return null
    const avg = Math.round(played.reduce((a, r) => a + r.correct_rate, 0) / played.length)
    const sorted = [...played].sort((a, b) => a.correct_rate - b.correct_rate)
    return {
      played: played.length,
      avg,
      hardest: sorted[0],
      easiest: sorted[sorted.length - 1],
      tooEasy: played.filter((r) => r.correct_rate >= EASY_THRESHOLD).length,
      tooHard: played.filter((r) => r.correct_rate <= HARD_THRESHOLD).length,
    }
  }, [rows])

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-canvas">
        <StaffHeader title={t('staff.quiz.reportTitle')} icon="fileText" backTo="/staff/quiz" />
        <PinGate onUnlock={handleUnlock} t={t} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas pb-20">
      <StaffHeader
        title={t('staff.quiz.reportTitle')}
        subtitle={session?.name}
        icon="fileText"
        backTo="/staff/quiz"
      />

      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {/* ── สรุปภาพรวม ─────────────────────────────────────── */}
        {summary && (
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-ink">{summary.avg}%</span>
              <span className="text-sm text-ink-muted">{t('staff.quiz.avgCorrect')}</span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              {t('staff.quiz.playedCount', { n: summary.played, total: rows.length })}
            </p>

            {/* ตัวเลขที่เอาไปทำอะไรต่อได้จริง ไม่ใช่แค่รู้ไว้เฉยๆ */}
            {(summary.tooEasy > 0 || summary.tooHard > 0) && (
              <p className="mt-2.5 rounded-control bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-muted">
                {summary.tooEasy > 0 && t('staff.quiz.tooEasyHint', { n: summary.tooEasy })}
                {summary.tooEasy > 0 && summary.tooHard > 0 && ' · '}
                {summary.tooHard > 0 && t('staff.quiz.tooHardHint', { n: summary.tooHard })}
              </p>
            )}
          </div>
        )}

        {/* ── รายข้อ ─────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-muted">
            {t('staff.quiz.byQuestion')}
          </h2>
          <div className="mt-2 space-y-2">
            {rows.map((r, i) => {
              const skipped = r.answered === 0
              const easy = !skipped && r.correct_rate >= EASY_THRESHOLD
              const hard = !skipped && r.correct_rate <= HARD_THRESHOLD
              const styles = optionStyles(r.kind)

              return (
                <div
                  key={r.question_id}
                  className="rounded-2xl border border-line bg-surface p-3.5 shadow-card"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-sunken text-xs font-black text-ink-muted">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold text-ink">{r.question_text}</span>
                    {skipped ? (
                      <span className="flex-none rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold text-ink-faint">
                        {t('staff.quiz.skipped')}
                      </span>
                    ) : (
                      <span className="flex-none text-lg font-black tabular-nums text-ink">
                        {r.correct_rate}%
                      </span>
                    )}
                  </div>

                  {!skipped && (
                    <>
                      <div className="mt-2">
                        <Bar
                          pct={r.correct_rate}
                          tone={hard ? 'bg-danger' : easy ? 'bg-warning' : 'bg-success'}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-ink-faint">
                        {t('staff.quiz.answeredCorrect', { correct: r.correct, answered: r.answered })}
                        {' · '}
                        {t('staff.quiz.avgSeconds', { s: r.avg_seconds })}
                      </p>

                      {/* คนตอบผิดไปทางไหน — ตัวเลือกที่ดูดคนไปเยอะทั้งที่ผิด
                          มักแปลว่าคำถามกำกวม ไม่ใช่คนตอบไม่รู้ */}
                      {r.option_counts && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Object.entries(r.option_counts).map(([idx, n]) => {
                            const st = styles[Number(idx)] ?? styles[0]
                            const isCorrect = Number(idx) === r.correct_index
                            return (
                              <span
                                key={idx}
                                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                                  isCorrect ? 'text-white' : 'bg-surface-sunken text-ink-muted'
                                }`}
                                style={
                                  isCorrect
                                    ? { background: st.color }
                                    : { '--opt': st.color }
                                }
                              >
                                <OptionShape
                                  shape={st.shape}
                                  size={11}
                                  className={isCorrect ? '' : 'text-[color:var(--opt)]'}
                                />
                                {n}
                              </span>
                            )
                          })}
                        </div>
                      )}

                      {(easy || hard) && (
                        <p
                          className={`mt-2 text-xs font-semibold ${
                            hard ? 'text-danger-text' : 'text-warning-text'
                          }`}
                        >
                          {hard ? t('staff.quiz.hardWarn') : t('staff.quiz.easyWarn')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── อันดับ ─────────────────────────────────────────── */}
        {session?.team_mode && teamBoard.length > 0 && (
          <section>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-muted">
              {t('staff.quiz.teams')}
            </h2>
            <ol className="mt-2 space-y-1">
              {teamBoard.map((team) => {
                const st = teamStyle(team.color_index)
                return (
                  <li key={team.id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 font-black text-ink-faint">{team.rank}</span>
                    <span
                      className="h-3 w-3 flex-none rounded-full"
                      style={{ background: st.color }}
                    />
                    <span className="min-w-0 flex-1 truncate font-bold text-ink">{team.name}</span>
                    <span className="text-xs text-ink-muted">
                      {team.member_count} {t('staff.quiz.players')}
                    </span>
                    <span className="font-extrabold tabular-nums text-ink">{team.avg_score}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {board.length > 0 && (
          <section>
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
                  <span className="text-xs text-ink-muted">
                    {row.correct_count} {t('staff.quiz.correctShort')}
                  </span>
                  <span className="font-extrabold tabular-nums text-ink">{row.score}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}
