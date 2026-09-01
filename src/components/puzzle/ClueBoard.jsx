import { useEffect, useMemo, useState } from 'react'

import { clueGrid, clueTextScale } from '../../lib/puzzleLayout'

// กระดานรูปใบ้ — ใช้ตัวเดียวกันทั้งจอเวที มือถือลูกทัวร์ มือถือทีมงาน และพรีวิวใน Builder
//
// ทำไมต้องเป็น component เดียว ไม่ใช่ก็อปสี่ที่: พรีวิวใน Builder ที่ไม่ตรงกับของจริง
// แย่กว่าไม่มีพรีวิว เพราะคนสร้างข้อจะเชื่อมันแล้วไปเจอของจริงบนเวทีต่อหน้าคน 40 คน
//
// สองกติกาที่ห้ามแหก (ดูข้อ 4.4 / 4.7 ของ MyTour_WordPuzzle_Design_v1.md):
//   • object-contain ไม่ใช่ object-cover — ครอปกลางภาพจะตัดเชือกออกจากรูปชักเย่อ
//     แล้วข้อนั้นก็ตอบไม่ได้อีกเลย
//   • ทุกช่องสูงเท่ากัน — ความสูงเท่ากันคือสิ่งที่ทำให้แถวดูเป็นระเบียบ ไม่ใช่ความกว้าง

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

  const height =
    cellHeight ??
    (surface === 'stage'
      ? grid.rows > 1
        ? 'min(26vh, 260px)'
        : 'min(46vh, 460px)'
      : grid.rows > 1
        ? 'min(18vh, 150px)'
        : 'min(28vh, 220px)')

  // แถวสุดท้ายที่ไม่เต็มต้องอยู่กึ่งกลาง (เช่น 5 รูป = 3 บน / 2 ล่าง)
  // ถ้าปล่อยชิดซ้ายจะดูเหมือนจอเรนเดอร์ไม่เสร็จ ไม่ใช่ดีไซน์
  const offset = grid.centerLastRow ? (grid.columns - grid.lastRowCount) : 0
  const firstOfLastRow = grid.columns * (grid.rows - 1)

  return (
    <div
      className={`grid w-full justify-center gap-3 sm:gap-4 ${className}`}
      style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}
    >
      {list.map((clue, i) => {
        // reveal_payload ส่งมาเป็น {kind, body} ส่วนตารางใช้ clue_kind
        // รับทั้งสองแบบตรงนี้ที่เดียว ดีกว่าให้ผู้เรียกสี่ที่แปลงเองแล้วลืมไปสามที่
        const kind = clue.clue_kind ?? clue.kind ?? 'image'
        // containerType ต้องอยู่ที่ช่อง เพราะขนาดอีโมจิ/คำคิดเป็น cqw (เทียบความกว้างช่อง)
        // ช่องของข้อที่มีรูปเดียวกับข้อที่มี 6 รูป ต่างกันราวสามเท่า
        const style = { height, containerType: 'inline-size' }
        if (offset && i === firstOfLastRow) style.gridColumnStart = offset + 1

        return (
          <figure key={clue.id ?? i} className="m-0 flex min-w-0 flex-col items-center">
            <div
              style={style}
              className="flex w-full items-center justify-center overflow-hidden rounded-2xl border-[3px] border-ink bg-white p-2 shadow-[4px_4px_0_0_rgba(0,0,0,0.85)]"
            >
              {kind === 'image' ? (
                <img
                  src={clue.body}
                  alt={`รูปใบ้ที่ ${i + 1}`}
                  loading="eager"
                  className="max-h-full max-w-full object-contain"
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

            {labels?.[i] ? (
              <figcaption className="mt-2 text-center text-lg font-extrabold text-ink sm:text-2xl">
                {labels[i]}
              </figcaption>
            ) : null}
          </figure>
        )
      })}
    </div>
  )
}
