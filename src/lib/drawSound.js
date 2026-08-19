// เสียงของเกมสุ่มรายชื่อ — สังเคราะห์ด้วย Web Audio ไม่ใช้ไฟล์เสียง
//
// เหตุผลเดียวกับ winAlert.js ของบิงโก: จอใหญ่เปิดกลางรถทัวร์หรือห้องจัดเลี้ยง
// ถ้าเป็นไฟล์เสียงต้องโหลด ต้องมี asset ต้องเผื่อออฟไลน์ — สังเคราะห์เอาจบในไฟล์เดียว
//
// ข้อจำกัดเบราว์เซอร์: AudioContext ถูกบล็อกจนกว่าผู้ใช้จะแตะจอสักครั้ง
// ฝั่งทีมงานกดปุ่ม "สุ่ม" อยู่แล้วจึงปลดล็อกเอง ส่วนจอใหญ่ต้องเรียก primeDrawSound()
// ตอนผู้ใช้แตะครั้งแรก ไม่งั้นรอบแรกจะเงียบ

let ctx = null

function audio() {
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
export function primeDrawSound() {
  audio()
}

function beep(a, freq, at, dur, type = 'triangle', vol = 0.25) {
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

/** เสียงติ๊กระหว่างรีลวิ่ง */
export function playTick(freq = 1800, vol = 0.07) {
  const a = audio()
  if (!a) return
  beep(a, freq, a.currentTime, 0.03, 'square', vol)
}

/** รัวกลอง — noise ผ่าน lowpass แล้วไล่ความดังขึ้นจนถึงจังหวะเฉลย */
export function playDrumroll(seconds) {
  const a = audio()
  if (!a || !(seconds > 0)) return
  const n = Math.floor(a.sampleRate * seconds)
  const buf = a.createBuffer(1, n, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i += 1) {
    const env = (Math.sin((i / a.sampleRate) * 2 * Math.PI * 17) + 1) / 2
    d[i] = (Math.random() * 2 - 1) * env * 0.55
  }
  const src = a.createBufferSource()
  src.buffer = buf
  const gain = a.createGain()
  const lp = a.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1400
  gain.gain.setValueAtTime(0.03, a.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.26, a.currentTime + seconds * 0.9)
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + seconds)
  src.connect(lp).connect(gain).connect(a.destination)
  src.start()
}

/** สามโน้ตขึ้น + สั่น ตอนเฉลยผู้ชนะ */
export function playFanfare() {
  const a = audio()
  if (a) {
    const t = a.currentTime
    beep(a, 660, t, 0.14)
    beep(a, 880, t + 0.16, 0.14)
    beep(a, 1175, t + 0.32, 0.3)
    beep(a, 1568, t + 0.34, 0.34, 'sine', 0.16)
  }
  try {
    navigator.vibrate?.([120, 60, 120, 60, 240])
  } catch {
    // iOS Safari ไม่มี vibrate — เงียบไปเฉยๆ
  }
}
