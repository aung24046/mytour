import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useQuizSession, serverNow } from '../../lib/useQuizSession'
import { stageChecker } from '../../lib/quizStyle'
import { resolveHostToken } from '../../lib/quizHost'
import { fetchPuzzleStats } from '../../lib/puzzleHost'
import ClueBoard from '../../components/puzzle/ClueBoard'

// จอใหญ่ของเกมปริศนาใบ้คำ — เปิดแท็บแยก ไม่มีปุ่มสั่งงานแม้แต่ปุ่มเดียว
// รับ token ผ่าน #t= เหมือน QuizStage เพราะต้องเห็นตัวเลขที่ลูกทัวร์ไม่ควรเห็น
//
// สกิน "arcade" ถอดมาจากเอกสารต้นฉบับ (เกมใบ้คำ.pdf) โดยตรง:
//   ตาหมากรุกเขียว-ขาว · กล่องขาวขอบดำหนาเกือบเต็มจอ · ป้ายพิลเหลืองคร่อมขอบบน ·
//   นาฬิกาจับเวลาเกาะมุมขวาบน · ไม่มีเงา
// ทั้งหมดทำด้วย CSS ล้วน ไม่มีรูปพื้นหลัง — ไม่กิน egress และคมทุกความละเอียด
//
// ★ รอบแก้ 12 ก.ย. 2026 (เจ้าของโปรเจกต์เทียบกับ PDF ต้นฉบับ):
//   · เอาเงาออกทุกชิ้น
//   · ป้ายพยางค์ · รูปใบ้ · นาฬิกา ใหญ่ขึ้นทั้งหมด — ของเดิมเล็กจนดูจากท้ายรถไม่ออก
//   · กล่องขาวกินพื้นที่เกือบเต็มจอ เหลือขอบตาหมากรุกไว้เป็นกรอบบางๆ
//   · จอเฉลยใช้กรอบเดียวกับตอนเล่น (เดิมเป็นรูปเต็มจอพื้นดำ ดูเป็นคนละเกม)
//   · ใต้คำเฉลยเป็น "ที่มาของคำตอบ" ที่คนตั้งคำถามเขียนเอง ไม่ใช่การแยกพยางค์


/** ป้ายพิลเหลืองคร่อมขอบบนของกล่อง — ตัวหลักของจอ ต้องอ่านออกจากท้ายรถ */
function Pill({ children, small = false }) {
  return (
    <span
      className="inline-block max-w-full truncate rounded-full border-[5px] border-black bg-[#f2f75f] px-10 py-2.5 font-black text-black"
      style={{ fontSize: small ? 'clamp(1.5rem, 2.4vw, 2.5rem)' : 'clamp(2rem, 4.2vw, 5rem)' }}
    >
      {children}
    </span>
  )
}

/** นาฬิกาจับเวลาเกาะมุมขวาบน — วงกลมขอบดำ มีปุ่มกดด้านบนเหมือนนาฬิกาจับเวลาในต้นฉบับ */
function Stopwatch({ seconds }) {
  const low = seconds <= 10
  return (
    <div className="relative flex flex-col items-center" aria-label={`เหลือ ${seconds} วินาที`}>
      <span className="h-3 w-8 rounded-t-md border-[4px] border-b-0 border-black bg-[#f2f75f] sm:h-4 sm:w-10" />
      <span
        className={`flex items-center justify-center rounded-full border-[6px] border-black tabular-nums font-black leading-none ${
          low ? 'bg-[#ff5a5a] text-white' : 'bg-white text-black'
        }`}
        style={{
          width: 'clamp(5rem, 11vw, 10rem)',
          height: 'clamp(5rem, 11vw, 10rem)',
          fontSize: 'clamp(2rem, 4.6vw, 4.25rem)',
        }}
      >
        {seconds}
      </span>
    </div>
  )
}

/** ชิปเล็กขอบดำ — ใช้กับ "ข้อ 5" และ "ตอบถูกแล้ว 0" */
function Chip({ children, tone = 'white' }) {
  return (
    <span
      className={`inline-block rounded-full border-[4px] border-black px-5 py-1 font-black text-black ${
        tone === 'yellow' ? 'bg-[#f2f75f]' : 'bg-white'
      }`}
      style={{ fontSize: 'clamp(1.25rem, 1.9vw, 2.25rem)' }}
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
  const secondsLeft = Math.max(Math.ceil(msLeft / 1000), 0)
  const busTv = session?.screen_mode === 'bus_tv'
  const teamMode = Boolean(session?.team_mode)
  const answering = phase === 'answering'

  // ทีมที่ได้คะแนนข้อนี้ — โชว์ตอนเฉลย "เฉพาะห้องแบบทีม"
  // ห้องเดี่ยวคงหน้าจอเฉลยเดิมไว้ แต่เล่นเป็นทีม ทั้งห้องต้องรู้ว่าทีมไหนได้แต้ม
  // ไม่งั้นกระดานคะแนนตอนท้ายไม่มีใครเชื่อ
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

  const title = revealing
    ? reveal.answer
    : question?.puzzle
      ? `${question.puzzle.syllable_count} พยางค์`
      : session?.name ?? ''

  const hints = session?.hint_payload ?? []

  return (
    <div
      // ขอบตาหมากรุกบางๆ พอให้รู้ว่าเป็นกรอบ — ที่เหลือยกให้กล่องขาว
      className="flex h-[100dvh] w-full flex-col items-center p-2 sm:p-4"
      style={{ background: stageChecker(sessionId) }}
    >
      <div className="relative flex min-h-0 w-full max-w-[1800px] flex-1 flex-col rounded-[32px] border-[7px] border-black bg-white px-5 pb-5 pt-16 sm:px-10 sm:pb-8 sm:pt-20">
        {/* ป้ายหัวเรื่องคร่อมขอบบน + นาฬิกาเกาะมุมขวา */}
        <div className="pointer-events-none absolute inset-x-0 -top-1 flex items-start justify-center px-4">
          <Pill>{title}</Pill>
        </div>
        {/* นาฬิกาเกาะมุมขวาบน — อยู่ในกล่อง ไม่ล้นออกนอกจอ (จอโปรเจกเตอร์บางตัวกินขอบจอไปแล้ว) */}
        {answering && (
          <div className="pointer-events-none absolute top-1 right-3 sm:top-2 sm:right-6">
            <Stopwatch seconds={secondsLeft} />
          </div>
        )}
        {(answering || phase === 'locked') && (
          <div className="pointer-events-none absolute left-4 top-4 sm:left-8 sm:top-6">
            <Chip>ข้อ {(session?.current_index ?? 0) + 1}</Chip>
          </div>
        )}

        {/* เนื้อกลางจอ */}
        {/* min-h-0 = ลูกในคอลัมน์ยอมหดได้ ไม่งั้นรูปเฉลยดันข้อความที่มาของคำตอบตกขอบจอ */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 sm:gap-7">
          {phase === 'lobby' && (
            <div className="text-center">
              <p className="text-5xl font-black text-black sm:text-7xl">กติกา</p>
              <ul className="mt-8 space-y-4 text-3xl font-bold text-black sm:text-5xl">
                <li>• ทายคำจากภาพใบ้</li>
                <li>{teamMode ? '• ทีมที่ตอบถูกได้ 1 คะแนน' : '• ตอบถูกได้ 1 คะแนน'}</li>
                <li>• ตอบได้ไม่จำกัดครั้ง</li>
                <li>{teamMode ? '• ทีมที่คะแนนรวมมากที่สุดเป็นผู้ชนะ' : '• คะแนนมากที่สุดเป็นผู้ชนะ'}</li>
              </ul>
              <p className="mt-10 text-2xl text-neutral-500">รอทีมงานเริ่มเกม</p>
            </div>
          )}

          {phase === 'countdown' && (
            <p className="text-[22vw] font-black leading-none text-black">
              {Math.max(
                Math.ceil(
                  (new Date(session.question_started_at).getTime() - serverNow()) / 1000
                ),
                1
              )}
            </p>
          )}

          {(answering || phase === 'locked') && question?.clues && (
            <ClueBoard clues={question.clues} surface={busTv ? 'bus_tv' : 'stage'} />
          )}

          {/* ── เฉลย ──────────────────────────────────────────────
              อยู่ในกรอบเดียวกับตอนเล่น (เจ้าของโปรเจกต์เลือก 12 ก.ย. 2026)
              มีรูปเฉลย = รูปเฉลยเป็นพระเอกเต็มพื้นที่ที่เหลือ · ไม่มีรูป = โชว์รูปใบ้ซ้ำ */}
          {revealing && (
            <>
              {reveal.answer_image_url ? (
                // รูปต้องหดให้ข้อความ "ที่มาของคำตอบ" ข้างล่างมีที่เสมอ — min-h-0 + max-h-full
                <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                  <img
                    src={reveal.answer_image_url}
                    alt={reveal.answer ?? ''}
                    className="max-h-full max-w-full rounded-[22px] border-[5px] border-black object-contain"
                  />
                </div>
              ) : (
                <ClueBoard
                  clues={reveal.clues ?? question?.clues ?? []}
                  surface={busTv ? 'bus_tv' : 'stage'}
                />
              )}

              {/* ที่มาของคำตอบ — ประโยคเดียวที่คนตั้งคำถามเขียนเอง
                  เช่น "ผู้ชายเรียงกัน = ชาย + เรียง → เชียงราย" */}
              {reveal.explain && (
                <p
                  className="max-w-[92%] text-center font-black leading-snug text-black"
                  style={{ fontSize: 'clamp(1.6rem, 3.2vw, 3.75rem)' }}
                >
                  {reveal.explain}
                </p>
              )}

              {winner && (
                <p className="text-2xl font-black text-black sm:text-4xl">
                  🎉 {winner.name}
                  {winner.team ? <span className="text-black/60"> · ทีม {winner.team}</span> : null}
                </p>
              )}
            </>
          )}

          {(phase === 'scoreboard' || phase === 'finished') && (
            <ol className="w-full max-w-3xl space-y-2.5">
              {leaderboard.map((row, i) => (
                <li
                  key={row.id}
                  className="flex items-center gap-4 rounded-2xl border-[4px] border-black bg-[#f2f75f] px-6 py-3 text-3xl font-black text-black sm:text-4xl"
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

        {/* แถบล่าง: คำใบ้ที่เปิดแล้ว + จำนวนคนตอบถูก */}
        {(hints.length > 0 || answering) && !revealing && phase !== 'scoreboard' && phase !== 'finished' && (
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              {(busTv ? hints.slice(-1) : hints).map((h) => (
                <p
                  key={h.step}
                  className="rounded-2xl border-[4px] border-black bg-[#f2f75f] px-6 py-2.5 font-black text-black"
                  style={{ fontSize: 'clamp(1.4rem, 2.4vw, 2.75rem)' }}
                >
                  💡 {h.body}
                </p>
              ))}
            </div>
            {answering && <Chip tone="yellow">ตอบถูกแล้ว {stats.solved}</Chip>}
          </div>
        )}
      </div>
    </div>
  )
}
