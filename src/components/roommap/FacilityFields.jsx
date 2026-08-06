import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  normalizeList,
  patchItem,
  toggleItem,
} from '../../lib/hotelFacilities'
import { formatTimeRange } from '../../lib/timeFormat'
import Icon from '../common/Icon'

// ชิ้นส่วนฟอร์ม/แสดงผลที่ใช้ร่วมกันระหว่างหน้าแก้ข้อมูลโรงแรมกับการ์ดสรุป
// แยกออกมาจาก RoomMap.jsx เพราะไฟล์นั้นโตเกิน 1,600 บรรทัดจนหาอะไรไม่เจอ

/** กล่องหัวข้อย่อยในฟอร์ม */
export function FormSection({ icon, title, badge, children }) {
  return (
    <div className="rounded-xl bg-surface-muted p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {icon && <Icon name={icon} size={14} />}
          {title}
        </p>
        {badge}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

export function StaffOnlyBadge({ label }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-text">
      <Icon name="lock" size={11} />
      {label}
    </span>
  )
}

/** ช่องข้อมูลเล็กๆ ในการ์ดสรุป — แสดง — เมื่อยังไม่มีข้อมูล */
export function InfoTile({ icon, label, children }) {
  return (
    <div className="rounded-control bg-surface-muted p-2.5 text-center">
      <span className="flex justify-center text-ink-muted">
        <Icon name={icon} size={18} />
      </span>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <div className="mt-0.5">{children || <p className="text-[11px] text-ink-faint">—</p>}</div>
    </div>
  )
}

/** แถวรายละเอียดของ facility ที่ถูกเลือกแล้ว — ฟรี/เสียเงิน + เวลาเปิด-ปิด + หมายเหตุ */
function FacilityDetailRow({ item, meta, label, onPatch }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-control bg-surface/70 px-2 py-1.5">
      <span className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-ink sm:w-auto sm:flex-1">
        {meta?.icon && <Icon name={meta.icon} size={14} />}
        {label}
      </span>
      <select
        value={item.fee ?? ''}
        onChange={(e) => onPatch({ fee: e.target.value })}
        className="rounded-control border border-line bg-surface px-1.5 py-1 text-[11px] text-ink-muted focus:outline-none"
      >
        <option value="">{t('common.facility.feeUnset')}</option>
        <option value="free">{t('common.facility.feeFree')}</option>
        <option value="paid">{t('common.facility.feePaid')}</option>
      </select>
      {meta?.hasHours && (
        <span className="inline-flex items-center gap-1">
          <input
            type="time"
            value={item.from ?? ''}
            onChange={(e) => onPatch({ from: e.target.value })}
            aria-label={t('common.facility.hoursFrom')}
            className="rounded-control border border-line bg-surface px-1.5 py-1 text-[11px] text-ink focus:outline-none"
          />
          <span className="text-[11px] text-ink-faint">–</span>
          <input
            type="time"
            value={item.to ?? ''}
            onChange={(e) => onPatch({ to: e.target.value })}
            aria-label={t('common.facility.hoursTo')}
            className="rounded-control border border-line bg-surface px-1.5 py-1 text-[11px] text-ink focus:outline-none"
          />
        </span>
      )}
      <input
        type="text"
        value={item.note ?? ''}
        onChange={(e) => onPatch({ note: e.target.value })}
        placeholder={t('common.facility.note')}
        className="min-w-[5rem] flex-1 rounded-control border border-line bg-surface px-1.5 py-1 text-[11px] text-ink focus:outline-none"
      />
    </div>
  )
}

/** ชิปกดเลือก facility หนึ่งชุด */
export function FacilityChipGroup({ title, items, value, onChange, defaultOpen = false }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const selected = normalizeList(value)
  const selectedKeys = new Set(selected.map((s) => s.key))
  const countInGroup = items.filter((i) => selectedKeys.has(i.key)).length

  return (
    <div className="rounded-control bg-surface/60 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {title}
          {countInGroup > 0 && <span className="ml-1.5 text-brand">· {countInGroup}</span>}
        </span>
        <span className="text-xs text-ink-faint">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {items.map((item) => {
              const isOn = selectedKeys.has(item.key)
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onChange(toggleItem(value, item.key))}
                  className={`rounded-pill px-2.5 py-1 text-[11px] font-medium transition ${
                    isOn ? 'bg-brand text-white' : 'bg-surface text-ink-muted ring-1 ring-line'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name={item.icon} size={13} />
                    {t(`common.facility.${item.key}`)}
                  </span>
                </button>
              )
            })}
          </div>

          {countInGroup > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {items
                .filter((i) => selectedKeys.has(i.key))
                .map((meta) => (
                  <FacilityDetailRow
                    key={meta.key}
                    item={selected.find((s) => s.key === meta.key)}
                    meta={meta}
                    label={t(`common.facility.${meta.key}`)}
                    onPatch={(patch) => onChange(patchItem(value, meta.key, patch))}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** ชิปแสดงผล (โหมดอ่าน) */
export function FacilityBadge({ item, meta, label }) {
  const { t } = useTranslation()
  const range = formatTimeRange(item.from, item.to)
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2 py-1 text-[11px] text-ink ring-1 ring-line-subtle">
      {meta?.icon && <Icon name={meta.icon} size={13} />}
      <span className="font-medium">{label}</span>
      {item.fee === 'free' && (
        <span className="rounded-pill bg-success-bg px-1.5 text-[10px] font-semibold text-success-text">
          {t('common.facility.feeFree')}
        </span>
      )}
      {item.fee === 'paid' && (
        <span className="rounded-pill bg-warning-bg px-1.5 text-[10px] font-semibold text-warning-text">
          {t('common.facility.feePaid')}
        </span>
      )}
      {range && <span className="text-ink-muted">{range}</span>}
      {item.note && <span className="text-ink-faint">· {item.note}</span>}
    </span>
  )
}
