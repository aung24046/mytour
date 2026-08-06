// เสียง + สั่น ตอนมีผู้ชนะบิงโก
//
// ทำไมไม่ใช้ไฟล์เสียง: staff เปิดหน้านี้บนมือถือกลางรถทัวร์ ไฟล์เสียงต้องโหลด
// ต้องมี asset ต้องเผื่อ offline — Web Audio สังเคราะห์เอาเลยจบในไฟล์เดียว
//
// ข้อจำกัดเบราว์เซอร์: AudioContext จะถูกบล็อกจนกว่าผู้ใช้จะแตะหน้าจอสักครั้ง
// (autoplay policy) → เราสร้าง context ตอนแตะครั้งแรก แล้ว reuse ตลอด
// ฝั่ง staff ยังไงก็ต้องกด "ประกาศเลข" ก่อนอยู่แล้ว จึงปลดล็อกเองโดยธรรมชาติ

let ctx = null

function getCtx() {
  if (typeof window === 'undefined') return null
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return null
  if (!ctx) {
    try {
      ctx = new AudioCtx()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** เรียกตอนผู้ใช้แตะอะไรก็ได้ เพื่อปลดล็อก autoplay ล่วงหน้า */
export function primeWinAlert() {
  getCtx()
}

function beep(audio, freq, startAt, duration) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'triangle'
  osc.frequency.value = freq
  // เฟดหัวท้าย กัน pop เวลาเปิดเสียงดัง
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain).connect(audio.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

/** เสียงชนะสามโน้ตขึ้น + สั่น — เงียบไปเฉยๆ ถ้าเบราว์เซอร์ไม่รองรับ */
export function playWinAlert() {
  const audio = getCtx()
  if (audio) {
    const now = audio.currentTime
    beep(audio, 660, now, 0.14)
    beep(audio, 880, now + 0.16, 0.14)
    beep(audio, 1175, now + 0.32, 0.26)
  }
  try {
    navigator.vibrate?.([120, 60, 120, 60, 240])
  } catch {
    // no-op — iOS Safari ไม่มี vibrate
  }
}
