// คลาสร่วมของช่องกรอกในหน้าบันทึกรายจ่าย
//
// ทำไมต้องรวมไว้ที่เดียว: หน้านี้วางปุ่ม ชิป <select> และ <input type="date"> ไว้บรรทัดเดียวกัน
// ซึ่งเบราว์เซอร์ให้ความสูงเริ่มต้นไม่เท่ากันทั้งหมด (โดยเฉพาะ select กับ date บน iOS
// ที่สูงกว่า input ปกติ 2-4px) พอแต่ละอันเขียน padding เองอิสระ ขอบล่างเลยไม่ตรงกัน
// เห็นเป็นแถวเบี้ยวๆ — ตรึงเป็น h-10 เท่ากันหมดแล้วคุมจากที่นี่ที่เดียว

/** ความสูงมาตรฐานของทุกคอนโทรลในหน้านี้ */
export const CONTROL_H = 'h-10'

/** ช่องกรอกข้อความ/ตัวเลข */
export const inputClass =
  `${CONTROL_H} w-full rounded-control border border-transparent bg-surface-sunken px-3 text-base text-ink placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none transition`

/** <select> — ตัด appearance เดิมทิ้งเพื่อให้สูงเท่า input จริงๆ ทุกเบราว์เซอร์
 *  แล้ววาดลูกศรเองด้วย background image (ไม่งั้นจะกลายเป็นกล่องเปล่าที่ดูไม่ออกว่ากดได้) */
export const selectClass =
  `${CONTROL_H} w-full appearance-none rounded-control border border-transparent bg-surface-sunken bg-[length:0.65rem] bg-[right_0.7rem_center] bg-no-repeat pl-3 pr-7 text-base text-ink focus:border-brand focus:bg-surface focus:outline-none transition`

/** ลูกศรของ select — แยกเป็น style เพราะ Tailwind ใส่ data-uri ใน class ไม่ได้ */
export const selectArrowStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")",
}

/** ชิปเลือกค่า (หมวด / วันที่ลัด) — สูงเท่าคอนโทรลอื่นเพื่อให้วางแถวเดียวกันได้ */
export function chipClass(active) {
  return `${CONTROL_H} rounded-control px-3 text-sm font-semibold transition ${
    active ? 'bg-brand text-white shadow-brand' : 'bg-surface-sunken text-ink-muted hover:bg-brand-lighter'
  }`
}

/** ป้ายกำกับเหนือกลุ่มคอนโทรล */
export const fieldLabelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint'
