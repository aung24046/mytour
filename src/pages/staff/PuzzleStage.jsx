import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useQuizSession, serverNow } from '../../lib/useQuizSession'
import { resolveHostToken } from '../../lib/quizHost'
import { fetchPuzzleStats } from '../../lib/puzzleHost'
import { splitSyllables } from '../../lib/puzzleLayout'
import ClueBoard from '../../components/puzzle/ClueBoard'

// จอใหญ่ของเกมปริศนาใบ้คำ — เปิดแท็บแยก ไม่มีปุ่มสั่งงานแม้แต่ปุ่มเดียว
// รับ token ผ่าน #t= เหมือน QuizStage เพราะต้องเห็นตัวเลขที่ลูกทัวร์ไม่ควรเห็น
//
// สกิน "arcade" ถอดมาจากภาษาทางสายตาของเอกสารต้นฉบับโดยตรง:
//   ตาหมากรุกเขียว-ขาว · ป้ายพิลเหลืองคร่อมขอบบน · เส้นขอบดำหนา · เงาบล็อกแข็ง
// ทั้งหมดทำด้วย CSS ล้วน ไม่มีรูปพื้นหลัง — ไม่กิน egress และคมทุกความละเอียด

const CHECKER =
  'repeating-conic-gradient(#0f8a4a 0% 25%, #ffffff 0% 50%) 50% / 120px 120px'

function Pill({ children, className = '' }) {
  return (
    <span
      className={`inline-block rounded-full border-[4px] border-black bg-[#f2f75f] px-8 py-2 text-3xl font-black text-black shadow-[6px_6px_0_0_rgba(0,0,0,0.9)] sm:text-5xl ${className}`}
    >
      {children}
    </span>
  )
}

export default function PuzzleStage() {
  const { sessionId } = useParams()
  const { session, question, phase, msLeft } = useQuizSession(sessionId)
  const [stats, setStats] = useState({ solved: 0, online: 0 })

  useEffect(() => {
    resolveHostToken(sessionId)
  }, [sessionId])

  const questionId = session?.current_question_id ?? null

  // ข้อใหม่ = ล้างตัวเลขข้อเก่า (ไม่งั้นชื่อผู้ชนะข้อที่แล้วค้างบนจอ)
  useEffect(() => {
    setStats({ solved: 0, online: 0 })
  }, [questionId])

  useEffect(() => {
    if (!questionId || phase === 'reveal' || phase === 'lobby') return undefined
    let alive = true
    const tick = async () => {
      try {
        const s = await fetchPuzzleStats(sessionId, questionId)
        if (alive) setStats(s)
      } catch {
        /* จอเวทีห้ามขึ้น error ต่อหน้าคนทั้งห้อง — รอบหน้าค่อยว่ากัน */
      }
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId, questionId, phase])

  const reveal = session?.reveal_payload ?? {}
  const revealing = phase === 'reveal' && reveal.kind === 'puzzle'
  const parts = useMemo(() => splitSyllables(reveal.answer_split ?? ''), [reveal.answer_split])
  const secondsLeft = Math.max(Math.ceil(msLeft / 1000), 0)
  const busTv = session?.screen_mode === 'bus_tv'
  const teamMode = Boolean(session?.team_mode)

  // ทีมที่ได้คะแนนข้อนี้ — โชว์ตอนเฉลย "เฉพาะห้องแบบทีม"
  // ห้องเดี่ยวคงหน้าจอเฉลยเดิมไว้ (จอเฉลยรูปเต็มจอเจ้าของโปรเจกต์สั่งให้มีแค่สามอย่าง)
  // แต่เล่นเป็นทีม ทั้งห้องต้องรู้ว่าทีมไหนได้แต้ม ไม่งั้นกระดานคะแนนตอนท้ายไม่มีใครเชื่อ
  // ชื่อมากับ reveal_payload.fastest (20260911_puzzle_team_mode.sql) — ไม่ต้องรอ poll
  const winner = teamMode && revealing && reveal.fastest
    ? { name: reveal.fastest.name, team: reveal.fastest.team ?? null }
    : null

  // เล่นเป็นทีมก็ให้กระดานเป็นของทีม — คะแนนทีม = คะแนนรวมของสมาชิก
  // (quiz_team_leaderboard เรียงด้วย total_score ให้เองเมื่อเป็นเกม puzzle/tiles)
  const [leaderboard, setLeaderboard] = useState([])
  useEffect(() => {
    if (phase !== 'scoreboard' && phase !== 'finished') return
    const rpc = teamMode
      ? supabase.rpc('quiz_team_leaderboard', { p_session_id: sessionId })
      : supabase.rpc('quiz_leaderboard', { p_session_id: sessionId, p_limit: busTv ? 3 : 10 })
    rpc.then(({ data }) => setLeaderboard((data ?? []).slice(0, busTv ? 3 : 10)))
  }, [phase, sessionId, busTv, teamMode, session?.current_index])

  // ── เฉลยแบบเต็มจอ ────────────────────────────────────────────────
  // ข้อที่มีรูปเฉลย จอใหญ่ต้องยกรูปขึ้นเป็นพระเอก ไม่ใช่รูปขนาดโปสต์การ์ด
  // ต่อท้ายกระดานรูปใบ้ที่คนทั้งห้องเพิ่งจ้องมาเก้าสิบวินาที
  //
  // สามอย่างบนจอนี้เท่านั้น (ตามที่สั่ง): รูปเฉลยเต็มจอ · คำเฉลยบนกลาง · ตัวสะกดล่าง
  // พื้นหลังเป็นรูปเดียวกันแบบเบลอ-ครอป จอ 16:9 กับรูป 4:3 จึงไม่เหลือแถบดำข้างๆ
  // โดยที่ตัวรูปจริงยังไม่โดนตัดสักมิลลิเมตร
  if (revealing && reveal.answer_image_url) {
    return (
      <div className="relative flex h-[100dvh] w-full flex-col items-center justify-between overflow-hidden bg-black">
        <img
          src={reveal.answer_image_url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
        />
        <img
          src={reveal.answer_image_url}
          alt={reveal.answer ?? ''}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/* ไล่เฉดบน-ล่าง — ตัวหนังสือขาวบนรูปสว่างอ่านไม่ออกถ้าไม่มีตัวนี้ */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[28%] bg-gradient-to-b from-black/75 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[28%] bg-gradient-to-t from-black/75 to-transparent" />

        <div className="relative z-10 pt-6 sm:pt-10">
          <Pill>{reveal.answer}</Pill>
        </div>

        <div className="relative z-10 flex w-full flex-col items-center gap-3 px-6 pb-8 sm:pb-12">
          {parts.length > 0 && (
            <p className="text-center text-4xl font-black tracking-wide text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.9)] sm:text-6xl">
              {parts.map((p, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-2 text-white/50">+</span>}
                  {p}
                </span>
              ))}
            </p>
          )}
          {reveal.explain && (
            <p className="max-w-4xl text-center text-xl font-bold text-white/90 drop-shadow-[0_2px_0_rgba(0,0,0,0.9)] sm:text-2xl">
              {reveal.explain}
            </p>
          )}
          {winner && (
            <p className="text-center text-2xl font-black text-[#f2f75f] drop-shadow-[0_3px_0_rgba(0,0,0,0.9)] sm:text-4xl">
              🎉 {winner.team ? `ทีม ${winner.team} · ${winner.name}` : winner.name}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-start p-4 sm:p-8"
      style={{ background: CHECKER }}
    >
      <div className="flex w-full max-w-[1500px] flex-1 flex-col rounded-[28px] border-[6px] border-black bg-white p-5 shadow-[10px_10px_0_0_rgba(0,0,0,0.9)] sm:p-10">
        {/* หัวเรื่อง */}
        <div className="-mt-12 mb-6 flex items-center justify-center sm:-mt-16">
          <Pill>
            {revealing
              ? reveal.answer
              : question?.puzzle
                ? `${question.puzzle.syllable_count} พยางค์`
                : session?.name ?? ''}
          </Pill>
        </div>

        {/* นาฬิกา + จำนวนคนตอบถูก */}
        {phase === 'answering' && (
          <div className="mb-4 flex items-center justify-between text-2xl font-black text-black sm:text-3xl">
            <span>
              ข้อ {(session?.current_index ?? 0) + 1}
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">⏱ {secondsLeft}</span>
            </span>
            <span>ตอบถูกแล้ว {stats.solved}</span>
          </div>
        )}

        {/* เนื้อกลางจอ */}
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          {phase === 'lobby' && (
            <div className="text-center">
              <p className="text-4xl font-black text-black sm:text-6xl">กติกา</p>
              <ul className="mt-6 space-y-3 text-2xl font-bold text-black sm:text-4xl">
                <li>• ทายคำจากภาพใบ้</li>
                <li>{teamMode ? '• ทีมที่ตอบถูกได้ 1 คะแนน' : '• ตอบถูกได้ 1 คะแนน'}</li>
                <li>• ตอบได้ไม่จำกัดครั้ง</li>
                <li>{teamMode ? '• ทีมที่คะแนนรวมมากที่สุดเป็นผู้ชนะ' : '• คะแนนมากที่สุดเป็นผู้ชนะ'}</li>
              </ul>
              <p className="mt-8 text-xl text-neutral-500">รอทีมงานเริ่มเกม</p>
            </div>
          )}

          {phase === 'countdown' && (
            <p className="text-[18vw] font-black leading-none text-black">
              {Math.max(
                Math.ceil(
                  (new Date(session.question_started_at).getTime() - serverNow()) / 1000
                ),
                1
              )}
            </p>
          )}

          {(phase === 'answering' || phase === 'locked') && question?.clues && (
            <ClueBoard clues={question.clues} surface={busTv ? 'bus_tv' : 'stage'} />
          )}

          {revealing && (
            <>
              <ClueBoard
                clues={reveal.clues ?? question?.clues ?? []}
                surface={busTv ? 'bus_tv' : 'stage'}
                labels={reveal.clue_labels ?? null}
                cellHeight={busTv ? 'min(20vh, 180px)' : 'min(24vh, 240px)'}
              />

              {parts.length > 0 && (
                <p className="text-4xl font-black tracking-wide text-black sm:text-6xl">
                  {parts.map((p, i) => (
                    <span key={i}>
                      {i > 0 && <span className="mx-2 text-neutral-400">+</span>}
                      {p}
                    </span>
                  ))}
                </p>
              )}


              {reveal.explain && (
                <p className="text-2xl font-bold text-neutral-700 sm:text-3xl">{reveal.explain}</p>
              )}

              {winner && (
                <p className="text-3xl font-black text-black sm:text-5xl">
                  🎉 {winner.name}
                  {winner.team ? <span className="text-black/60"> · ทีม {winner.team}</span> : null}
                </p>
              )}
            </>
          )}

          {(phase === 'scoreboard' || phase === 'finished') && (
            <ol className="w-full max-w-2xl space-y-2">
              {leaderboard.map((row, i) => (
                <li
                  key={row.id}
                  className="flex items-center gap-4 rounded-2xl border-[3px] border-black bg-[#f2f75f] px-5 py-3 text-2xl font-black text-black sm:text-4xl"
                >
                  <span className="w-10 text-center">{i + 1}</span>
                  {/* กระดานทีมคืน name/total_score ส่วนกระดานรายคนคืน display_name/score */}
                  <span className="min-w-0 flex-1 truncate">
                    {row.display_name ?? row.name}
                    {row.member_count ? (
                      <span className="text-black/50"> ({row.member_count})</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">{row.score ?? row.total_score}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* คำใบ้ที่เปิดแล้ว — แถบล่าง */}
        {(session?.hint_payload ?? []).length > 0 && phase !== 'scoreboard' && (
          <div className="mt-6 space-y-1.5">
            {(busTv ? session.hint_payload.slice(-1) : session.hint_payload).map((h) => (
              <p
                key={h.step}
                className="rounded-2xl border-[3px] border-black bg-[#f2f75f] px-5 py-2.5 text-2xl font-black text-black sm:text-4xl"
              >
                💡 {h.body}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
