import {
  clampGrid, clampStep, tileCount, tileNumbers, tilePosition, normalizeCrop,
  tileStyle, coverStyle, boardAspect, tileAspect, tileShapeWarning,
  isOpen, openCount, justOpened, GRID_PRESETS, CROP_RATIOS,
} from '../tileGrid.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }
const IMG = 'https://x/p.jpg'
const pos = (s) => s.backgroundPosition.split(' ').map((v) => parseFloat(v))
const size = (s) => s.backgroundSize.split(' ').map((v) => parseFloat(v))
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps

console.log('── กริดและหมายเลข')
ok(tileCount(3, 4) === 12, '3×4 = 12 แผ่น')
ok(tileNumbers(2, 3).join(',') === '1,2,3,4,5,6', 'หมายเลขเรียง 1..N')
ok(clampGrid(99, 0).rows === 6 && clampGrid(99, 0).cols === 2, 'กริดนอกช่วงถูกบีบเข้าช่วง ไม่พัง')
ok(clampGrid(null, undefined).rows === 3 && clampGrid(null, undefined).cols === 4, 'ค่าว่างได้ค่าเริ่มต้น 3×4')
ok(clampStep(9) === 4 && clampStep(0) === 1, 'จำนวนแผ่นต่อการกดถูกบีบ 1-4')

console.log('── ตำแหน่งแผ่นในกริด')
ok(tilePosition(1, 3, 4).row === 0 && tilePosition(1, 3, 4).col === 0, 'แผ่น 1 อยู่ซ้ายบน')
ok(tilePosition(4, 3, 4).row === 0 && tilePosition(4, 3, 4).col === 3, 'แผ่น 4 อยู่ขวาสุดแถวแรก')
ok(tilePosition(5, 3, 4).row === 1 && tilePosition(5, 3, 4).col === 0, 'แผ่น 5 ขึ้นแถวใหม่')
ok(tilePosition(12, 3, 4).row === 2 && tilePosition(12, 3, 4).col === 3, 'แผ่นสุดท้ายอยู่ขวาล่าง')
ok(tilePosition(99, 3, 4).row === 2, 'หมายเลขเกินช่วงถูกบีบ ไม่คืน NaN')

console.log('── กรอบครอป')
ok(normalizeCrop(null).w === 1, 'ไม่มีกรอบ = ใช้ทั้งภาพ')
ok(normalizeCrop({ x: -1, y: 2, w: 5, h: 0 }).w === 1, 'ค่าเพี้ยนถูกบีบ ไม่พังทั้งกระดาน')
ok(normalizeCrop({ x: 0.8, w: 0.5 }).x === 0.5, 'กรอบล้นขวาถูกดันกลับให้อยู่ในภาพ')
ok(normalizeCrop({ crop_x: 0.25, crop_w: 0.5 }).x === 0.25, 'รับชื่อคอลัมน์จาก DB ได้ตรงๆ')

console.log('── คณิตศาสตร์การตัดภาพ (ไม่ครอป)')
const s0 = tileStyle(1, { rows: 3, cols: 4, imageUrl: IMG })
ok(near(size(s0)[0], 400) && near(size(s0)[1], 300), 'ไม่ครอป: ภาพกว้าง 4 เท่าของกล่อง สูง 3 เท่า')
ok(near(pos(s0)[0], 0) && near(pos(s0)[1], 0), 'แผ่นแรกอยู่มุมซ้ายบนของภาพ')
ok(near(pos(tileStyle(4, { rows: 3, cols: 4, imageUrl: IMG }))[0], 100), 'แผ่นขวาสุด = 100%')
ok(near(pos(tileStyle(2, { rows: 3, cols: 4, imageUrl: IMG }))[0], 100 / 3), 'แผ่นที่สอง = 1/3 ของช่วง')
ok(near(pos(tileStyle(12, { rows: 3, cols: 4, imageUrl: IMG }))[1], 100), 'แถวล่างสุด = 100%')
ok(tileStyle(1, { rows: 3, cols: 4 }) === null, 'ไม่มีภาพ = คืน null ให้วาดช่องเปล่า ไม่ throw')

console.log('── คณิตศาสตร์การตัดภาพ (ครอปแล้ว)')
// ครอปครึ่งกลางแนวนอน: ภาพถูกขยายเป็น 8 เท่าของกล่อง และเลื่อนไป 2 กล่อง
const c = { x: 0.25, y: 0, w: 0.5, h: 1 }
const s1 = tileStyle(1, { rows: 3, cols: 4, crop: c, imageUrl: IMG })
ok(near(size(s1)[0], 800), 'ครอปครึ่งกว้าง → ภาพกว้าง 8 เท่าของกล่อง')
ok(near(pos(s1)[0], (2 / 7) * 100), 'แผ่นแรกเลื่อนไป 2 กล่อง = 2/7 ของช่วง')
const s4 = tileStyle(4, { rows: 3, cols: 4, crop: c, imageUrl: IMG })
ok(near(pos(s4)[0], (5 / 7) * 100), 'แผ่นขวาสุดเลื่อนไป 5 กล่อง = 5/7 ของช่วง')
ok(near(pos(s1)[1], 0) && near(size(s1)[1], 300), 'แกนตั้งไม่ถูกครอปก็ต้องไม่เปลี่ยน')

console.log('── ภาพตอนปิด')
const cv = coverStyle(6, { rows: 3, cols: 4, imageUrl: IMG })
ok(near(size(cv)[0], 400), 'ภาพตอนปิดใช้กริดเดียวกัน')
ok(near(pos(cv)[0], 100 / 3) && near(pos(cv)[1], 50), 'ภาพตอนปิดไม่ครอป ใช้สูตรสไปรต์ตรงๆ')
ok(coverStyle(1, { rows: 3, cols: 4 }) === null, 'ไม่มีภาพตอนปิด = null ให้ใช้สีตามธีม')

console.log('── สัดส่วน')
ok(near(boardAspect(16 / 9, null), 16 / 9), 'ไม่ครอป กระดานได้สัดส่วนภาพเดิม')
ok(near(boardAspect(16 / 9, { x: 0, y: 0, w: 0.5, h: 1 }), 8 / 9), 'ครอปครึ่งกว้าง กระดานแคบลงครึ่งหนึ่ง')
ok(near(tileAspect(16 / 9, 3, 4, null), (16 / 9) * 3 / 4), 'แผ่น = สัดส่วนกระดาน × แถว ÷ คอลัมน์')
ok(near(tileAspect(1, 3, 3, null), 1), 'ภาพจัตุรัสกับกริดจัตุรัส ได้แผ่นจัตุรัส')
ok(tileShapeWarning(16 / 9, 3, 4, null) === null, '16:9 บนกริด 3×4 ไม่ต้องเตือน')
ok(tileShapeWarning(1, 2, 6, null) === 'tall', 'กริดกว้างมากบนภาพจัตุรัส = แผ่นผอมเป็นเส้น ต้องเตือน')
ok(tileShapeWarning(1, 6, 2, null) === 'wide', 'กริดสูงมาก = แผ่นแบนเป็นเส้น ต้องเตือน')
ok(tileAspect(null, 3, 4, null) === null, 'ยังไม่รู้สัดส่วนภาพ = คืน null ไม่เดา')

console.log('── สถานะการเปิด')
ok(isOpen(7, [3, 7, 9]), 'แผ่นที่เปิดแล้ว')
ok(!isOpen(7, []), 'ยังไม่เปิด')
ok(!isOpen(7, null), 'ค่าว่างไม่พัง')
ok(isOpen('7', [7]), 'เลขที่มาเป็น string จาก DB ก็ต้องตรง')
ok(openCount([1, 2, 2, 99], 3, 4) === 2, 'นับแผ่นที่เปิด ไม่นับซ้ำและไม่นับเลขนอกกระดาน')
ok(justOpened([1, 2], [1, 2, 5, 6]).join(',') === '5,6', 'หาแผ่นที่เพิ่งเปิดสำหรับอนิเมชัน')
ok(justOpened(null, [3]).join(',') === '3', 'รอบแรกถือว่าเพิ่งเปิดทั้งหมด')
ok(justOpened([1, 2, 3], [1, 2]).length === 0, 'กดยกเลิกแล้วต้องไม่มีแผ่นเพิ่งเปิด')

console.log('── ค่าตั้งต้นที่ Builder ใช้')
ok(GRID_PRESETS.every((p) => p.rows >= 2 && p.rows <= 6 && p.cols >= 2 && p.cols <= 6),
   'ทุก preset อยู่ในช่วงที่ constraint ของตารางยอมรับ')
ok(CROP_RATIOS[0].value === null, 'ตัวเลือกแรกของกรอบครอปคือแบบอิสระ')

if (fail) { console.log(`\n${fail} ข้อไม่ผ่าน`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
