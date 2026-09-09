// คำสั่งของเกม "เปิดแผ่นป้าย" — รวมไว้ที่เดียวเพื่อไม่ให้ลืมแนบ token
//
// เกมนี้วิ่งบนเครื่องยนต์เดียวกับควิซและปริศนาใบ้คำ ห้อง/ผู้เล่น/นาฬิกา/ปุ่มคุมเกมพื้นฐาน
// (เปิดข้อ ปิดรับ เฉลย จบเกม) ใช้ของ quizHost.js ตรงๆ ไม่ทำซ้ำ
// ไฟล์นี้มีเฉพาะสิ่งที่เกมนี้มีแต่เกมอื่นไม่มี: เปิดแผ่นป้าย · ภาพจริง · feed คำตอบ · Builder
import { supabase } from './supabase'
import { getHostToken } from './quizHost'

// ── ฝั่งลูกทัวร์ ─────────────────────────────────────────────────────

/**
 * ส่งคำเดา
 * คืน { status, correct, attempts_used, attempts_left }
 *   attempts_left = null แปลว่าชุดนี้ไม่จำกัดจำนวนครั้ง
 *   status: ok | already_solved | duplicate | too_fast | closed | not_started
 *           wrong_question | no_attempts | empty | too_long | no_session
 *
 * ★ ไม่มี closeness ในค่าที่คืน และต้องไม่มีตลอดไป — บอกผู้เล่นว่าเขาใกล้แค่ไหน
 *   คือแจกคำใบ้ชั้นดี และขัดกับกติกาโควตาจำกัดโดยตรง (ดูข้อ 3.6 ของเอกสารออกแบบ)
 */
export async function submitTileGuess({ sessionId, playerId, questionId, text }) {
  const { data, error } = await supabase.rpc('quiz_tiles_guess', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_question_id: questionId,
    p_text: text,
  })
  if (error) throw error
  return data ?? { status: 'unknown' }
}

/** รีเฟรชกลางข้อแล้วต้องรู้ว่าตัวเองตอบถูกไปหรือยัง — ใช้ RPC กลางร่วมกับปริศนาใบ้คำ */
export async function fetchMyTileState({ sessionId, playerId, questionId }) {
  const { data, error } = await supabase.rpc('quiz_puzzle_my_state', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_question_id: questionId,
  })
  if (error) throw error
  return data ?? { solved: false, guesses: 0 }
}

// ── ฝั่งคนคุมเกม (ต้องมี token ของห้อง) ──────────────────────────────

/** เปิดแผ่นป้าย — tileNo = null คือสุ่ม (สุ่มที่ server เสมอ ดูเหตุผลใน tileGrid.js) */
export async function openTile(sessionId, tileNo = null) {
  const { data, error } = await supabase.rpc('quiz_tiles_open', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_tile_no: tileNo,
  })
  if (error) throw error
  return data
}

/** ยกเลิกแผ่นที่เพิ่งเปิด — ใช้ได้ภายใน 5 วินาที เกินกว่านั้น server ปฏิเสธเงียบๆ */
export async function undoTile(sessionId) {
  const { data, error } = await supabase.rpc('quiz_tiles_undo', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
  })
  if (error) throw error
  return data
}

/**
 * URL ภาพจริงของข้อ — ออกได้ทางนี้ทางเดียว และเฉพาะคนที่ถือ token
 *
 * ใช้สองที่:
 *   1. จอเวที และ **มือถือคนคุมเกม** — เขาต้องเห็นภาพเต็มถึงจะเลือกได้ว่าเปิดแผ่นไหนก่อน
 *      ไม่งั้นเป็นแค่คนกดปุ่มสุ่ม แล้วบังเอิญเปิดแผ่นที่มีหน้าคนตั้งแต่แผ่นที่สอง = จบเกม
 *   2. โหลดภาพข้อถัดไปไว้ล่วงหน้า (ส่ง questionId ของข้อถัดไปมา)
 */
export async function fetchTileImage(sessionId, questionId) {
  if (!sessionId || !questionId) return null
  const { data, error } = await supabase.rpc('quiz_tiles_image', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
  })
  if (error) throw error
  return data ?? null
}

export async function fetchTileStats(sessionId, questionId) {
  const { data, error } = await supabase.rpc('quiz_tiles_stats', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
    p_online_window_sec: 60,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ?? { solved: 0, guesses: 0, online: 0, total: 0, still_in: 0 }
}

/**
 * คำตอบทุกคำเรียงตามเวลา พร้อมค่าความใกล้เคียง
 *
 * after = แถวสุดท้ายที่เคยได้มา { created_at, guess_id } — ส่งกลับไปเพื่อดึงเฉพาะของใหม่
 * ไม่ใช่ลากทั้งกองทุก 1.5 วินาที (40 คน × โควตา 5 = 200 แถวต่อข้อ)
 */
export async function fetchTileFeed(sessionId, questionId, after = null, limit = 40) {
  const { data, error } = await supabase.rpc('quiz_tiles_feed', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
    p_after_at: after?.created_at ?? null,
    p_after_id: after?.guess_id ?? null,
    p_limit: limit,
  })
  if (error) throw error
  return data ?? []
}

/**
 * รับคำที่เกือบถูกเป็นคำตอบถูก
 * ต่างจากปริศนาใบ้คำ: ให้คนที่พิมพ์ "คนแรก" คนเดียว แล้วข้อจบทันที เพราะเกมนี้เป็นการแข่ง
 * และจำคำนั้นเป็น alias ถาวร ชุดนี้ครั้งหน้าไม่ต้องกดอีก
 */
export async function acceptTileAnswer(sessionId, questionId, text) {
  const { data, error } = await supabase.rpc('quiz_tiles_accept', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
    p_text: text,
  })
  if (error) throw error
  return data
}

// ── ฝั่งคนสร้างข้อ (ต้องใช้ PIN — เฉลยและ URL ภาพอยู่ในตารางที่ปิดจาก anon) ──

export async function fetchTilesSet({ setId, staffId, pin }) {
  const { data, error } = await supabase.rpc('quiz_tiles_set_for_edit', {
    p_set_id: setId,
    p_staff_id: staffId,
    p_pin: pin,
  })
  if (error) throw error
  return data ?? []
}

export async function saveTilesQuestion({
  staffId, pin, setId, questionId, text, timeLimitSec,
  gridRows, gridCols, openStep, coverImageUrl, crop, imageUrl,
  answer, aliases, explain, sortOrder,
}) {
  const { data, error } = await supabase.rpc('quiz_tiles_upsert', {
    p_staff_id: staffId,
    p_pin: pin,
    p_set_id: setId,
    p_question_id: questionId ?? null,
    p_text: text ?? '',
    p_time_limit_sec: timeLimitSec ?? 300,
    p_grid_rows: gridRows ?? 3,
    p_grid_cols: gridCols ?? 4,
    p_open_step: openStep ?? 1,
    p_cover_image_url: coverImageUrl ?? null,
    p_crop_x: crop?.x ?? 0,
    p_crop_y: crop?.y ?? 0,
    p_crop_w: crop?.w ?? 1,
    p_crop_h: crop?.h ?? 1,
    p_tile_image_url: imageUrl,
    p_answer: answer,
    p_aliases: aliases ?? [],
    p_explain: explain ?? '',
    p_sort_order: sortOrder ?? 0,
  })
  if (error) throw error
  return data
}

/**
 * ลองตรวจคำตอบโดยไม่ต้องขึ้นเวที — ยืมของปริศนาใบ้คำมาทั้งดุ้น
 *
 * เป็นวิธีเดียวที่คนสร้างข้อจะรู้ตัวก่อนว่าคำที่ลูกทัวร์น่าจะพิมพ์ยังไม่ผ่าน
 * และในเกมนี้สำคัญกว่าปริศนาใบ้คำมาก เพราะคนแรกที่ถูกจบข้อเลย —
 * คนที่พิมพ์ถูกแต่สะกดไม่ตรงจะแพ้ให้คนที่พิมพ์ตรงกว่า โดยคนคุมเกมไม่มีทางรู้ทัน
 */
export { tryAnswer } from './puzzleHost'
