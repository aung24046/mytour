import { useEffect, useMemo, useState } from 'react'

import {
  THEME_PRESETS,
  PRESET_KEYS,
  DEFAULT_PRESET,
  resolveTheme,
  hexToRgb,
  rgbToHex,
} from '../../lib/themes'
import { useMode } from '../../lib/colorMode'
import Icon from './Icon'

// การ์ดตั้งค่าธีมสีของบริษัท — อยู่ในหน้าข้อมูลบริษัท (owner เท่านั้น)
//
// หลักการ: ต้อง "เห็นผลก่อนบันทึก" เพราะคนกดคือเจ้าของบริษัท ไม่ใช่ดีไซเนอร์
// และผลกระทบตกกับลูกทัวร์ทุกคนที่กำลังเดินทางอยู่
//
// ตัวอย่างในการ์ดนี้ฉีดตัวแปรลงตัวเอง (scope แค่ในกล่อง) ไม่ใช่ทั้งหน้า
// เพื่อให้เทียบกับ UI รอบข้างที่ยังเป็นสีเดิมได้ และกดยกเลิกแล้วไม่มีอะไรค้าง

function PreviewPhone({ tokens }) {
  // ฉีดตัวแปรเฉพาะกล่องนี้ — React รับ CSS custom property ใน style ได้ตรงๆ
  const style = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [`--${k}`, v]))

  return (
    <div
      style={style}
      className="overflow-hidden rounded-card border border-line-strong bg-surface-sunken"
    >
      <div className="bg-brand-gradient px-3 pb-3 pt-2.5">
        <p className="text-[13px] font-bold text-white">เชียงใหม่ 3 วัน 2 คืน</p>
        <p className="text-[10px] text-white/75">สวัสดี คุณอั๋น · กลุ่ม 2</p>
      </div>

      <div className="flex gap-1.5 border-b border-line bg-surface px-3 py-2">
        <span className="flex-1 rounded-control bg-brand py-1 text-center text-[11px] font-semibold text-white">
          วันที่ 1
        </span>
        <span className="flex-1 rounded-control py-1 text-center text-[11px] font-semibold text-ink-muted">
          วันที่ 2
        </span>
        <span className="flex-1 rounded-control py-1 text-center text-[11px] font-semibold text-ink-muted">
          วันที่ 3
        </span>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="rounded-control border border-accent/30 border-l-4 border-l-accent bg-accent-bg p-2.5">
          <p className="text-[10px] font-bold text-accent-text">06:30 · ตอนนี้</p>
          <p className="text-[12px] font-semibold text-ink">เช็คอินสนามบิน</p>
          <p className="text-[10px] text-ink-muted">เคาน์เตอร์ D ชั้น 4</p>
        </div>

        <div className="rounded-control border border-line bg-surface p-2.5">
          <p className="text-[10px] text-ink-faint">09:15</p>
          <p className="text-[12px] font-semibold text-ink">ถึงเชียงใหม่</p>
        </div>

        <div className="flex gap-1.5">
          <span className="flex-1 rounded-control bg-brand-lighter py-1.5 text-center text-[11px] font-semibold text-brand-hover">
            คู่มือ
          </span>
          <span className="flex-1 rounded-control bg-brand py-1.5 text-center text-[11px] font-semibold text-white">
            นำทาง
          </span>
        </div>
      </div>

      <div className="flex items-end justify-around border-t border-line bg-surface px-2 pb-2 pt-1.5">
        <span className="text-ink-faint">
          <Icon name="home" size={17} />
        </span>
        <span className="text-brand-hover">
          <Icon name="map" size={17} filled />
        </span>
        <span className="-mt-4 flex h-9 w-9 items-center justify-center rounded-[12px] bg-brand-gradient text-white shadow-brand ring-4 ring-surface">
          <Icon name="ticket" size={19} />
        </span>
        <span className="text-ink-faint">
          <Icon name="bed" size={17} />
        </span>
        <span className="text-ink-faint">
          <Icon name="seat" size={17} />
        </span>
      </div>
    </div>
  )
}

export default function ThemeSettings({ value, onChange, disabled = false }) {
  // ⚠️ ต้องส่งโหมดปัจจุบันเข้า resolveTheme เสมอ ไม่งั้นตอน owner เปิดโหมดมืด
  //    ตัวอย่างจะเอาเฉดของโหมดสว่างมาวางบนพื้นเข้ม (ชิปสว่างจ้าบนการ์ดดำ)
  const mode = useMode()
  const preset = PRESET_KEYS.includes(value?.theme_preset) ? value.theme_preset : DEFAULT_PRESET
  const brandColor = value?.theme_brand_color || ''

  // ช่องสีต้องมีค่าเสมอ (input[type=color] ว่างไม่ได้) แต่ค่าที่บันทึกเป็น null ได้
  const effectiveHex = brandColor || THEME_PRESETS[preset].brandColor
  const [draftHex, setDraftHex] = useState(effectiveHex)

  useEffect(() => {
    setDraftHex(effectiveHex)
  }, [effectiveHex])

  const resolved = useMemo(
    () => resolveTheme({ theme_preset: preset, theme_brand_color: brandColor || null }, mode),
    [preset, brandColor, mode]
  )

  // สีที่ระบบใช้จริงหลัง guard — อาจไม่ตรงกับที่ผู้ใช้เลือกถ้าโดนขยับ
  const appliedHex = useMemo(() => {
    const t = resolved.tokens['c-brand']
    return t ? rgbToHex(t.split(' ').map(Number)) : effectiveHex
  }, [resolved, effectiveHex])

  const wasAdjusted = resolved.notes.length > 0
  const isCustom = !!brandColor

  function pick(key) {
    if (disabled) return
    // เปลี่ยนพรีเซ็ตแล้วล้างสีที่ override ไว้ ไม่งั้นผู้ใช้จะงงว่าทำไมกดแล้วสีไม่เปลี่ยน
    onChange({ theme_preset: key, theme_brand_color: null })
  }

  function commitColor(hex) {
    if (disabled) return
    if (!hexToRgb(hex)) return
    onChange({ theme_preset: preset, theme_brand_color: hex })
  }

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_230px]">
      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">ชุดสี</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESET_KEYS.map((key) => {
            const p = THEME_PRESETS[key]
            const active = key === preset
            return (
              <button
                key={key}
                type="button"
                onClick={() => pick(key)}
                disabled={disabled}
                aria-pressed={active}
                className={`rounded-control border p-2.5 text-left transition disabled:opacity-50 ${
                  active
                    ? 'border-brand bg-brand-lighter ring-1 ring-brand'
                    : 'border-line bg-surface hover:border-line-strong'
                }`}
              >
                <div className="mb-1.5 flex gap-1">
                  {p.swatch.map((c) => (
                    <span
                      key={c}
                      className="h-5 flex-1 rounded"
                      style={{ background: c }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <p className="text-[13px] font-semibold text-ink">{p.name}</p>
                <p className="text-[11px] text-ink-muted">{p.hint}</p>
              </button>
            )
          })}
        </div>

        <p className="mb-1.5 mt-4 text-sm font-semibold text-ink">สีแบรนด์ของบริษัท</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            value={draftHex}
            disabled={disabled}
            onChange={(e) => setDraftHex(e.target.value)}
            onBlur={(e) => commitColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-control border border-line-strong bg-surface p-1 disabled:opacity-50"
            aria-label="เลือกสีแบรนด์"
          />
          <input
            type="text"
            value={draftHex}
            disabled={disabled}
            onChange={(e) => setDraftHex(e.target.value)}
            onBlur={(e) => commitColor(e.target.value)}
            placeholder="#0891b2"
            className="w-28 rounded-control border border-line-strong bg-surface px-2.5 py-2 font-mono text-sm text-ink disabled:opacity-50"
            aria-label="รหัสสีแบรนด์"
          />
          {isCustom && (
            <button
              type="button"
              onClick={() => onChange({ theme_preset: preset, theme_brand_color: null })}
              disabled={disabled}
              className="rounded-control bg-surface-sunken px-3 py-2 text-[13px] font-semibold text-ink-muted disabled:opacity-50"
            >
              กลับไปใช้สีของชุดสี
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">
          ระบบสร้างเฉดที่เหลือ (ปุ่ม hover, พื้นอ่อน, หัวแถบ) จากสีนี้ให้เอง
        </p>

        {wasAdjusted && (
          <div className="mt-3 rounded-control border border-warning/30 bg-warning-bg px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-warning-text">
              <Icon name="alert" size={15} className="text-warning-text" />
              ปรับสีให้เข้มขึ้นอัตโนมัติ
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-warning-text">
              {resolved.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-1.5 flex items-center gap-2 text-xs text-warning-text">
              สีที่ใช้จริง
              <span className="inline-flex items-center gap-1 font-mono">
                <span
                  className="inline-block h-3 w-3 rounded-sm ring-1 ring-line"
                  style={{ background: appliedHex }}
                  aria-hidden="true"
                />
                {appliedHex}
              </span>
            </p>
          </div>
        )}

        {/* ⚠️ ห้าม hardcode คำว่า "ผ่าน AA" — ถ้าวันหนึ่ง guard มีบั๊ก
            ป้ายนี้จะโกหกผู้ใช้ทั้งที่สีอ่านไม่ออกจริง จึงคำนวณจากตัวเลขที่ได้ */}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {[
            ['ตัวหนังสือขาวบนปุ่มหลัก', resolved.ratios.whiteOnBrand],
            ['ตัวหนังสือบนปุ่มรอง', resolved.ratios.hoverOnLighter],
          ].map(([label, ratio]) => (
            <div key={label} className="rounded-control bg-surface-sunken px-2.5 py-2">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="font-semibold text-ink">
                {ratio.toFixed(2)}:1{' '}
                <span
                  className={`font-normal ${ratio >= 4.5 ? 'text-success-text' : 'text-danger-text'}`}
                >
                  {ratio >= 4.5 ? 'ผ่าน AA' : 'ไม่ผ่าน AA'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">ตัวอย่างหน้าลูกทัวร์</p>
        <PreviewPhone tokens={resolved.tokens} />
        <p className="mt-2 text-xs text-ink-muted">
          ป้าย &ldquo;ตอนนี้&rdquo; ใช้สีที่สามของชุดสี ส่วนสีเขียว (เสร็จแล้ว)
          และสีแดง (ขอความช่วยเหลือ) ไม่เปลี่ยนตามธีม เพราะเป็นสีที่สื่อความหมาย
        </p>
      </div>
    </div>
  )
}
