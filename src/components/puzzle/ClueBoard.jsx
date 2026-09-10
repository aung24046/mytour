import { useEffect, useMemo, useState } from 'react'

import { clueGrid, clueTextScale, clueCellHeight, clueFrameStyle } from '../../lib/puzzleLayout'

// กระดานรูปใบ้ — ใช้ตัวเดียวกันทั้งจอเวที มือถือลูกทัวร์ มือถือทีมงาน และพรีวิวใน Builder
//
// ทำไมต้องเป็น component เดียว ไม่ใช่ก็อปสี่ที่: พรีวิวใน Builder ที่ไม่ตรงกับของจริง
// แย่กว่าไม่มีพรีวิว เพราะคนสร้างข้อจะเชื่อมันแล้วไปเจอของจริงบนเวทีต่อหน้าคน 40 คน
//
// สองกติกาที่ห้ามแหก (ดูข้อ 4.4 / 4.7 ของ MyTour_WordPuzzle_Design_v1.md):
//   • object-contain ไม่ใช่ object-cover — ครอปกลางภาพจะตัดเชือกออกจากรูปชักเย่อ
//     แล้วข้อนั้นก็ตอบไม่ได้อีกเลย
//   • ทุกช่องสูงเท่ากัน — ความสูงเท่ากันคือสิ่งที่ทำให้แถวดูเป็นระเบียบ ไม่ใช่ความกว้าง
//     (แต่ "กว้างเท่ากัน" ไม่ใช่กติกา — กรอบกว้างตามรูปได้ ดู clueFrameStyle)

/** อ่านสัดส่วนรูปจริงเพื่อให้ clueGrid ตัดสินใจได้ — รูปที่ยังโหลดไม่เสร็จส่ง null ไป */
function useAspects(clues) {
  const [aspects, setAspects] = useState([])

  useEffect(() => {
    let alive = true
    const list = clues ?? []
    const next = list.map(() => null)
    setAspects(next)

    list.forEach((clue, i) => {
      if ((clue.clue_kind ?? clue.kind) !== 'image' || !clue.body) return
      const img = new Image()
      img.onload = () => {
        if (!alive || !img.naturalHeight) return
        setAspects((prev) => {
          const copy = [...prev]
          copy[i] = img.naturalWidth / img.naturalHeight
          return copy
        })
      }
      img.src = clue.body
    })

    return () => {
      alive = false
    }
  }, [clues])

  return aspects
}

export default function ClueBoard({
  clues = [],
  surface = 'stage',
  labels = null,      // คำกำกับใต้รูป — มีเฉพาะตอนเฉลย
  className = '',
  cellHeight,         // ความสูงของช่อง (CSS length) — ผู้เรียกกำหนดตามพื้นที่ที่มี
}) {
  const list = useMemo(() => (clues ?? []).filter((c) => (c?.body ?? '') !== ''), [clues])
  const aspects = useAspects(list)
  const grid = clueGrid(list.length, { surface, aspects })

  if (list.length === 0) return null

  // ความสูงมาจาก puzzleLayout เพื่อให้เทสต์จับได้ว่ากรอบใหญ่ขึ้นตอนไหน
  const height = cellHeight ?? clueCellHeight(surface, grid.rows)

  // แถวสุดท้ายที่ไม่เต็มต้องอยู่กึ่งกลาง (เช่น 5 รูป = 3 บน / 2 ล่าง)
  // ถ้าปล่อยชิดซ้ายจะดูเหมือนจอเรนเดอร์ไม่เสร็จ ไม่ใช่ดีไซน์
  //
  // ทำด้วย flex-wrap + justify-center ไม่ใช่ grid เพราะ grid จัดกึ่งกลางเฉพาะ
  // แถวสุดท้ายไม่ได้ — ต้องคำนวณ gridColumnStart เอง ซึ่งได้แค่ "เยื้องไปทางขวา"
  // ไม่ใช่กึ่งกลางจริง (2 ใบใน 3 คอลัมน์ไม่มีคอลัมน์ตรงกลางให้ลง)
  // ส่วน flex ตัดบรรทัดเองแล้วจัดกึ่งกลางให้ทุกแถวโดยไม่ต้องรู้ว่าแถวไหนไม่เต็ม
  const gap = surface === 'phone' ? 12 : 16
  const basis = `calc((100% - ${(grid.columns - 1) * gap}px) / ${grid.columns})`

  return (
    <div
      className={`flex w-full flex-wrap justify-center ${className}`}
      style={{ gap: `${gap}px` }}
    >
      {list.map((clue, i) => {
        // reveal_payload ส่งมาเป็น {kind, body} ส่วนตารางใช้ clue_kind
        // รับทั้งสองแบบตรงนี้ที่เดียว ดีกว่าให้ผู้เรียกสี่ที่แปลงเองแล้วลืมไปสามที่
        const kind = clue.clue_kind ?? clue.kind ?? 'image'
        const isImage = kind === 'image'

        // กรอบของรูปหุ้มรูปพอดี ส่วนกรอบของอีโมจิ/คำกินเต็มช่อง —
        // ตัวอักษรคิดขนาดเป็น cqw (เทียบความกว้างกรอบ) ถ้ากรอบหดตามเนื้อหา
        // ความกว้างจะอ้างอิงตัวเอง จึงให้ containerType เฉพาะกรอบที่กว้างคงที่
        const frame = isImage
          ? clueFrameStyle(aspects[i] ?? null, height)
          : { width: '100%', height, containerType: 'inline-size' }

        return (
          <figure
            key={clue.id ?? i}
            style={{ flex: `0 0 ${basis}`, maxWidth: basis }}
            className="m-0 flex min-w-0 flex-col items-center"
          >
            {/* ช่องสูงเท่ากันทุกใบ (แถวจะได้เป็นระเบียบ) ส่วนกรอบข้างในหุ้มรูปพอดี
                กรอบที่แคบกว่าช่องจะลอยอยู่กึ่งกลาง ไม่ใช่ชิดซ้าย */}
            <div style={{ height }} className="flex w-full items-center justify-center">
              <div
                style={frame}
                // รูปไม่ต้องมีขอบขาวข้างใน — กรอบมีสัดส่วนเท่ารูปแล้ว ถ้าใส่ padding
                // ขอบขาวจะเหลือไม่เท่ากันสี่ด้าน (padding กินสัดส่วนของกล่องข้างใน)
                className={`flex items-center justify-center overflow-hidden rounded-2xl border-[3px] border-ink bg-white shadow-[4px_4px_0_0_rgba(0,0,0,0.85)] ${
                  isImage ? '' : 'p-2'
                }`}
              >
                {isImage ? (
                  <img
                    src={clue.body}
                    alt={`รูปใบ้ที่ ${i + 1}`}
                    loading="eager"
                    // เต็มกรอบได้เพราะกรอบมีสัดส่วนเท่ารูปแล้ว — object-contain
                    // ยังกันการครอปไว้เหมือนเดิมตอนที่ยังไม่รู้สัดส่วน
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span
                    className="block text-center font-black leading-none text-neutral-900"
                    style={{ fontSize: `${clueTextScale(kind, clue.body)}cqw` }}
                  >
                    {clue.body}
                  </span>
                )}
              </div>
            </div>

            {labels?.[i] ? (
              <figcaption className="mt-1.5 text-center text-base font-extrabold text-ink sm:text-xl">
                {labels[i]}
              </figcaption>
            ) : null}
          </figure>
        )
      })}
    </div>
  )
}
