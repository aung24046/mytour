import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useQuizSession, serverNow } from '../../lib/useQuizSession'
import { stageChecker } from '../../lib/quizStyle'
import { resolveHostToken } from '../../lib/quizHost'
import { fetchWordsStats, useWordsAnswerMode } from '../../lib/wordsHost'
import { applyOpened, revealCells, poolTiles } from '../../lib/wordsMask'
import { wordGame } from '../../lib/wordGames'
import WordBoard from '../../components/words/WordBoard'
import ShufflePool from '../../components/words/ShufflePool'

// จอใหญ่ของเกม What Words / Word Shuffle — เปิดแท็บแยก ไม่มีปุ่มสั่งงาน
// game = 'words' | 'shuffle' — Word Shuffle มีกองตัวสลับใต้ช่องคำตอบ (ตอนเฉลยซ่อนกอง ให้คำตอบเด่นอย่างเดียว)
// สกิน arcade เดียวกับปริศนาใบ้คำ/เปิดแผ่นป้าย (ตาหมากรุกเขียว-ขาว · ป้ายพิลเหลือง · ขอบดำหนา)
// ข้อความบนจอเป็นภาษาไทยตายตัวเหมือนอีกสองเกม — จอนี้ขึ้นต่อหน้าลูกทัวร์ไทยทั้งห้อง
//
// สิ่งที่ขึ้นบนจอระหว่างข้อ มีสามอย่างเท่านั้น: หมวดหมู่ (บนสุด) · คำที่ซ่อนตัว (กลาง) · นาฬิกา/จำนวนคนตอบถูก
// ตัวที่คนคุมเกมเปิดมาทาง session.hint_payload (realtime) — จอนี้ไม่ต้องดึงคำตอบเอง
//
// ชุดแบบ "ไม่ต้องตอบ" (answer_mode = 'none'): ทายกันปากเปล่า — ไม่มี "ตอบถูกแล้ว" · ไม่มีชื่อผู้ชนะ
//   · ไม่มีกระดานอันดับ (ขึ้น "ไม่มีใครตอบถูก" ตอนเฉลยจะผิด เพราะไม่มีใครได้ตอบเลย)


function Pill({ children, className = '' }) {
  return (
    <span
      className={`inline-block max-w-full rounded-full border-[4px] border-black bg-[#f2f75f] px-8 py-2 text-3xl font-black text-black shadow-[6px_6px_0_0_rgba(0,0,0,0.9)] sm:text-5xl ${className}`}
    >
      {children}
    </span>
  )
}

export default function WordsStage({ game: gameKey = 'words' }) {
  const G = wordGame(gameKey)
  const { sessionId } = useParams()
  const { session, question, phase, msLeft } = useQuizSession(sessionId)
  const answerMode = useWordsAnswerMode(session?.set_id)
  const watchOnly = answerMode === 'none'
  const typing = answerMode === 'type' // ระหว่างโหลด (null) ไม่ใช่ทั้งสองแบบ — ไม่ขึ้นของที่อาจต้องหายไป
  const [stats, setStats] = useState({ solved: 0, online: 0 })

  useEffect(() => {
    resolveHostToken(sessionId)
  }, [sessionId])

  const questionId = session?.current_question_id ?? null

  useEffect(() => {
    setStats({ solved: 0, online: 0 })
  }, [questionId])

  useEffect(() => {
    if (!questionId || phase === 'reveal' || phase === 'lobby' || answerMode !== 'type') return undefined
    let alive = true
    const tick = async () => {
      try {
        const s = await fetchWordsStats(sessionId, questionId)
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
  }, [sessionId, questionId, phase, answerMode])

  const reveal = session?.reveal_payload ?? {}
  const revealing = phase === 'reveal' && reveal.kind === 'words'
  const secondsLeft = Math.max(Math.ceil(msLeft / 1000), 0)
  const busTv = session?.screen_mode === 'bus_tv'
  const teamMode = Boolean(session?.team_mode)
  const surface = busTv ? 'bus_tv' : 'stage'

  const playCells = useMemo(
    () => applyOpened(question?.words?.cells ?? [], session?.hint_payload ?? []),
    [question?.words?.cells, session?.hint_payload]
  )
  const answerCells = useMemo(() => revealCells(reveal.words_cells ?? []), [reveal.words_cells])
  const category = revealing ? reveal.category ?? question?.words?.category : question?.words?.category

  // ห้องแบบทีมบอกว่าทีมไหนได้แต้ม — ห้องเดี่ยวบอกชื่อคนตอบถูกคนแรก
  const winner = revealing && reveal.fastest ? reveal.fastest : null

  const [leaderboard, setLeaderboard] = useState([])
  useEffect(() => {
    if ((phase !== 'scoreboard' && phase !== 'finished') || !typing) return
    const rpc = teamMode
      ? supabase.rpc('quiz_team_leaderboard', { p_session_id: sessionId })
      : supabase.rpc('quiz_leaderboard', { p_session_id: sessionId, p_limit: busTv ? 3 : 10 })
    rpc.then(({ data }) => setLeaderboard((data ?? []).slice(0, busTv ? 3 : 10)))
  }, [phase, sessionId, busTv, teamMode, session?.current_index, typing])

  const showWord = questionId && (phase === 'answering' || phase === 'locked' || revealing)

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-start p-4 sm:p-8"
      style={{ background: stageChecker(sessionId) }}
    >
      <div className="flex w-full max-w-[1500px] flex-1 flex-col rounded-[28px] border-[6px] border-black bg-white p-5 shadow-[10px_10px_0_0_rgba(0,0,0,0.9)] sm:p-10">
        {/* หัวเรื่อง — หมวดหมู่คือคำใบ้ ต้องเห็นตั้งแต่วินาทีแรกของข้อ */}
        <div className="-mt-12 mb-6 flex items-center justify-center sm:-mt-16">
          <Pill>
            {showWord && category ? `หมวด: ${category}` : session?.name ?? G.stageTitle}
          </Pill>
        </div>

        {phase === 'answering' && (
          <div className="mb-4 flex items-center justify-between text-2xl font-black text-black sm:text-3xl">
            <span>ข้อ {(session?.current_index ?? 0) + 1}</span>
            <span className="tabular-nums">⏱ {secondsLeft}</span>
            {typing ? <span>ตอบถูกแล้ว {stats.solved}</span> : <span />}
          </div>
        )}

        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          {phase === 'lobby' && (
            <div className="text-center">
              <p className="text-5xl font-black text-black sm:text-7xl">{G.stageTitle}</p>
              <ul className="mt-6 space-y-3 text-2xl font-bold text-black sm:text-4xl">
                <li>• {G.stageRule}</li>
                {watchOnly ? (
                  <li>• คิดออกแล้วตอบได้เลย ไม่ต้องพิมพ์</li>
                ) : (
                  <>
                    <li>{teamMode ? '• ทีมที่ตอบถูกได้ 1 คะแนน' : '• ตอบถูกได้ 1 คะแนน'}</li>
                    <li>• ตอบได้ไม่จำกัดครั้ง</li>
                    <li>{teamMode ? '• ทีมที่คะแนนรวมมากที่สุดเป็นผู้ชนะ' : '• คะแนนมากที่สุดเป็นผู้ชนะ'}</li>
                  </>
                )}
              </ul>
              <p className="mt-8 text-xl text-neutral-500">รอทีมงานเริ่มเกม</p>
            </div>
          )}

          {phase === 'countdown' && session?.question_started_at && (
            <p className="text-[18vw] font-black leading-none text-black">
              {Math.max(
                Math.ceil((new Date(session.question_started_at).getTime() - serverNow()) / 1000),
                1
              )}
            </p>
          )}

          {(phase === 'answering' || phase === 'locked') && question?.words && (
            <>
              <WordBoard cells={playCells} surface={surface} className="w-full text-black" />
              {G.shuffle && question.words.pool && (
                <ShufflePool tiles={poolTiles(question.words.pool, playCells)} boardCells={playCells} surface={surface} className="w-full" />
              )}
            </>
          )}

          {revealing && (
            <>
              <WordBoard cells={answerCells} surface={surface} className="w-full text-black" />
              {reveal.explain && (
                <p className="text-center text-2xl font-bold text-neutral-700 sm:text-3xl">{reveal.explain}</p>
              )}
              {!typing ? null : winner ? (
                <p className="text-center text-3xl font-black text-black sm:text-5xl">
                  🎉 {teamMode && winner.team ? `ทีม ${winner.team}` : winner.name}
                  {teamMode && winner.team ? <span className="text-black/60"> · {winner.name}</span> : null}
                </p>
              ) : (
                <p className="text-center text-3xl font-black text-black/60 sm:text-5xl">ไม่มีใครตอบถูก</p>
              )}
            </>
          )}

          {(phase === 'scoreboard' || phase === 'finished') && watchOnly && (
            <p className="text-center text-5xl font-black text-black sm:text-7xl">
              {phase === 'finished' ? 'จบเกม ขอบคุณที่ร่วมสนุก' : 'พักสักครู่'}
            </p>
          )}

          {(phase === 'scoreboard' || phase === 'finished') && typing && (
            <ol className="w-full max-w-2xl space-y-2">
              {leaderboard.map((row, i) => (
                <li
                  key={row.id ?? i}
                  className="flex items-center gap-4 rounded-2xl border-[3px] border-black bg-[#f2f75f] px-5 py-3 text-2xl font-black text-black sm:text-4xl"
                >
                  <span className="w-10 text-center">{i + 1}</span>
                  {/* กระดานทีมคืน name/total_score ส่วนกระดานรายคนคืน display_name/score */}
                  <span className="min-w-0 flex-1 truncate">
                    {row.display_name ?? row.name}
                    {row.member_count ? <span className="text-black/50"> ({row.member_count})</span> : null}
                  </span>
                  <span className="tabular-nums">{row.score ?? row.total_score}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
