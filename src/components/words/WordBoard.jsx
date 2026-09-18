// กระดานคำของเกม What Words — ตัวเดียวใช้ทุกจอ (มือถือ · จอใหญ่ · ทีวีบนรถ · Builder)
//
// รับช่องที่ผ่าน applyOpened() มาแล้ว: [{ c, m, state }]
//   shown   ตัวที่ไม่ได้ซ่อน — วาดเป็นตัวหนังสือธรรมดา
//   hidden  ตัวที่ซ่อน — กล่องว่างมีขีดล่าง แต่สระบน/ล่าง/วรรณยุกต์ยังลอยอยู่
//   opened  ตัวที่คนคุมเกมเปิดแล้วระหว่างเล่น — กล่องสีเขียวพร้อมตัวจริง
//   answer  ตอนเฉลย — ตัวที่เคยซ่อนโชว์ในกล่องสีเขียว ให้เห็นว่าคำตอบคือตัวไหน
//   peek    จอคนคุมเกม — กล่องว่างแต่เห็นตัวจริงจางๆ (รู้ว่ากำลังจะเปิดตัวอะไร)
//   filled  Word Shuffle — ตัวที่ "ผู้เล่นเอง" หยิบจากกองมาวาง (กล่องฟ้า) แตะเพื่อเอาคืนได้
//           ★ ต้องคนละสีกับ opened/answer (เขียว = ของจริงที่ระบบยืนยันแล้ว)
//           ไม่งั้นผู้เล่นจะอ่านว่าตัวที่ตัวเองวางคือคำตอบที่ถูกแล้ว
//
// ── วาดเครื่องหมายลอยเหนือช่องว่างยังไง ─────────────────────────────────
// สระบน/วรรณยุกต์ของไทยไม่มีความกว้างของตัวเอง ต้องมีตัวฐานให้เกาะถึงจะวางถูกที่
// วิธีที่ใช้: วาด "อ" + เครื่องหมายด้วยสีหมึก แล้ววาด "อ" ตัวเดียวทับด้วย "สีพื้นกล่อง"
//   ตำแหน่งตรงกันพิกเซลต่อพิกเซลเพราะเป็นตัวแรกของบรรทัดทั้งคู่ ส่วน text-stroke กินขอบ
//   anti-alias ที่จะเหลือเป็นเงาจางๆ
// ★ ทดสอบกับภาพจริงทั้ง 5 ฟอนต์ของแอป (Noto Sans Thai / Looped · Kanit · Anuphan · Chakra Petch)
// ⚠️ สีที่ทับต้องตรงกับพื้นกล่องเสมอ — กล่องจึงมีสีพื้นของตัวเองทุกจอ ไม่ยืมสีธีม
//    ห้ามทำกล่องโปร่งใส/ไล่เฉด ไม่งั้นจะเห็น "อ" โผล่ออกมา = เฉลยรั่วเป็นรูปร่างตัวอักษร
//    (แม้ "อ" ไม่ใช่ตัวจริง แต่คนเล่นจะงงว่าช่องนี้คือ อ)
//
// ── ทำไมกล่องไม่ใช่ขีดล่างเฉยๆ แบบในภาพต้นฉบับ ────────────────────────
// บนจอมือถือขีดล่างบางๆ มองแทบไม่เห็นว่าเป็น "ช่อง" และสีพื้นคือสิ่งที่ทำให้วิธีทับข้างบนใช้ได้

const PLACEHOLDER = 'อ'

const SKINS = {
  // จอใหญ่สกิน arcade — พื้นขาว หมึกดำ กล่องเทาอ่อน
  // ★ เดิมกล่องเป็นเหลืองเดียวกับป้ายพิล เจ้าของโปรเจกต์ขอเปลี่ยนเป็นเทาอ่อน (11 ก.ย. 2026)
  //   เหลืองสดหลายกล่องติดกันบนจอใหญ่ดูแล้วลายตา
  // size = ขนาดสำรองของเบราว์เซอร์ที่ไม่รู้จัก cqw · fit = ขนาดจริงที่คิดจากความกว้างกล่องที่วางกระดาน
  stage: {
    box: '#e5e7eb', bar: '#000000', ink: '#000000', open: '#bbf7d0', openInk: '#065f46',
    peekInk: 'rgba(0,0,0,0.25)', fill: '#dbeafe', fillInk: '#1e3a8a', sel: '#2563eb',
    size: 'clamp(3rem, calc(86vw / var(--ww-units)), 12rem)',
    fit: 'clamp(2.25rem, calc(100cqw * 0.95 / var(--ww-units)), 12rem)',
  },
  bus_tv: {
    box: '#e5e7eb', bar: '#000000', ink: '#000000', open: '#bbf7d0', openInk: '#065f46',
    peekInk: 'rgba(0,0,0,0.25)', fill: '#dbeafe', fillInk: '#1e3a8a', sel: '#2563eb',
    size: 'clamp(3.5rem, calc(92vw / var(--ww-units)), 16rem)',
    fit: 'clamp(2.5rem, calc(100cqw * 0.95 / var(--ww-units)), 16rem)',
  },
  // มือถือ — ตัวที่ไม่ซ่อนใช้สีธีม (currentColor) ส่วนในกล่องใช้สีตายตัว อ่านได้ทั้งโหมดมืด/สว่าง
  phone: {
    box: '#e5e7eb', bar: '#1f2937', ink: '#111827', open: '#bbf7d0', openInk: '#065f46',
    peekInk: 'rgba(17,24,39,0.3)', fill: '#dbeafe', fillInk: '#1e3a8a', sel: '#2563eb',
    size: 'clamp(1.75rem, calc(min(100vw, 28rem) * 0.82 / var(--ww-units)), 3.5rem)',
    fit: 'clamp(1.25rem, calc(100cqw * 0.95 / var(--ww-units)), 3.5rem)',
  },
  mini: {
    box: '#e5e7eb', bar: '#1f2937', ink: '#111827', open: '#bbf7d0', openInk: '#065f46',
    peekInk: 'rgba(17,24,39,0.3)', fill: '#dbeafe', fillInk: '#1e3a8a', sel: '#2563eb',
    size: '1.6rem',
    fit: '1.6rem',
  },
}

/** ความกว้างโดยประมาณเป็นหน่วย em — ใช้คิดขนาดตัวอักษรให้คำยาวยังพอดีจอ */
export function unitsOf(cells) {
  let u = 0
  for (const x of cells) {
    if (x.c === ' ') u += 0.4
    else if (x.state === 'shown') u += 0.62
    else u += 1.02
  }
  return Math.max(u, 3)
}

/** แบ่งเป็นคำตามช่องว่าง — คำยาวหลายคำขึ้นบรรทัดใหม่ได้เฉพาะระหว่างคำ ไม่หักกลางคำ */
function splitWords(cells) {
  const words = [[]]
  cells.forEach((x, i) => {
    if (x.c === ' ') words.push([])
    else words[words.length - 1].push({ ...x, slot: i })
  })
  return words.filter((w) => w.length > 0)
}

/**
 * วาดเฉพาะสระบน/ล่าง/วรรณยุกต์ โดยไม่มีตัวฐานให้เห็น — หัวใจของเกมนี้
 * ใช้ได้ทุกที่ที่พื้นหลังเป็นสีทึบ `bg` (ดูคำอธิบายหัวไฟล์) — Builder ใช้ตัวนี้ในปุ่มแตะซ่อนด้วย
 * ไม่มีเครื่องหมาย = คืนตัวฐานโปร่งใสไว้ให้ความสูงเท่าช่องอื่น
 */
export function MarksOnly({ marks, bg, ink }) {
  if (!marks) return <span style={{ color: 'transparent' }}>{PLACEHOLDER}</span>
  return (
    <span className="relative" style={{ color: ink }}>
      {PLACEHOLDER + marks}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0"
        // ★ อย่างน้อย 2.5px — ตัวเล็ก (ปุ่มใน Builder 24px) 0.07em = 1.7px ไม่พอ ยังเห็นเงา "อ" จางๆ
        //   เพราะตัวที่มีเส้นขอบถูกวาดเป็น path ไม่ผ่าน hinting ตำแหน่งขอบจึงเหลื่อมกับตัวปกตินิดหน่อย
        //   วัดจากภาพจริงแล้ว: 2px ยังจาง · 2.5px หายสนิท และสระ ี ข้างบนไม่แหว่ง (11 ก.ย. 2026)
        //   ตัวใหญ่ (จอโปรเจกเตอร์) ใช้ 0.07em เหมือนเดิม
        style={{ color: bg, WebkitTextStroke: `max(0.07em, 2.5px) ${bg}` }}
      >
        {PLACEHOLDER}
      </span>
    </span>
  )
}

/**
 * ขนาดตัวอักษรของกระดานบนจอแต่ละแบบ — ShufflePool ใช้ค่าเดียวกันเพื่อให้ป้ายตัวสลับ "เท่ากับช่องด้านบน"
 * (เจ้าของโปรเจกต์ขอ 12 ก.ย. 2026) คิดจาก units ของกระดาน ไม่ใช่ของกอง จึงเท่ากันทุกจอ
 */
export function boardFont(surface) {
  const skin = SKINS[surface] ?? SKINS.phone
  return { size: skin.size, fit: skin.fit }
}

// ขนาดกล่องหนึ่งช่อง (em) — ShufflePool ใช้ชุดเดียวกัน แก้ที่นี่ที่เดียว
export const BOX_GEOMETRY = { minWidth: '0.9em', padding: '0 0.06em', margin: '0 0.05em', lineHeight: 1.7 }

function Box({ cell, skin, onClick, selected = false }) {
  const byHost = cell.state === 'opened' || cell.state === 'answer'
  const byPlayer = cell.state === 'filled'
  const bg = byHost ? skin.open : byPlayer ? skin.fill : skin.box
  const style = {
    background: bg,
    // ช่องที่กำลังจะวางตัวถัดไป: กรอบสีรอบกล่อง (เงานอก) — ขีดล่างเดิมยังอยู่ (เงาใน)
    boxShadow: selected
      ? `inset 0 -0.09em 0 ${skin.bar}, 0 0 0 0.08em ${skin.sel}`
      : `inset 0 -0.09em 0 ${skin.bar}`,
    minWidth: BOX_GEOMETRY.minWidth,
    padding: BOX_GEOMETRY.padding,
    margin: BOX_GEOMETRY.margin,
    borderRadius: '0.1em 0.1em 0 0',
  }

  let inner
  if (byHost || byPlayer) {
    inner = (
      <span style={{ color: byHost ? skin.openInk : skin.fillInk }}>
        {`${cell.c ?? ''}${cell.m ?? ''}`}
      </span>
    )
  } else if (cell.state === 'peek') {
    inner = <span style={{ color: skin.peekInk }}>{`${cell.c ?? ''}${cell.m ?? ''}`}</span>
  } else {
    inner = <MarksOnly marks={cell.m} bg={bg} ink={skin.ink} />
  }

  const common = {
    className: 'relative inline-flex justify-center align-baseline',
    style,
    'data-slot': cell.slot,
    'data-state': cell.state,
  }

  if (onClick) {
    return (
      <button
        type="button"
        {...common}
        // touch-manipulation = ไม่ต้องรอ 300ms เช็คว่าดับเบิลแท็ป — แตะเรียงตัวอักษรรัวๆ ต้องติดมือ
        className={`${common.className} cursor-pointer touch-manipulation transition active:scale-95`}
        onClick={() => onClick(cell.slot)}
      >
        {inner}
      </button>
    )
  }
  return <span {...common}>{inner}</span>
}

/**
 * clickStates = สถานะที่แตะได้ (ค่าเริ่มต้น peek = จอคนคุมเกมเท่านั้น)
 *   หน้าเล่น Word Shuffle ส่ง ['hidden', 'filled'] — แตะช่องว่างเพื่อเลือก แตะช่องที่วางแล้วเพื่อเอาตัวคืน
 * selectedSlot = ช่องที่ตัวถัดไปจะลง (กรอบสี)
 */
export default function WordBoard({
  cells = [], surface = 'phone', onSlotClick, clickStates = ['peek'], selectedSlot = null, className = '',
}) {
  const skin = SKINS[surface] ?? SKINS.phone
  const words = splitWords(cells)
  const units = unitsOf(cells)

  // สำหรับโปรแกรมอ่านหน้าจอ — ช่องที่ซ่อนอ่านว่า "ว่าง"
  const label = cells
    .map((x) => (x.state === 'hidden' || x.state === 'peek' ? '_' : `${x.c ?? ''}${x.m ?? ''}`))
    .join('')
  const clickable = (state) => Boolean(onSlotClick) && clickStates.includes(state)

  // ★ ขนาดตัวอักษรคิดจากความกว้างของ "กล่องที่วางกระดาน" (container query) ไม่ใช่ความกว้างจอ
  //   เดิมคิดจาก vw — จอ 1920 การ์ดกว้างสุดแค่ 1500px คำ 12 ช่อง (Word Shuffle: กรุงเทพมหานคร)
  //   จึงล้นขอบการ์ดออกไป (เจอตอนวัดขนาดป้ายตัวสลับ 12 ก.ย. 2026)
  //   ตัวครอบถือ container-type ส่วนตัวในใช้ cqw — เบราว์เซอร์เก่าทิ้งค่า fit แล้วใช้ size ของตัวครอบ
  //   ⚠️ ตัวครอบกว้างตามพ่อเสมอ (container-type ทำให้กว้างตามเนื้อหาไม่ได้) — ในแถว flex ต้องส่ง w-full
  return (
    <div className={className} style={{ containerType: 'inline-size', fontSize: skin.size, '--ww-units': units }}>
      <div
        role="img"
        aria-label={label}
        className="flex flex-wrap items-baseline justify-center font-extrabold"
        style={{
          fontSize: skin.fit,
          lineHeight: 1.7,
          columnGap: '0.35em',
          // เผื่อที่ให้วรรณยุกต์ที่ซ้อนบนสระบน (ที่ · ผู้ · เกี๊ยว) ไม่ชนขอบบน
          paddingTop: '0.1em',
        }}
      >
        {words.map((word, wi) => (
          // inline-block ไม่ใช่ inline-flex — ลูกของ flex กลายเป็นกล่องแยก เบราว์เซอร์จะจัดรูปอักษรข้ามช่องไม่ได้
          <span key={wi} className="inline-block whitespace-nowrap">
            {word.map((cell) =>
              cell.state === 'shown' ? (
                <span key={cell.slot} data-slot={cell.slot} data-state="shown">
                  {`${cell.c ?? ''}${cell.m ?? ''}`}
                </span>
              ) : (
                <Box
                  key={cell.slot}
                  cell={cell}
                  skin={skin}
                  selected={cell.slot === selectedSlot}
                  onClick={clickable(cell.state) ? onSlotClick : undefined}
                />
              )
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
