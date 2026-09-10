import {
  clueGrid, splitSyllables, validateClues, clueTextScale, clueCellHeight, clueFrameStyle,
} from '../puzzleLayout.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }

const sq   = (n) => Array(n).fill(1)     // รูปจัตุรัส
const tall = (n) => Array(n).fill(0.6)   // กว้าง/สูง = 0.6 → แนวตั้ง
const wide = (n) => Array(n).fill(3)     // พาโนรามา

console.log('── จัดกริดรูปใบ้')
ok(clueGrid(1, { aspects: sq(1) }).columns === 1, 'รูปเดียวได้ช่องเดียว ไม่ใช่แถวที่มีที่ว่าง')
ok(clueGrid(2, { aspects: sq(2) }).columns === 2, 'สองรูปเรียงแถว')

const g3 = clueGrid(3, { surface: 'stage', aspects: sq(3) })
ok(g3.columns === 3 && g3.rows === 1 && !g3.centerLastRow, 'สามรูปบนจอเวที = แถวเดียว (ตรงกับเอกสารตัวอย่าง)')

const g4 = clueGrid(4, { aspects: sq(4) })
ok(g4.columns === 2 && g4.rows === 2, 'สี่รูปเป็น 2×2 ไม่ใช่ 3+1')

const g5 = clueGrid(5, { surface: 'stage', aspects: sq(5) })
ok(g5.columns === 3 && g5.rows === 2, 'ห้ารูปเป็น 3 บน / 2 ล่าง')
ok(g5.lastRowCount === 2 && g5.centerLastRow, 'แถวล่างของห้ารูปต้องอยู่กึ่งกลาง ไม่ชิดซ้าย')

const g6 = clueGrid(6, { surface: 'stage', aspects: sq(6) })
ok(g6.columns === 3 && !g6.centerLastRow, 'หกรูปเต็มพอดี ไม่ต้องจัดกึ่งกลาง')

console.log('── ปรับตามสัดส่วนรูปจริง')
ok(clueGrid(3, { surface: 'stage', aspects: tall(3) }).columns === 2, 'รูปแนวตั้งลดคอลัมน์ กันภาพสูงล้นจอ')
ok(clueGrid(4, { surface: 'stage', aspects: tall(4) }).columns === 2, 'รูปแนวตั้งไม่ลดต่ำกว่า 2 คอลัมน์')
ok(clueGrid(3, { surface: 'stage', aspects: wide(3) }).columns === 3, 'พาโนรามา ≤3 ใบเรียงแถวเดียว')
ok(clueGrid(3, { surface: 'stage', aspects: [1, 1, null] }).columns === 3, 'รูปที่ยังไม่รู้สัดส่วนไม่ทำให้เพี้ยน')
ok(clueGrid(3, { surface: 'stage' }).columns === 3, 'ไม่ส่ง aspects มาเลยก็ต้องได้กริดที่ใช้ได้')

console.log('── เพดานของแต่ละจอ')
ok(clueGrid(6, { surface: 'phone', aspects: sq(6) }).columns === 2, 'มือถือแนวตั้งไม่เกิน 2 คอลัมน์')
ok(clueGrid(6, { surface: 'phoneLandscape', aspects: sq(6) }).columns === 3, 'มือถือแนวนอนได้ 3 คอลัมน์')
ok(clueGrid(0).columns === 1, 'จำนวน 0 ถูกบีบเข้าช่วง ไม่ระเบิด')
ok(clueGrid(99).columns === 3, 'จำนวนเกิน 6 ถูกบีบเข้าช่วง')

console.log('── แยกพยางค์')
ok(splitSyllables('ภู-กระ-ดึง').join('|') === 'ภู|กระ|ดึง', 'แยกด้วยขีดกลาง')
ok(splitSyllables(' กา - ละ--แม ').join('|') === 'กา|ละ|แม', 'เว้นวรรค/ขีดซ้ำไม่ทำให้ได้พยางค์ว่าง')
ok(splitSyllables('').length === 0 && splitSyllables(null).length === 0, 'ค่าว่างไม่พัง')

console.log('── ตรวจก่อนบันทึก')
ok(validateClues([]) !== null, 'ไม่มีรูปใบ้เลย ต้องไม่ผ่าน')
ok(validateClues([{ body: '   ' }]) !== null, 'รูปใบ้ว่างล้วน ต้องไม่ผ่าน')
ok(validateClues([{ body: 'x' }]) === null, 'หนึ่งชิ้นผ่าน')
ok(validateClues(Array(6).fill({ body: 'x' })) === null, 'หกชิ้นผ่าน')
ok(validateClues(Array(7).fill({ body: 'x' })) !== null, 'เจ็ดชิ้นไม่ผ่าน')

console.log('── ขนาดตัวอักษรของใบ้แบบอีโมจิ/คำ')
ok(clueTextScale('emoji', '🐐') > clueTextScale('text', 'กะละมังใบใหญ่'), 'คำยาวต้องเล็กกว่าอีโมจิ')
ok(clueTextScale('text', 'กา') > clueTextScale('text', 'กะละมังใบใหญ่'), 'คำสั้นใหญ่กว่าคำยาว')

console.log('── ขนาดกรอบรูปใบ้')
const px = (css) => Number(/(\d+(?:\.\d+)?)px/.exec(css)[1])
ok(px(clueCellHeight('stage', 1)) > px(clueCellHeight('stage', 2)), 'แถวเดียวได้ช่องสูงกว่าหลายแถว')
ok(px(clueCellHeight('stage', 1)) > px(clueCellHeight('phone', 1)), 'จอเวทีใหญ่กว่ามือถือ')
ok(px(clueCellHeight('phone', 2)) <= 130, 'สองแถวบนมือถือต้องไม่กินจอจนช่องพิมพ์ตกขอบ')
ok(clueCellHeight('bus_tv', 3) === clueCellHeight('stage', 3), 'ทีวีบนรถใช้สเกลเดียวกับจอเวที')
ok(clueCellHeight('ไม่รู้จัก', 1) === clueCellHeight('stage', 1), 'พื้นผิวแปลกๆ ตกไปที่ค่าจอเวที ไม่พัง')

const H = clueCellHeight('stage', 1)
const fSquare = clueFrameStyle(1, H)
ok(fSquare.aspectRatio === '1', 'กรอบมีสัดส่วนเท่ารูป จึงหุ้มรูปพอดี ไม่เหลือขอบขาว')
ok(fSquare.width === `min(100%, calc(${H} * 1))`, 'กว้างได้ไม่เกินช่อง และไม่เกินความสูงช่องคูณสัดส่วน')
ok(!('height' in fSquare), 'ความสูงมาจาก aspect-ratio ไม่ใช่ตั้งเอง ไม่งั้นรูปนอนจัดจะมีขอบขาวบน-ล่าง')
ok(clueFrameStyle(0.6, H).aspectRatio === '0.6', 'รูปแนวตั้งได้กรอบแนวตั้ง ไม่ใช่กรอบขาวเต็มช่อง')
ok(clueFrameStyle(3, H).width.includes('min(100%'), 'พาโนรามาถูกจำกัดที่ความกว้างช่องก่อน')
ok(clueFrameStyle(null, H).width === '100%' && !clueFrameStyle(null, H).aspectRatio,
   'รูปที่ยังโหลดไม่เสร็จใช้เต็มช่องไปก่อน')
ok(clueFrameStyle(null, H).height === H, 'กรอบที่ยังไม่รู้สัดส่วนต้องสูงเท่าช่อง ไม่ใช่สูงศูนย์')
ok(clueFrameStyle(0, H).width === '100%' && clueFrameStyle(NaN, H).width === '100%',
   'สัดส่วนพังๆ ไม่ทำให้กรอบสูงศูนย์')

console.log(fail === 0 ? '✓ ผ่านทั้งหมด' : `✗ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail === 0 ? 0 : 1)
