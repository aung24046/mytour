import { useMemo, useState } from 'react'

import { supabase } from '../../lib/supabase'
import { useActiveOrgId } from '../../lib/staffSession'
import { COLUMN_LABELS, SENSITIVE_KEYS } from '../../lib/documentData'
import { decideOrientation, exceedsLandscape, OVERFLOW } from '../../lib/printProfiles'
import Card from '../../components/common/Card'

// เลือกคอลัมน์ของเอกสาร + บันทึกเป็นชุดไว้ใช้ซ้ำ (DataSpec §9)
//
// สองกลไกทำงานคู่กัน:
//   1. ซ่อนอัตโนมัติ — คอลัมน์ที่ไม่มีใครกรอกเลย (0/26) จะจางและไม่ติ๊กให้
//      แต่ยังแสดงพร้อมตัวนับ เพื่อให้เห็นว่าทำไมมันหาย ไม่ใช่หายเงียบ
//   2. Preset — เก็บชุดคอลัมน์ไว้ใช้ซ้ำ ไม่ต้องติ๊กใหม่ทุกทริป
//
// แนวกระดาษไม่ให้ผู้ใช้เลือก — คำนวณจากความกว้างรวมแล้วบอกเหตุผล (§9.3)
export default function ColumnPicker({
  docType,
  available,
  selected,
  onChange,
  presets,
  onPresetsChange,
  fillCounts,
  canSavePreset = false,
}) {
  const orgId = useActiveOrgId()
  const [savingName, setSavingName] = useState(null)
  const [saveError, setSaveError] = useState(null)

  const selectedKeys = useMemo(() => new Set(selected.map((c) => c.key)), [selected])

  const orientation = useMemo(() => decideOrientation(selected), [selected])
  const tooWide = useMemo(() => exceedsLandscape(selected), [selected])

  function toggle(col) {
    if (col.locked) return
    if (selectedKeys.has(col.key)) {
      // ถอดคอลัมน์ที่ถูกใช้เป็นคู่ซ้อนอยู่ → ต้องปลด stackWith ของอีกฝั่งด้วย
      onChange(
        selected
          .filter((c) => c.key !== col.key)
          .map((c) =>
            c.stackWith === col.key ? { ...c, stackWith: undefined, overflow: OVERFLOW.NOWRAP } : c
          )
      )
    } else {
      onChange([...selected, { ...col, sensitive: SENSITIVE_KEYS.has(col.key) }])
    }
  }

  function applyPreset(preset) {
    onChange(
      (preset.columns ?? []).map((c) => ({
        ...c,
        label: COLUMN_LABELS[c.key] ?? c.key,
        sensitive: c.sensitive ?? SENSITIVE_KEYS.has(c.key),
      }))
    )
  }

  async function savePreset() {
    const name = window.prompt('ตั้งชื่อชุดคอลัมน์นี้', 'ชุดของฉัน')
    if (!name?.trim()) return

    setSavingName(name)
    setSaveError(null)

    // เก็บเฉพาะ key + นโยบาย — label มาจาก COLUMN_LABELS ตอนอ่านกลับ
    const columns = selected.map((c) => ({
      key: c.key,
      overflow: c.overflow ?? OVERFLOW.NOWRAP,
      ...(c.stackWith ? { stackWith: c.stackWith } : {}),
      ...(c.lines ? { lines: c.lines } : {}),
      ...(c.sensitive ? { sensitive: true } : {}),
    }))

    const { data, error } = await supabase
      .from('document_presets')
      .upsert(
        { org_id: orgId, doc_type: docType, name: name.trim(), columns, is_default: false },
        { onConflict: 'org_id,doc_type,name' }
      )
      .select('id, name, columns, is_default')
      .single()

    setSavingName(null)

    if (error) {
      console.error('[ColumnPicker] save preset failed', error)
      setSaveError('บันทึกชุดคอลัมน์ไม่สำเร็จ')
      return
    }

    onPresetsChange?.([...presets.filter((p) => p.id !== data.id), data])
  }

  const sensitiveSelected = selected.filter((c) => SENSITIVE_KEYS.has(c.key))

  return (
    <Card>
      <p className="mb-1.5 text-xs font-semibold text-ink-faint">ชุดคอลัมน์</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p)}
            className="rounded-control bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand-lighter"
          >
            {p.name}
            {p.is_default && <span className="ml-1 text-xs text-ink-faint">(ตั้งต้น)</span>}
          </button>
        ))}
        {canSavePreset && (
          <button
            onClick={savePreset}
            disabled={Boolean(savingName)}
            className="rounded-control border border-dashed border-brand-light px-3 py-1.5 text-sm font-medium text-brand"
          >
            {savingName ? 'กำลังบันทึก…' : '+ บันทึกชุดนี้'}
          </button>
        )}
      </div>

      {saveError && <p className="mb-2 text-sm text-danger">{saveError}</p>}

      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-ink-muted">
          เลือก {selected.length} จาก {available.length} คอลัมน์
        </span>
      </div>

      <div className="mb-3 divide-y divide-black/5">
        {available.map((col) => {
          const isOn = selectedKeys.has(col.key)
          const count = fillCounts?.[col.key]
          const empty = count === 0
          return (
            <label
              key={col.key}
              className={`flex items-center gap-3 py-2 ${empty && !isOn ? 'opacity-55' : ''}`}
            >
              <input
                type="checkbox"
                checked={isOn}
                disabled={col.locked}
                onChange={() => toggle(col)}
                className="h-4 w-4 accent-brand"
              />
              <span className="flex-1 text-sm text-ink">
                {COLUMN_LABELS[col.key] ?? col.key}
              </span>

              {SENSITIVE_KEYS.has(col.key) && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  ข้อมูลอ่อนไหว
                </span>
              )}
              {col.locked ? (
                <span className="text-[11px] text-ink-faint">ล็อกไว้</span>
              ) : count != null ? (
                <span className="text-[11px] text-ink-faint">
                  {empty ? 'ไม่มีข้อมูล' : 'กรอกแล้ว'} · {count}/{fillCounts.__total ?? '—'}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>

      {/* แนวกระดาษคำนวณเอง — บอกเหตุผลด้วยเพื่อไม่ให้รู้สึกว่าระบบเปลี่ยนมั่ว */}
      {tooWide ? (
        <p className="rounded-control bg-red-50 px-3 py-2 text-sm text-red-800">
          คอลัมน์ที่เลือกกว้างเกิน A4 แนวนอน — ต้องถอดออกบางคอลัมน์ ไม่งั้นตารางจะล้นขอบกระดาษ
        </p>
      ) : orientation.switched ? (
        <p className="rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {orientation.reason} — ระบบสลับเป็น {orientation.paper.label} ให้แล้ว
        </p>
      ) : (
        <p className="rounded-control bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          คอลัมน์ที่เลือกพอดี {orientation.paper.label}
        </p>
      )}

      {sensitiveSelected.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          เอกสารนี้มีข้อมูลอ่อนไหว {sensitiveSelected.map((c) => COLUMN_LABELS[c.key]).join(' · ')} —
          ตรวจก่อนส่งออกนอกองค์กร
        </p>
      )}
    </Card>
  )
}
