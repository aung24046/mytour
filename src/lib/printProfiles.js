// Print profile — ขนาดกระดาษ ระยะขอบ และการตัดสินแนวกระดาษของเอกสาร export
//
// ทำไมต้องมีไฟล์นี้: PrintExport.jsx เดิม hardcode `@page size` ตามขนาด label ไว้ในคอมโพเนนต์
// แปลว่าทั้งระบบพิมพ์ได้แค่ "โปรไฟล์ป้ายสติกเกอร์" เท่านั้น เอกสาร A4 จึงทำไม่ได้
// ไฟล์นี้แยกโปรไฟล์ออกมาให้ทุกเอกสารเรียกใช้ร่วมกัน
//
// อ้างอิงสเปก: MyTour_Export_DataSpec_v1.md §9.3 §10 §11

/** ขนาดกระดาษ (มม.) */
export const PAPER = {
  a4_portrait: { id: 'a4_portrait', widthMm: 210, heightMm: 297, label: 'A4 แนวตั้ง' },
  a4_landscape: { id: 'a4_landscape', widthMm: 297, heightMm: 210, label: 'A4 แนวนอน' },
  a5_portrait: { id: 'a5_portrait', widthMm: 148, heightMm: 210, label: 'A5 แนวตั้ง' },
  a5_landscape: { id: 'a5_landscape', widthMm: 210, heightMm: 148, label: 'A5 แนวนอน' },
  // ป้ายสติกเกอร์เดิมของ PrintExport.jsx — ยกมาไว้ที่เดียวกัน
  label_50x30: { id: 'label_50x30', widthMm: 50, heightMm: 30, label: 'ป้าย 50×30mm' },
  label_60x40: { id: 'label_60x40', widthMm: 60, heightMm: 40, label: 'ป้าย 60×40mm' },
}

/** ระยะขอบกระดาษ (มม.) — บน/ล่างเผื่อหัวกระดาษกับเลขหน้า */
export const MARGIN_MM = { top: 14, right: 12, bottom: 14, left: 12 }

/** ความกว้างที่ใช้วางตารางได้จริง */
export function usableWidthMm(paper) {
  return paper.widthMm - MARGIN_MM.left - MARGIN_MM.right
}

/**
 * นโยบายข้อความยาว (§10.2)
 * - nowrap   บรรทัดเดียว ไม่ตัดคำ — ชื่อ เลขบัตร เบอร์ วันที่ จำนวนเงิน
 * - stack    ซ้อน 2 บรรทัดในช่องเดียว — จับคู่ฟิลด์ที่ไปด้วยกัน ลดจำนวนคอลัมน์
 * - clamp    ตัดที่ n บรรทัดด้วย … — ข้อความอิสระสั้น
 * - subrow   ยกลงแถวย่อยเต็มความกว้างใต้แถวหลัก — เอกสารใช้ภายใน
 * - footnote ใส่เลขกำกับแล้วรวมท้ายหน้า — เอกสารส่งภายนอก
 */
export const OVERFLOW = {
  NOWRAP: 'nowrap',
  STACK: 'stack',
  CLAMP: 'clamp',
  SUBROW: 'subrow',
  FOOTNOTE: 'footnote',
}

/**
 * ความกว้างประมาณของแต่ละคอลัมน์ (มม.) ที่ 9pt
 * ใช้ตัดสินแนวกระดาษล่วงหน้าโดยไม่ต้องวัดจริงในเบราว์เซอร์
 * ค่าพวกนี้เผื่อไว้เล็กน้อย — ผิดพลาดทางกว้างดีกว่าผิดพลาดทางแคบ
 */
export const COLUMN_WIDTH_MM = {
  index: 8,
  room_number: 14,
  floor: 10,
  room_type: 16,
  max_guests: 12,
  name: 38,
  nickname: 22,
  name_en: 44,
  title: 14,
  gender: 12,
  birthdate: 24,
  age: 12,
  national_id: 32,
  passport_no: 26,
  passport_expiry: 24,
  nationality: 20,
  insurance_no: 26,
  phone: 28,
  emergency_contact_name: 30,
  emergency_contact_phone: 28,
  food_allergy: 34,
  medical_condition: 34,
  dietary: 30,
  note: 30,
  seat_number: 14,
  tag_code: 22,
  status: 18,
  expense_date: 18,
  category: 20,
  description: 42,
  supplier: 26,
  currency: 22,
  amount: 24,
  paid_by: 20,
  receipt: 14,
}

const DEFAULT_COLUMN_WIDTH_MM = 26

/** คอลัมน์ที่ซ้อนอยู่ในช่องเดียวกัน (stack) ไม่กินความกว้างเพิ่ม — คิดค่าที่กว้างกว่า */
export function estimateTableWidthMm(columns) {
  const stacked = new Set()
  for (const col of columns) {
    if (col.overflow === OVERFLOW.STACK && col.stackWith) stacked.add(col.stackWith)
  }

  let total = 0
  for (const col of columns) {
    // footnote ไม่ได้อยู่ในตาราง และคอลัมน์ที่ถูกซ้อนทับไปแล้วไม่นับซ้ำ
    if (col.overflow === OVERFLOW.FOOTNOTE) continue
    if (col.overflow === OVERFLOW.SUBROW) continue
    if (stacked.has(col.key)) continue

    const own = COLUMN_WIDTH_MM[col.key] ?? DEFAULT_COLUMN_WIDTH_MM
    if (col.overflow === OVERFLOW.STACK && col.stackWith) {
      const pair = COLUMN_WIDTH_MM[col.stackWith] ?? DEFAULT_COLUMN_WIDTH_MM
      total += Math.max(own, pair)
    } else {
      total += own
    }
  }
  return total
}

/**
 * ตัดสินแนวกระดาษเอง (§9.3) — ผู้ใช้ไม่ต้องเลือกตั้ง/นอน
 * คืนเหตุผลมาด้วยเพื่อให้ UI อธิบายได้ว่าทำไมถึงสลับ
 */
export function decideOrientation(columns, { size = 'a4' } = {}) {
  const portrait = size === 'a5' ? PAPER.a5_portrait : PAPER.a4_portrait
  const landscape = size === 'a5' ? PAPER.a5_landscape : PAPER.a4_landscape

  const needed = estimateTableWidthMm(columns)
  const portraitRoom = usableWidthMm(portrait)

  if (needed <= portraitRoom) {
    return { paper: portrait, neededMm: needed, availableMm: portraitRoom, switched: false }
  }
  return {
    paper: landscape,
    neededMm: needed,
    availableMm: usableWidthMm(landscape),
    switched: true,
    reason: `คอลัมน์ที่เลือกกว้าง ${Math.round(needed)}mm เกิน ${Math.round(portraitRoom)}mm ของแนวตั้ง`,
  }
}

/** เกินความกว้างของแนวนอนด้วย = ต้องตัดคอลัมน์ออก ไม่มีทางพิมพ์ให้พอดี */
export function exceedsLandscape(columns, { size = 'a4' } = {}) {
  const landscape = size === 'a5' ? PAPER.a5_landscape : PAPER.a4_landscape
  return estimateTableWidthMm(columns) > usableWidthMm(landscape)
}

/** ค่าตัวอักษรสำหรับงานพิมพ์ (§11.3) — ไทยต้องการระยะบรรทัดมากกว่าละติน */
export const TYPE_SCALE = {
  tableBody: { sizePt: 9, lineHeight: 1.45 },
  tableHead: { sizePt: 9, lineHeight: 1.45, weight: 500 },
  docTitle: { sizePt: 13, lineHeight: 1.35, weight: 500 },
  orgMeta: { sizePt: 7.5, lineHeight: 1.5 },
  footer: { sizePt: 7.5, lineHeight: 1.5 },
  footnote: { sizePt: 7.5, lineHeight: 1.6 },
  minPt: 7, // ต่ำกว่านี้สระไทยเริ่มติดกัน
}

/**
 * CSS ของ @page + คลาสร่วมที่ทุกเอกสารใช้
 * ฉีดผ่าน <style> ในหน้าเอกสาร เพราะ @page size เปลี่ยนตามแนวกระดาษที่คำนวณได้
 */
export function buildPrintCss(paper) {
  return `
@page {
  size: ${paper.widthMm}mm ${paper.heightMm}mm;
  margin: ${MARGIN_MM.top}mm ${MARGIN_MM.right}mm ${MARGIN_MM.bottom}mm ${MARGIN_MM.left}mm;
}

@media print {
  html, body {
    background: #ffffff !important;
  }

  .doc-root {
    /* ไทยใช้ Noto Sans Thai Looped เพราะต้องการแบบมีหัว — Google Sans มีกลิฟไทยแต่เป็นแบบไม่มีหัว
       ละตินกับตัวเลขตกไปที่ Google Sans ผ่าน unicode-range ที่ประกาศไว้ใน index.css */
    font-family: 'Noto Sans Thai Looped', 'Google Sans', system-ui, sans-serif;
    color: #1f2937;
    font-size: ${TYPE_SCALE.tableBody.sizePt}pt;
    line-height: ${TYPE_SCALE.tableBody.lineHeight};
  }

  /* หัวกระดาษซ้ำทุกหน้า — thead ต้องเป็น table-header-group ถึงจะซ้ำจริง */
  .doc-table thead { display: table-header-group; }
  .doc-table tfoot { display: table-footer-group; }
  .doc-table tr { page-break-inside: avoid; }

  /* แถวย่อยต้องไม่หลุดจากแถวหลัก */
  .doc-row-group { page-break-inside: avoid; }

  .doc-page-break { page-break-after: always; }

  /* ตัวเลขให้หลักตรงกันทุกแถว */
  .doc-num { font-variant-numeric: tabular-nums; }

  .print\\:hidden, .no-print { display: none !important; }
}
`
}
