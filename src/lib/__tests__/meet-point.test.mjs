import {
  hasMeetPoint, hasMeetCoords, parseMeetPointInput, isValidLatLng, isLikelyUrl,
  meetPointMapsUrl, meetPointDirectionsUrl, meetPointOpenUrl, minutesUntilMeet, meetUrgency,
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
ok(hasMeetPoint({ meet_url: 'https://maps.app.goo.gl/abc' }), 'มีแต่ลิงก์ก็ถือว่ามีจุดนัดพบ')
ok(!hasMeetCoords({ meet_url: 'https://maps.app.goo.gl/abc' }), 'แต่ไม่นับว่ามีพิกัด')
ok(hasMeetCoords({ meet_lat: 1, meet_lng: 2 }), 'มีพิกัดจริง')

console.log('── แกะพิกัดจากสิ่งที่ทีมงานวางลงช่อง')
eq(parseMeetPointInput('https://www.google.com/maps/@12.9276,100.8871,17z'),
  { lat: 12.9276, lng: 100.8871 }, 'ลิงก์แบบ @lat,lng')
eq(parseMeetPointInput('https://maps.google.com/?q=12.9276,100.8871'),
  { lat: 12.9276, lng: 100.8871 }, 'ลิงก์แบบ q=')
eq(parseMeetPointInput('12.9276, 100.8871'), { lat: 12.9276, lng: 100.8871 },
  'พิกัดดิบที่ก็อปมาจากแชท')
eq(parseMeetPointInput('12.9276,100.8871'), { lat: 12.9276, lng: 100.8871 }, 'พิกัดดิบไม่มีเว้นวรรค')
eq(parseMeetPointInput('-33.86,151.21'), { lat: -33.86, lng: 151.21 }, 'ซีกโลกใต้ค่าติดลบ')
// ⚠️ ลิงก์ย่อคือค่าเริ่มต้นของปุ่มแชร์ในแอป Google Maps = เคสปกติ ไม่ใช่เคสหายาก
// แกะพิกัดไม่ได้ (ไม่มีพิกัดอยู่ข้างใน + เบราว์เซอร์ตามลิงก์เองไม่ได้เพราะ CORS)
// จึงต้องเก็บลิงก์ไว้ใช้ตรงๆ ไม่ใช่ปฏิเสธทิ้ง
eq(parseMeetPointInput('https://maps.app.goo.gl/abc123'),
  { url: 'https://maps.app.goo.gl/abc123' }, 'ลิงก์ย่อ → เก็บเป็นลิงก์')
eq(parseMeetPointInput('https://goo.gl/maps/xyz'),
  { url: 'https://goo.gl/maps/xyz' }, 'ลิงก์ย่อแบบเก่า → เก็บเป็นลิงก์')
eq(parseMeetPointInput('  https://maps.app.goo.gl/abc123  '),
  { url: 'https://maps.app.goo.gl/abc123' }, 'ตัดช่องว่างหัวท้ายก่อนเก็บ')

console.log('── ลิงก์ที่แอปเราสร้างเอง ต้องก็อปกลับมาวางแล้วแกะออก')
eq(parseMeetPointInput('https://www.google.com/maps/search/?api=1&query=12.9276,100.8871'),
  { lat: 12.9276, lng: 100.8871 }, 'ลิงก์จาก meetPointMapsUrl()')
eq(parseMeetPointInput('https://www.google.com/maps/dir/?api=1&destination=12.9276,100.8871&travelmode=walking'),
  { lat: 12.9276, lng: 100.8871 }, 'ลิงก์จาก meetPointDirectionsUrl()')
eq(parseMeetPointInput('https://www.google.com/maps/place/Wat/@12.9276,100.8871,17z/data=!3m1'),
  { lat: 12.9276, lng: 100.8871 }, 'ลิงก์แบบ place ที่มี @ อยู่กลาง')
eq(parseMeetPointInput(''), null, 'ช่องว่าง')
eq(parseMeetPointInput(null), null, 'ค่า null')
eq(parseMeetPointInput('ประตู 3 ชั้น G'), null, 'ข้อความเปล่าๆ ไม่ใช่ทั้งพิกัดและลิงก์')
eq(parseMeetPointInput('www.google.com/maps'), null, 'ไม่มี http:// ไม่ถือว่าเป็นลิงก์')
eq(parseMeetPointInput('91.0,100.0'), null, 'lat เกิน 90 → ไม่รับ')
eq(parseMeetPointInput('12.0,181.0'), null, 'lng เกิน 180 → ไม่รับ')

console.log('── ตรวจช่วงพิกัด')
ok(isValidLatLng(0, 0), '0,0 อยู่ในช่วง')
ok(isValidLatLng(-90, 180), 'ขอบพอดี')
ok(!isValidLatLng(90.1, 0), 'เกินขอบบน')
ok(!isValidLatLng(NaN, 0), 'NaN ไม่ผ่าน')
ok(!isValidLatLng(undefined, undefined), 'undefined ไม่ผ่าน')

console.log('── หน้าตาเป็นลิงก์ไหม')
ok(isLikelyUrl('https://maps.app.goo.gl/x'), 'https ผ่าน')
ok(isLikelyUrl('http://example.com/a'), 'http ผ่าน')
ok(!isLikelyUrl('maps.app.goo.gl/x'), 'ไม่มี scheme ไม่ผ่าน')
ok(!isLikelyUrl('https://มี ช่องว่าง'), 'มีช่องว่างกลางลิงก์ไม่ผ่าน')
ok(!isLikelyUrl(''), 'ว่างไม่ผ่าน')

console.log('── ปุ่มของลูกทัวร์เปิดลิงก์ไหน')
ok(meetPointOpenUrl({ meet_lat: 12.9, meet_lng: 100.8 }).includes('travelmode=walking'),
  'มีพิกัด → นำทางโหมดเดิน')
eq(meetPointOpenUrl({ meet_url: 'https://maps.app.goo.gl/abc' }),
  'https://maps.app.goo.gl/abc', 'มีแต่ลิงก์ → เปิดลิงก์นั้น')
ok(meetPointOpenUrl({ meet_lat: 12.9, meet_lng: 100.8, meet_url: 'https://x.test/a' })
     .includes('travelmode=walking'),
  'มีทั้งคู่ → พิกัดชนะ เพราะให้เวลาเดินได้ทันที')
eq(meetPointOpenUrl({}), null, 'ไม่มีอะไรเลย → ไม่มีลิงก์')
eq(meetPointOpenUrl(null), null, 'ไม่มีแถว → ไม่พัง')

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
