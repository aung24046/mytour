import {
  hasMeetPoint, parseMeetPointInput, isValidLatLng,
  meetPointMapsUrl, meetPointDirectionsUrl, minutesUntilMeet, meetUrgency,
} from '../meetPoint.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — ได้ ${JSON.stringify(a)}`)

console.log('── มีหมุดหรือยัง')
ok(hasMeetPoint({ meet_lat: 12.9, meet_lng: 100.9 }), 'มีพิกัดครบ')
ok(!hasMeetPoint({ meet_lat: 12.9, meet_lng: null }), 'มีครึ่งเดียวไม่นับ')
ok(!hasMeetPoint({}), 'ประกาศธรรมดาไม่มีหมุด')
ok(!hasMeetPoint(null), 'ไม่มีแถวเลยก็ไม่พัง')
// 0,0 เป็นพิกัดที่ถูกต้องตามหลัก แต่ในทางปฏิบัติแปลว่ามีบั๊ก — ที่นี่ยอมรับไว้ก่อน
// เพราะ constraint ฝั่ง DB คุมช่วงค่าให้แล้ว และการตัด 0 ทิ้งจะพังกับประเทศแถบเส้นศูนย์สูตร
ok(hasMeetPoint({ meet_lat: 0, meet_lng: 0 }), 'พิกัด 0,0 ยังถือว่ามีค่า')

console.log('── แกะพิกัดจากสิ่งที่ทีมงานวางลงช่อง')
eq(parseMeetPointInput('https://www.google.com/maps/@12.9276,100.8871,17z'),
  { lat: 12.9276, lng: 100.8871 }, 'ลิงก์แบบ @lat,lng')
eq(parseMeetPointInput('https://maps.google.com/?q=12.9276,100.8871'),
  { lat: 12.9276, lng: 100.8871 }, 'ลิงก์แบบ q=')
eq(parseMeetPointInput('12.9276, 100.8871'), { lat: 12.9276, lng: 100.8871 },
  'พิกัดดิบที่ก็อปมาจากแชท')
eq(parseMeetPointInput('12.9276,100.8871'), { lat: 12.9276, lng: 100.8871 }, 'พิกัดดิบไม่มีเว้นวรรค')
eq(parseMeetPointInput('-33.86,151.21'), { lat: -33.86, lng: 151.21 }, 'ซีกโลกใต้ค่าติดลบ')
eq(parseMeetPointInput('https://maps.app.goo.gl/abc123'), null,
  'ลิงก์ย่อไม่มีพิกัดอยู่ข้างใน — ต้องคืน null ไม่ใช่เดามั่ว')
eq(parseMeetPointInput(''), null, 'ช่องว่าง')
eq(parseMeetPointInput(null), null, 'ค่า null')
eq(parseMeetPointInput('ประตู 3 ชั้น G'), null, 'ข้อความเปล่าๆ ไม่ใช่พิกัด')
eq(parseMeetPointInput('91.0,100.0'), null, 'lat เกิน 90 → ไม่รับ')
eq(parseMeetPointInput('12.0,181.0'), null, 'lng เกิน 180 → ไม่รับ')

console.log('── ตรวจช่วงพิกัด')
ok(isValidLatLng(0, 0), '0,0 อยู่ในช่วง')
ok(isValidLatLng(-90, 180), 'ขอบพอดี')
ok(!isValidLatLng(90.1, 0), 'เกินขอบบน')
ok(!isValidLatLng(NaN, 0), 'NaN ไม่ผ่าน')
ok(!isValidLatLng(undefined, undefined), 'undefined ไม่ผ่าน')

console.log('── ลิงก์แผนที่')
ok(meetPointMapsUrl(12.9276, 100.8871).includes('query=12.9276,100.8871'), 'ลิงก์ดูตำแหน่ง')
ok(meetPointDirectionsUrl(12.9276, 100.8871).includes('travelmode=walking'),
  'ลิงก์นำทางต้องเป็นโหมดเดิน ไม่ใช่ขับรถ')
eq(meetPointMapsUrl(null, null), null, 'ไม่มีพิกัด → ไม่มีลิงก์')

console.log('── นับถอยหลังถึงเวลารวมพล')
const at = (h, m) => { const d = new Date(2026, 7, 19, h, m, 0, 0); return d }
eq(minutesUntilMeet('15:00', at(14, 20)), 40, 'เหลือ 40 นาที')
eq(minutesUntilMeet('15:00', at(15, 0)), 0, 'ถึงเวลาพอดี')
eq(minutesUntilMeet('15:00', at(15, 7)), -7, 'เลยมา 7 นาที → ติดลบ')
eq(minutesUntilMeet('09:05', at(8, 55)), 10, 'เลขนำหน้าศูนย์')
eq(minutesUntilMeet('', at(14, 0)), null, 'ไม่ได้ตั้งเวลา')
eq(minutesUntilMeet(null, at(14, 0)), null, 'ค่า null')
eq(minutesUntilMeet('3 โมง', at(14, 0)), null, 'รูปแบบผิด → null ไม่ใช่ NaN')
eq(minutesUntilMeet('25:00', at(14, 0)), null, 'ชั่วโมงเกินจริง')

console.log('── ระดับความเร่งด่วน')
eq(meetUrgency(40), 'ok', 'ยังสบาย')
eq(meetUrgency(15), 'soon', 'เหลือ 15 นาทีพอดี → เริ่มเร่ง')
eq(meetUrgency(0), 'soon', 'ถึงเวลาพอดียังไม่ถือว่าสาย')
eq(meetUrgency(-1), 'past', 'เลยเวลา')
eq(meetUrgency(null), null, 'ไม่ได้ตั้งเวลา → ไม่ต้องแสดงสถานะ')

console.log(fail === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail === 0 ? 0 : 1)
