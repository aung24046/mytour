// เลขที่ใบของแบบประเมินฉบับกระดาษ
//
// ต้องอยู่ที่เดียว เพราะสองฝั่งต้องคิดเลขเหมือนกันเป๊ะ:
//   - FeedbackFormPrint.jsx  พิมพ์เลขนี้ลงกระดาษ
//   - FeedbackSummary.jsx    เดาเลขใบถัดไปตอนนั่งคีย์
// ถ้าสูตรเพี้ยนกันเมื่อไหร่ คนคีย์จะเห็นเลขที่ระบบเดาไม่ตรงกับเลขบนใบตรงหน้า
// แล้วจะเริ่มพิมพ์ทับเอง ซึ่งเป็นต้นทางของข้อมูลซ้ำ

/** รหัสนำหน้าอิงจากรหัสเข้าทริป — ทริปเดียวกันได้เลขชุดเดียวกัน ไม่ปนกันในแฟ้ม */
export function slipPrefix(joinCode) {
  const code = String(joinCode ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
  return code ? `${code.slice(0, 6)}-` : 'FB-'
}

/** FB-007 — เลข 3 หลักพอสำหรับทริป 999 คน และอ่านง่ายกว่าเลขยาว */
export function slipNo(prefix, n) {
  return `${prefix}${String(n).padStart(3, '0')}`
}

/** เลขใบถัดไปที่ยังไม่ถูกใช้ — ดูจากคำตอบที่คีย์ไปแล้ว ไม่ใช่นับจำนวนแถว
 *  (ใบที่ถูกลบทิ้งกลางทางจะทำให้การนับแถวเพี้ยน แต่ max ไม่เพี้ยน) */
export function nextSlipNumber(responses, prefix) {
  let max = 0
  for (const r of responses ?? []) {
    const slip = r?.paper_slip_no
    if (!slip || !slip.startsWith(prefix)) continue
    const n = Number(slip.slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}
