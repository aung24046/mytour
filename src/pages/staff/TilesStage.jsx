import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useQuizSession } from '../../lib/useQuizSession'
import { resolveHostToken } from '../../lib/quizHost'
import { fetchTileImage, fetchTileStats } from '../../lib/tileHost'
import { openCount, tileCount } from '../../lib/tileGrid'
import TileBoard from '../../components/tiles/TileBoard'

// จอใหญ่ของเกมเปิดแผ่นป้าย — เปิดแท็บแยก ไม่มีปุ่มสั่งงานแม้แต่ปุ่มเดียว
// รับ token ผ่าน #t= เหมือน QuizStage/PuzzleStage เพราะต้องเห็นภาพจริงซึ่งเป็นเฉลย
//
// ใช้สกิน arcade ชุดเดียวกับเกมปริศนาใบ้คำ (quiz_start_session ตั้ง stage_theme = 'arcade'
// ให้เกมนี้ด้วย) เพื่อให้สองเกมดูเป็นชุดเดียวกันเมื่อเล่นต่อกันในทริปเดียว
//
// ★ ไม่มีนาฬิกานับถอยหลังบนจอนี้โดยตั้งใจ — เกมนี้คนคุมเกมกำหนดจังหวะเอง
//   สิ่งที่แสดงแทนคือ "เปิดไปแล้วกี่แผ่น" ซึ่งคือความคืบหน้าที่มีความหมายจริงของเกม

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

export default function TilesStage() {
  const { sessionId } = useParams()
  const { session, question, phase } = useQuizSession(sessionId)
  const [stats, setStats] = useState({ solved: 0, online: 0, still_in: 0 })
  const [imageUrl, setImageUrl] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const preloadRef = useRef(new Set())

  useEffect(() => {
    resolveHostToken(sessionId)
  }, [sessionId])

  const questionId = session?.current_question_id ?? null
  const grid = question?.tiles ?? { grid_rows: 3, grid_cols: 4 }
  const total = tileCount(grid.grid_rows, grid.grid_cols)
  const opened = openCount(session?.revealed_tiles, grid.grid_rows, grid.grid_cols)

  const reveal = session?.reveal_payload ?? {}
  const revealing = phase === 'reveal' && reveal.kind === 'tiles'
  const busTv = session?.screen_mode === 'bus_tv'

  // ภาพจริงของข้อปัจจุบัน
  useEffect(() => {
    let alive = true
    setImageUrl(null)
    if (!sessionId || !questionId) return undefined
    fetchTileImage(sessionId, questionId)
      .then((url) => { if (alive) setImageUrl(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [sessionId, questionId])

  /**
   * ★ โหลดภาพข้อถัดไปไว้ล่วงหน้า
   *
   * เกมนี้ทั้งเกมแขวนอยู่กับภาพเดียว ถ้าจอขึ้นวงกลมหมุนตอนกดเปิดข้อ จังหวะพังทันที
   * และรถบัส 40 คนแชร์เสา 4G เดียวกันคือสภาพปกติ ไม่ใช่กรณีเลวร้าย
   *
   * จอนี้จึงรู้เฉลยข้อถัดไปล่วงหน้า — ยอมรับได้เพราะเป็นเครื่องของทีมงานและถือ token อยู่แล้ว
   * **แต่ห้ามเรนเดอร์ลง DOM** เก็บไว้ในแคชเบราว์เซอร์เฉยๆ
   */
  useEffect(() => {
    const setId = session?.set_id
    const index = session?.current_index ?? -1
    if (!setId || index < 0 || !sessionId) return undefined
    let alive = true

    ;(async () => {
      const { data } = await supabase
        .from('quiz_questions')
        .select('id')
        .eq('set_id', setId)
        .order('sort_order')
        .order('created_at')
        .range(index + 1, index + 1)
      const nextId = data?.[0]?.id
      if (!alive || !nextId || preloadRef.current.has(nextId)) return
      preloadRef.current.add(nextId)
      try {
        const url = await fetchTileImage(sessionId, nextId)
        if (url) new Image().src = url
      } catch {
        /* โหลดล่วงหน้าไม่สำเร็จไม่ใช่เรื่องที่ต้องบอกใคร ข้อถัดไปก็แค่โหลดช้าลงหน่อย */
      }
    })()

    return () => { alive = false }
  }, [sessionId, session?.set_id, session?.current_index])

  useEffect(() => {
    if (!questionId || phase === 'reveal' || phase === 'lobby') return undefined
    let alive = true
    const tick = async () => {
      try {
        const s = await fetchTileStats(sessionId, questionId)
        if (alive) setStats(s)
      } catch {
        /* จอเวทีห้ามขึ้น error ต่อหน้าคนทั้งห้อง */
      }
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [sessionId, questionId, phase])

  useEffect(() => {
    if (phase !== 'scoreboard' && phase !== 'finished') return
    supabase
      .rpc('quiz_leaderboard', { p_session_id: sessionId, p_limit: busTv ? 3 : 10 })
      .then(({ data }) => setLeaderboard(data ?? []))
  }, [phase, sessionId, busTv, session?.current_index])

  const heading = useMemo(() => {
    if (revealing) return reveal.answer ?? ''
    if (question?.text) return question.text
    return session?.name ?? ''
  }, [revealing, reveal.answer, question?.text, session?.name])

  const showBoard = questionId && phase !== 'scoreboard' && phase !== 'finished'

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-start p-4 sm:p-8"
      style={{ background: CHECKER }}
    >
      <div className="flex w-full max-w-[1500px] flex-1 flex-col rounded-[28px] border-[6px] border-black bg-white p-5 shadow-[10px_10px_0_0_rgba(0,0,0,0.9)] sm:p-10">
        <div className="-mt-12 mb-6 flex items-center justify-center sm:-mt-16">
          <Pill>{heading}</Pill>
        </div>

        {showBoard && (
          <>
            {/* ความคืบหน้าที่มีความหมายของเกมนี้คือจำนวนแผ่น ไม่ใช่วินาที */}
            {!revealing && (
              <div className="mb-4 flex items-center justify-between text-2xl font-black text-black sm:text-3xl">
                <span>เปิดแล้ว {opened}/{total}</span>
                <span>ยังตอบได้ {stats.still_in} คน</span>
              </div>
            )}

            <div className="mx-auto w-full max-w-[1100px] flex-1">
              <TileBoard
                rows={grid.grid_rows}
                cols={grid.grid_cols}
                crop={{ x: grid.crop_x, y: grid.crop_y, w: grid.crop_w, h: grid.crop_h }}
                imageUrl={imageUrl}
                coverImageUrl={grid.cover_image_url}
                revealed={session?.revealed_tiles ?? []}
                showNumbers={!revealing}
              />
            </div>

            {/* ผู้ชนะ — จังหวะพีคของข้อ ตัวใหญ่กว่าทุกอย่างบนจอ */}
            {revealing && reveal.fastest && (
              <div className="mt-6 text-center">
                <p className="text-4xl font-black text-black sm:text-6xl">
                  🎉 {reveal.fastest.name}
                </p>
                {reveal.explain && (
                  <p className="mt-2 text-2xl font-bold text-black/70 sm:text-3xl">{reveal.explain}</p>
                )}
              </div>
            )}
            {revealing && !reveal.fastest && (
              <p className="mt-6 text-center text-3xl font-black text-black/60 sm:text-5xl">
                ไม่มีใครตอบถูก
              </p>
            )}
          </>
        )}

        {(phase === 'scoreboard' || phase === 'finished') && (
          <ol className="mx-auto w-full max-w-3xl space-y-3">
            {leaderboard.map((row, i) => (
              <li
                key={row.id ?? i}
                className="flex items-center gap-4 rounded-2xl border-[4px] border-black bg-white px-5 py-3 shadow-[6px_6px_0_0_rgba(0,0,0,0.9)]"
              >
                <span className="text-3xl font-black text-black sm:text-5xl">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-3xl font-black text-black sm:text-5xl">
                  {row.display_name}
                </span>
                <span className="text-3xl font-black text-black sm:text-5xl">{row.score}</span>
              </li>
            ))}
          </ol>
        )}

        {phase === 'lobby' && (
          <p className="mt-10 text-center text-3xl font-black text-black/60 sm:text-5xl">
            รอเริ่มเกม
          </p>
        )}
      </div>
    </div>
  )
}
