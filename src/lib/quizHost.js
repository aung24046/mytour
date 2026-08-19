import { supabase } from './supabase'

// ความลับของคนคุมเกม
//
// ตอนนี้ระบบยังไม่มี Supabase Auth — สตาฟกับลูกทัวร์ใช้ anon key ตัวเดียวกัน
// ถ้าคำสั่ง "เปิดข้อถัดไป / เฉลย / จบเกม" เป็น UPDATE ธรรมดา ลูกทัวร์ก็ยิงเองได้
// จึงต้องมีความลับอย่างน้อยหนึ่งอย่าง = token ที่ออกให้ครั้งเดียวตอนสร้างห้อง
//
// เก็บใน localStorage ไม่ใช่ sessionStorage — เคยเป็น sessionStorage ด้วยเหตุผลว่า
// "ปิดแท็บแล้วหายคือสิ่งที่ต้องการ" แต่หน้างานจริงพังกว่านั้นมาก:
// มือถือที่คุมเกมแบตหมด / เผลอปิดแท็บ / เปลี่ยนคนคุม = token หาย
// แล้ว quiz_set_state('finished') สั่งไม่ได้อีกเลย ห้องนั้นค้างอยู่ในรายการของ
// ลูกทัวร์ตลอดไป (guest/Quiz.jsx กรองแค่ state ≠ 'finished') กดเข้าไปแล้วรอเก้อ
//
// ราคาที่จ่ายคือ token ค้างบนเครื่องข้ามวัน ซึ่งรับได้ — เครื่องทีมงานเป็นเครื่อง
// ส่วนตัว และ token ผูกกับห้องเดียวที่จบไปแล้ว สั่งอะไรต่อไม่ได้อยู่ดี
const KEY_PREFIX = 'mytour.quiz.host.'

export function saveHostToken(sessionId, token) {
  if (!sessionId || !token) return
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, token)
  } catch {
    // โหมดส่วนตัวของ Safari เขียนไม่ได้ — ไม่ใช่เรื่องคอขาดบาดตาย
  }
}

export function getHostToken(sessionId) {
  if (!sessionId) return null
  try {
    // อ่าน sessionStorage ต่อท้ายด้วย เผื่อห้องที่เปิดค้างไว้ก่อนย้ายมาใช้ localStorage
    return (
      localStorage.getItem(KEY_PREFIX + sessionId) ??
      sessionStorage.getItem(KEY_PREFIX + sessionId)
    )
  } catch {
    return null
  }
}

export function clearHostToken(sessionId) {
  try {
    localStorage.removeItem(KEY_PREFIX + sessionId)
    sessionStorage.removeItem(KEY_PREFIX + sessionId)
  } catch {
    // ไม่ต้องทำอะไร
  }
}

// จอเวทีเปิดคนละแท็บกับมือถือที่คุมเกม จึงรับ token ผ่าน hash ของ URL
// ใช้ hash ไม่ใช่ query string เพราะ hash ไม่ถูกส่งไป server และไม่ติดใน log ของ CDN
export function readTokenFromHash() {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return null
  return new URLSearchParams(raw).get('t')
}

/** ทั้งจอเวทีและมือถือทีมงานเรียกตัวนี้ตัวเดียว */
export function resolveHostToken(sessionId) {
  const fromHash = readTokenFromHash()
  if (fromHash) {
    saveHostToken(sessionId, fromHash)
    return fromHash
  }
  return getHostToken(sessionId)
}

// ---------------------------------------------------------------------
// คำสั่งคุมเกม — รวมไว้ที่เดียวเพื่อไม่ให้ลืมแนบ token
// ---------------------------------------------------------------------
export async function startSession({
  tourId, setId, name, busId, screenMode, staffId, teamMode, teamSizeLimit, stageTheme,
}) {
  const { data, error } = await supabase.rpc('quiz_start_session', {
    p_tour_id: tourId,
    p_set_id: setId,
    p_name: name ?? null,
    p_bus_id: busId ?? null,
    p_screen_mode: screenMode ?? 'projector',
    p_staff_id: staffId ?? null,
  })
  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  if (row?.session_id && row?.token) saveHostToken(row.session_id, row.token)

  // โหมดทีมตั้งหลังสร้างห้อง ไม่ยัดเข้า quiz_start_session
  // เพราะ RPC นั้นถูกเรียกจากที่อื่นด้วย และการเพิ่มพารามิเตอร์ท้ายฟังก์ชัน
  // ที่ GRANT ไว้แล้วต้อง DROP/CREATE ใหม่ทั้งตัว — ไม่คุ้มกับสองคอลัมน์
  // สกินจอเวทีก็เหมือนกัน — อัปเดตตามหลังด้วยเหตุผลเดียวกับโหมดทีม
  // ค่าเริ่มต้นอยู่ที่ DB ('day') จึงส่งเฉพาะตอนทีมงานเลือกเป็นอย่างอื่น
  //
  // ⚠️ เดิมตรงนี้ยิง UPDATE ตรงเข้า quiz_sessions ผ่าน REST ซึ่งทำได้เพราะ
  //    ตารางเปิด UPDATE ให้ anon — แปลว่าลูกทัวร์ก็สั่งเกมได้เหมือนกัน
  //    20260819_game_hardening.sql ปิดช่องนั้นแล้ว จึงต้องผ่าน RPC ที่ตรวจ token
  const hasTeam = Boolean(teamMode)
  const hasTheme = Boolean(stageTheme && stageTheme !== 'day')

  if (row?.session_id && (hasTeam || hasTheme)) {
    const { error: optErr } = await supabase.rpc('quiz_set_options', {
      p_session_id: row.session_id,
      p_token: row.token,
      p_team_mode: hasTeam ? true : null,
      p_team_size_limit: hasTeam ? teamSizeLimit ?? 0 : null,
      p_stage_theme: hasTheme ? stageTheme : null,
    })
    // ห้องถูกสร้างไปแล้ว ถ้าตั้งค่าไม่ผ่านต้องรู้ตัว ไม่ใช่เปิดห้องเดี่ยวมาแบบเงียบๆ
    // ทั้งที่ทีมงานเลือกโหมดทีมไว้ (เคสเดิม: UPDATE เงียบ ไม่มีใครเห็น error)
    if (optErr) throw optErr
  }

  return row
}

export async function nextQuestion(sessionId, expectedIndex) {
  const { data, error } = await supabase.rpc('quiz_next', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_expected_index: expectedIndex ?? null,
    p_lead_ms: 3000,
  })
  if (error) throw error
  return data
}

export async function lockAnswers(sessionId) {
  const { data, error } = await supabase.rpc('quiz_lock', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
  })
  if (error) throw error
  return data
}

export async function revealAnswer(sessionId) {
  const { data, error } = await supabase.rpc('quiz_reveal', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
  })
  if (error) throw error
  return data
}

/** "ปิดรับ + เฉลยเลย" ของหน้าทีมงาน = สองคำสั่งติดกัน ไม่ต้องมี RPC ใหม่ */
export async function lockAndReveal(sessionId) {
  await lockAnswers(sessionId)
  return revealAnswer(sessionId)
}

export async function setSessionState(sessionId, state) {
  const { data, error } = await supabase.rpc('quiz_set_state', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_state: state,
  })
  if (error) throw error
  return data
}

export async function removePlayer(sessionId, playerId) {
  const { error } = await supabase.rpc('quiz_remove_player', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_player_id: playerId,
  })
  if (error) throw error
}

export async function fetchPendingPlayers(sessionId, questionId, limit = 3) {
  const { data, error } = await supabase.rpc('quiz_pending_players', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
    p_limit: limit,
    p_online_window_sec: 60,
  })
  if (error) return []
  return data ?? []
}

export async function fetchLeaderboard(sessionId, limit = 10) {
  const { data, error } = await supabase.rpc('quiz_leaderboard', {
    p_session_id: sessionId,
    p_limit: limit,
  })
  if (error) return []
  return data ?? []
}

export async function fetchTeamLeaderboard(sessionId) {
  const { data, error } = await supabase.rpc('quiz_team_leaderboard', {
    p_session_id: sessionId,
  })
  if (error) return []
  return data ?? []
}

export async function renameTeam(sessionId, teamId, name) {
  const { error } = await supabase.rpc('quiz_rename_team', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_team_id: teamId,
    p_name: name,
  })
  if (error) throw error
}

export async function deleteTeam(sessionId, teamId) {
  const { error } = await supabase.rpc('quiz_delete_team', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_team_id: teamId,
  })
  if (error) throw error
}

// ── คลัง + รายงาน (ต้องใช้ PIN ไม่ใช่ token) ──────────────────────────
// ทั้งสองตัวต้องอ่านตารางที่ปิดจาก anon (quiz_keys / quiz_answers)
// จึงใช้ PIN ทีมงานเป็นค่าผ่านทาง แบบเดียวกับ quiz_set_for_edit
// ไม่ใช้ host_token เพราะ token อยู่แค่ในแท็บที่เปิดห้อง — พอจะมาดูรายงานทีหลัง
// (คนละวัน คนละเครื่อง) token หายไปแล้ว แต่ PIN ยังอยู่กับตัวคน

export async function cloneSet({ staffId, pin, setId, title }) {
  const { data, error } = await supabase.rpc('quiz_clone_set', {
    p_staff_id: staffId,
    p_pin: pin,
    p_set_id: setId,
    p_title: title ?? null,
  })
  if (error) throw error
  return data
}

/**
 * ลบชุดคำถาม
 * คืน { status } — 'deleted' | 'in_use' | 'not_found'
 * 'in_use' ไม่ใช่ error แต่เป็นคำตอบว่า "ลบไม่ได้เพราะเคยเล่นไปแล้ว"
 * ฝั่งหน้าจอต้องเอาไปเสนอ "เก็บเข้ากรุแทนไหม"
 */
export async function deleteSet({ staffId, pin, setId }) {
  const { data, error } = await supabase.rpc('quiz_delete_set', {
    p_staff_id: staffId,
    p_pin: pin,
    p_set_id: setId,
  })
  if (error) throw error
  return data
}

export async function fetchReport({ sessionId, staffId, pin }) {
  const { data, error } = await supabase.rpc('quiz_report', {
    p_session_id: sessionId,
    p_staff_id: staffId,
    p_pin: pin,
  })
  if (error) throw error
  return data ?? []
}

/** ลิงก์จอใหญ่ พร้อม token ใน hash */
export function stageUrl(sessionId) {
  const token = getHostToken(sessionId)
  const base = `${window.location.origin}/staff/quiz/stage/${sessionId}`
  return token ? `${base}#t=${token}` : base
}
