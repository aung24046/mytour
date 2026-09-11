// กองตัวอักษรที่สลับแล้วของเกม Word Shuffle — ตัวเดียวใช้ทุกจอ (มือถือ · จอใหญ่ · ทีวีบนรถ · Builder)
//
// รับ tiles จาก poolTiles(): [{ c, m, used }]
//   used = ตัวนี้ถูกคนคุมเกมเปิดลงช่องคำตอบแล้ว → จางลง (ยังเห็นอยู่ ให้รู้ว่าเหลือตัวไหน)
//
// ── ขนาด: เท่ากับช่องคำตอบด้านบนพอดี ─────────────────────────────────────
// เจ้าของโปรเจกต์ขอ (12 ก.ย. 2026) หลังลองสองรอบ: รอบแรกป้ายเล็ก/ขอบหนา/มีเงา · รอบสองป้ายใหญ่กว่าช่องด้านบน
//   → ใช้ขนาดตัวอักษรชุดเดียวกับ WordBoard (boardFont + unitsOf ของกระดาน) และขนาดกล่องชุดเดียวกัน (BOX_GEOMETRY)
//   ส่ง boardCells = ช่องที่กระดานด้านบนแสดงอยู่ ถ้าไม่ส่ง (รายการข้อใน Builder) ใช้ขนาดตายตัวของ surface
//   คำไม่มีวรรคจึงกว้างเท่ากระดานพอดี อยู่แถวเดียวเสมอเมื่อกระดานอยู่แถวเดียว
//
// ★ หน้าตาต้อง "ไม่เหมือน" ช่องคำตอบ (กล่องเทาไม่มีขอบ มีขีดล่าง)
//   กองนี้คือตัวที่หยิบได้ ช่องคำตอบคือที่วาง — จึงเป็นป้ายพื้นขาวมีเส้นกรอบบางๆ ไม่มีเงา
// ★ ตัวเดียวในป้ายวาด ตัวฐาน+เครื่องหมาย ตรงๆ ได้เลย (ม่ · ฮ่) ไม่ต้องใช้ MarksOnly
//   เพราะตัวฐานอยู่ครบ — ปัญหาเครื่องหมายลอยมีเฉพาะช่องที่ซ่อนตัวฐาน
import { BOX_GEOMETRY, boardFont, unitsOf } from './WordBoard'

const TILE = {
  stage: 'border-2 border-black bg-white text-black',
  bus_tv: 'border-2 border-black bg-white text-black',
  phone: 'border border-neutral-700 bg-white text-neutral-900',
  mini: 'border border-neutral-400 bg-white text-neutral-900',
}

export default function ShufflePool({ tiles = [], surface = 'phone', boardCells = null, className = '' }) {
  const tile = TILE[surface] ?? TILE.phone
  const font = boardFont(surface)
  // units ของกระดานด้านบน — ขนาดตัวในกองจะคิดสูตรเดียวกันทุกประการ
  const units = unitsOf(boardCells ?? tiles.map((x) => ({ ...x, state: 'hidden' })))

  return (
    // ตัวครอบถือ container-type เหมือน WordBoard — cqw จึงอ้างความกว้างเดียวกับกระดาน
    <div className={className} style={{ containerType: 'inline-size', fontSize: font.size, '--ww-units': units }}>
      <div
        role="list"
        aria-label={tiles.map((x) => `${x.c}${x.m}`).join(' ')}
        className="flex flex-wrap items-center justify-center font-extrabold"
        style={{ fontSize: font.fit, rowGap: '0.15em' }}
        data-testid="shuffle-pool"
      >
        {tiles.map((x, i) => (
          <span
            key={i}
            role="listitem"
            data-used={x.used ? 'true' : 'false'}
            className={`inline-flex justify-center rounded-[0.1em] transition-opacity ${tile} ${
              x.used ? 'opacity-20' : ''
            }`}
            // ความสูงล็อกไว้เท่าช่องด้านบน — ไม่งั้นเส้นกรอบบวกเพิ่มอีก 2-4px
            style={{ ...BOX_GEOMETRY, height: `${BOX_GEOMETRY.lineHeight}em` }}
          >
            {`${x.c ?? ''}${x.m ?? ''}`}
          </span>
        ))}
      </div>
    </div>
  )
}
