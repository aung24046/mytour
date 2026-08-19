import { shapeGeometry } from '../../lib/quizStyle'

// รูปทรงกำกับสีของตัวเลือก — ต้องตรงกันเป๊ะระหว่างจอใหญ่กับมือถือ
//
// วาดด้วย clip-path ไม่ใช่ตัวอักษร ▲ ◆ ● ■ ด้วยสองเหตุผล:
//   1. ฟอนต์วาดสี่ตัวนี้มาคนละสัดส่วน ตั้งขนาดเท่ากันแต่ ● กับ ■ เล็กกว่า ▲ ราว 40%
//      บนจอเวทีเห็นชัดจนดูเหมือนตัวเลือกไม่เท่ากัน — ที่นี่คุมพื้นที่หมึกให้เท่ากันจริง
//   2. ทีวี Android บนรถบางรุ่นไม่มีกลิฟพวกนี้ในฟอนต์ระบบ จะขึ้นเป็นสี่เหลี่ยมว่าง
//
// ใช้ currentColor เสมอ — สีมาจาก text-* หรือ color ของกล่องที่ครอบอยู่
// aria-hidden เพราะเป็นของประดับ ความหมายอยู่ที่ข้อความตัวเลือกซึ่งอ่านได้อยู่แล้ว
export default function OptionShape({ shape, size = 32, className = '' }) {
  const g = shapeGeometry(shape)
  return (
    <span
      aria-hidden="true"
      className={`inline-grid flex-none place-items-center ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        style={{
          width: size * g.scale,
          height: size * g.scale,
          background: 'currentColor',
          clipPath: g.clip,
        }}
      />
    </span>
  )
}
