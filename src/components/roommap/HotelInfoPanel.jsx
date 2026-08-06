import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BottomSheet from '../common/BottomSheet'
import Button from '../common/Button'
import Card from '../common/Card'
import Icon from '../common/Icon'
import TextField from '../common/TextField'
import TextAreaField from '../common/TextAreaField'
import SelectField from '../common/SelectField'
import { FacilityChipGroup, FacilityBadge } from './FacilityFields'
import GuestPreviewSheet from './GuestPreviewSheet'
import {
  ALL_FACILITIES,
  FACILITY_GROUPS,
  ROOM_AMENITIES,
  amenityMeta,
  facilityMeta,
  sortByTaxonomy,
} from '../../lib/hotelFacilities'
import { PHASES, itemByKey, itemPreview, itemStatus, readiness } from '../../lib/hotelChecklist'
import { toTimeInput } from '../../lib/timeFormat'

// ข้อมูลโรงแรมเรียงตาม "ตอนไหนต้องใช้" แทนการเรียงตามประเภทข้อมูล
// แต่ละแถวบอกสถานะทันที: ใส่แล้ว / จำเป็นแต่ยังขาด / ไม่บังคับ
// แตะแถวเปิด editor เฉพาะรายการนั้น ซึ่งมีไม่กี่ช่อง จบเร็ว ไม่ต้องเลื่อนผ่านฟอร์มยาว

function StatusDot({ status }) {
  if (status === 'done') return <Icon name="checkCircle" size={16} className="text-success-text" />
  if (status === 'missing') return <Icon name="alertCircle" size={16} className="text-danger-text" />
  return <Icon name="circleDashed" size={16} className="text-ink-faint" />
}

export default function HotelInfoPanel({
  hotel,
  draft,
  setDraft,
  onStartEdit,
  onSave,
  onCancel,
  editingItem,
  saving,
  saveError,
  dateError,
  suppliers,
  onFillFromSupplier,
}) {
  const { t } = useTranslation()
  const [showGuestPreview, setShowGuestPreview] = useState(false)

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  )

  const ready = useMemo(() => readiness(hotel), [hotel])
  const facilities = sortByTaxonomy(hotel.facilities, ALL_FACILITIES)
  const amenities = sortByTaxonomy(hotel.room_amenities, ROOM_AMENITIES)
  const item = editingItem ? itemByKey(editingItem) : null

  return (
    <div className="mt-3 flex flex-col gap-2">
      {/* แถบความพร้อม — นับเฉพาะรายการจำเป็น ช่องเสริมที่ว่างไม่ทำให้ดูเหมือนงานค้าง */}
      <Card className="p-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-sunken">
            <div
              className={`h-full rounded-pill transition-all ${
                ready.ready ? 'bg-success' : 'bg-brand'
              }`}
              style={{ width: `${ready.total ? (ready.done / ready.total) * 100 : 0}%` }}
            />
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-ink-muted">
            {ready.ready && <Icon name="checkCircle" size={13} className="text-success-text" />}
            {ready.ready
              ? t('staff.roomMap.readyAll')
              : t('staff.roomMap.readyLabel', { done: ready.done, total: ready.total })}
          </span>
        </div>

        {!ready.ready && (
          <p className="mt-2 text-[11px] text-danger-text">
            {ready.missingItems
              .map((key) => t(`staff.roomMap.item${key[0].toUpperCase()}${key.slice(1)}`))
              .join(' · ')}
          </p>
        )}
      </Card>

      {PHASES.map((phase) => {
        const missing = phase.items.filter((i) => itemStatus(hotel, i) === 'missing').length
        return (
          <div key={phase.key}>
            <div className="mb-1 flex items-center gap-2 px-1">
              <span className="text-ink-muted">
                <Icon name={phase.icon} size={14} />
              </span>
              <span className="text-[11px] font-semibold text-ink-muted">
                {t(`staff.roomMap.phase${phase.key[0].toUpperCase()}${phase.key.slice(1)}`)}
              </span>
              <span className="flex-1" />
              {missing > 0 && (
                <span className="text-[10px] font-semibold text-danger-text">
                  {t('staff.roomMap.missingCount', { count: missing })}
                </span>
              )}
            </div>

            <Card className="overflow-hidden p-0">
              {phase.items.map((entry, i) => {
                const status = itemStatus(hotel, entry)
                const preview = itemPreview(hotel, entry, t)
                return (
                  <button
                    key={entry.key}
                    onClick={() => onStartEdit(entry.key)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${
                      i > 0 ? 'border-t border-line-subtle' : ''
                    } ${status === 'missing' ? 'bg-danger-bg' : ''}`}
                  >
                    <span className="shrink-0">
                      <StatusDot status={status} />
                    </span>
                    <span
                      className={`shrink-0 ${
                        status === 'missing' ? 'text-danger-text' : 'text-ink-faint'
                      }`}
                    >
                      <Icon name={entry.icon} size={15} />
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        status === 'missing' ? 'font-medium text-danger-text' : 'text-ink'
                      }`}
                    >
                      {t(`staff.roomMap.item${entry.key[0].toUpperCase()}${entry.key.slice(1)}`)}
                    </span>
                    {status === 'missing' ? (
                      <span className="shrink-0 text-[10px] font-semibold text-danger-text">
                        {t('staff.roomMap.statusRequired')}
                      </span>
                    ) : status === 'optional' ? (
                      <span className="shrink-0 text-[10px] text-ink-faint">
                        {t('staff.roomMap.statusOptional')}
                      </span>
                    ) : (
                      <span className="min-w-0 shrink truncate text-[11px] text-ink-muted">
                        {preview}
                      </span>
                    )}
                    <span className="shrink-0 text-ink-faint">›</span>
                  </button>
                )
              })}
            </Card>
          </div>
        )
      })}

      {(facilities.length > 0 || amenities.length > 0) && (
        <Card className="p-3">
          {facilities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {facilities.map((f) => (
                <FacilityBadge
                  key={f.key}
                  item={f}
                  meta={facilityMeta(f.key)}
                  label={t(`common.facility.${f.key}`)}
                />
              ))}
            </div>
          )}
          {amenities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line-subtle pt-2">
              {amenities.map((a) => (
                <FacilityBadge
                  key={a.key}
                  item={a}
                  meta={amenityMeta(a.key)}
                  label={t(`common.facility.${a.key}`)}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ทีมงานไม่มีทางรู้ว่าข้อมูลออกไปหน้าตายังไงจนกว่าจะเปิดเครื่องลูกค้าดู */}
      <button
        onClick={() => setShowGuestPreview(true)}
        className="flex items-center gap-2 rounded-card bg-surface px-3 py-2.5 text-left ring-1 ring-line-subtle"
      >
        <span className="text-ink-muted">
          <Icon name="eye" size={16} />
        </span>
        <span className="flex-1 text-sm text-ink-muted">{t('staff.roomMap.guestPreview')}</span>
        <span className="text-ink-faint">›</span>
      </button>

      <GuestPreviewSheet
        open={showGuestPreview}
        onClose={() => setShowGuestPreview(false)}
        hotel={hotel}
      />

      {/* editor ของรายการเดียว */}
      <BottomSheet
        open={!!item}
        onClose={onCancel}
        title={item ? t(`staff.roomMap.item${item.key[0].toUpperCase()}${item.key.slice(1)}`) : ''}
      >
        {item && (
          <div className="flex flex-col gap-2">
            {item.key === 'dates' && (
              <>
                <div className="flex gap-2">
                  <TextField
                    label={t('staff.roomMap.checkInDate')}
                    type="date"
                    value={draft.check_in_date}
                    onChange={(e) => setDraft((p) => ({ ...p, check_in_date: e.target.value }))}
                    className="flex-1"
                  />
                  <TextField
                    label={t('staff.roomMap.checkOutDate')}
                    type="date"
                    value={draft.check_out_date}
                    onChange={(e) => setDraft((p) => ({ ...p, check_out_date: e.target.value }))}
                    className="flex-1"
                  />
                </div>
                {dateError && <p className="text-sm text-danger">{dateError}</p>}
              </>
            )}

            {item.key === 'booking' && (
              <>
                <TextField
                  label={t('staff.roomMap.bookingRef')}
                  value={draft.booking_ref}
                  onChange={(e) => setDraft((p) => ({ ...p, booking_ref: e.target.value }))}
                />
                <SelectField
                  label={t('staff.roomMap.supplier')}
                  options={supplierOptions}
                  value={draft.supplier_id}
                  onChange={(e) => setDraft((p) => ({ ...p, supplier_id: e.target.value }))}
                />
                {draft.supplier_id && (
                  <button
                    type="button"
                    onClick={onFillFromSupplier}
                    className="self-start text-xs font-semibold text-brand"
                  >
                    ↩ {t('staff.roomMap.supplierFill')}
                  </button>
                )}
              </>
            )}

            {item.key === 'address' && (
              <>
                <TextAreaField
                  label={t('staff.roomMap.address')}
                  rows={2}
                  value={draft.address}
                  onChange={(e) => setDraft((p) => ({ ...p, address: e.target.value }))}
                />
                <TextAreaField
                  label={t('staff.roomMap.addressLocal')}
                  rows={2}
                  value={draft.address_local}
                  onChange={(e) => setDraft((p) => ({ ...p, address_local: e.target.value }))}
                  placeholder={t('staff.roomMap.addressLocalHint')}
                />
                <TextField
                  label={t('staff.roomMap.mapUrl')}
                  type="url"
                  placeholder="https://maps.app.goo.gl/..."
                  value={draft.map_url}
                  onChange={(e) => setDraft((p) => ({ ...p, map_url: e.target.value }))}
                />
              </>
            )}

            {item.key === 'phone' && (
              <TextField
                label={t('staff.roomMap.phone')}
                type="tel"
                value={draft.phone}
                onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))}
              />
            )}

            {item.key === 'checkInTime' && (
              <TextField
                label={t('staff.roomMap.checkInTime')}
                type="time"
                value={draft.check_in_time}
                onChange={(e) => setDraft((p) => ({ ...p, check_in_time: e.target.value }))}
              />
            )}

            {item.key === 'meetingPoint' && (
              <TextField
                label={t('staff.roomMap.meetingPoint')}
                value={draft.meeting_point}
                onChange={(e) => setDraft((p) => ({ ...p, meeting_point: e.target.value }))}
              />
            )}

            {item.key === 'wifi' && (
              <>
                <TextField
                  label={t('staff.roomMap.wifiName')}
                  value={draft.wifi_name}
                  onChange={(e) => setDraft((p) => ({ ...p, wifi_name: e.target.value }))}
                />
                <TextField
                  label={t('staff.roomMap.wifiPassword')}
                  value={draft.wifi_password}
                  onChange={(e) => setDraft((p) => ({ ...p, wifi_password: e.target.value }))}
                />
              </>
            )}

            {item.key === 'breakfast' && (
              <>
                <TextField
                  label={t('staff.roomMap.breakfastTime')}
                  type="time"
                  value={draft.breakfast_time}
                  onChange={(e) => setDraft((p) => ({ ...p, breakfast_time: e.target.value }))}
                />
                <TextField
                  label={t('staff.roomMap.breakfastLocation')}
                  value={draft.breakfast_location}
                  onChange={(e) => setDraft((p) => ({ ...p, breakfast_location: e.target.value }))}
                />
              </>
            )}

            {item.key === 'dinner' && (
              <>
                <TextField
                  label={t('staff.roomMap.dinnerTime')}
                  type="time"
                  value={draft.dinner_time}
                  onChange={(e) => setDraft((p) => ({ ...p, dinner_time: e.target.value }))}
                />
                <TextField
                  label={t('staff.roomMap.dinnerLocation')}
                  value={draft.dinner_location}
                  onChange={(e) => setDraft((p) => ({ ...p, dinner_location: e.target.value }))}
                />
              </>
            )}

            {item.key === 'facilities' && (
              <div className="max-h-[55vh] overflow-y-auto">
                <div className="flex flex-col gap-2">
                  {FACILITY_GROUPS.map((group) => (
                    <FacilityChipGroup
                      key={group.key}
                      title={t(
                        `common.facility.group${group.key[0].toUpperCase()}${group.key.slice(1)}`
                      )}
                      items={group.items}
                      value={draft.facilities}
                      defaultOpen={group.defaultOpen}
                      onChange={(next) => setDraft((p) => ({ ...p, facilities: next }))}
                    />
                  ))}
                  <FacilityChipGroup
                    title={t('common.facility.roomAmenities')}
                    items={ROOM_AMENITIES}
                    value={draft.room_amenities}
                    defaultOpen
                    onChange={(next) => setDraft((p) => ({ ...p, room_amenities: next }))}
                  />
                  <TextField
                    label={t('common.facility.powerPlug')}
                    placeholder={t('common.facility.powerPlugPlaceholder')}
                    value={draft.power_plug}
                    onChange={(e) => setDraft((p) => ({ ...p, power_plug: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {item.key === 'guestNote' && (
              <TextAreaField
                label={`${t('staff.roomMap.additionalNotes')} · ${t('staff.roomMap.guestVisible')}`}
                rows={5}
                value={draft.general_info}
                onChange={(e) => setDraft((p) => ({ ...p, general_info: e.target.value }))}
                placeholder={t('staff.roomMap.generalInfoPlaceholder')}
              />
            )}

            {item.key === 'checkoutTime' && (
              <TextField
                label={t('staff.roomMap.checkoutTime')}
                type="time"
                value={draft.checkout_time}
                onChange={(e) => setDraft((p) => ({ ...p, checkout_time: e.target.value }))}
              />
            )}

            {item.key === 'wakeUp' && (
              <div className="flex gap-2">
                <TextField
                  label={t('staff.roomMap.morningCall')}
                  type="time"
                  value={draft.morning_call}
                  onChange={(e) => setDraft((p) => ({ ...p, morning_call: e.target.value }))}
                  className="flex-1"
                />
                <TextField
                  label={t('staff.roomMap.luggageTime')}
                  type="time"
                  value={draft.luggage_time}
                  onChange={(e) => setDraft((p) => ({ ...p, luggage_time: e.target.value }))}
                  className="flex-1"
                />
              </div>
            )}

            {item.key === 'staffNotes' && (
              <TextAreaField
                label={t('staff.roomMap.staffNotes')}
                rows={5}
                value={draft.staff_notes}
                onChange={(e) => setDraft((p) => ({ ...p, staff_notes: e.target.value }))}
                placeholder={t('staff.roomMap.staffNotesHint')}
              />
            )}

            {saveError && <p className="text-sm text-danger">{saveError}</p>}
            <div className="mt-1 flex gap-2">
              <Button onClick={onSave} disabled={saving || !!dateError}>
                {t('common.save')}
              </Button>
              <Button variant="secondary" onClick={onCancel} disabled={saving}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

/** แถบสรุปเวลาสำคัญ ใช้โชว์ในโหมดจัดห้องแบบไม่กินที่ */
export function HotelQuickBar({ hotel }) {
  const items = [
    hotel.check_in_time && { icon: 'key', value: toTimeInput(hotel.check_in_time) },
    hotel.checkout_time && { icon: 'door', value: toTimeInput(hotel.checkout_time) },
    hotel.morning_call && { icon: 'alarm', value: toTimeInput(hotel.morning_call) },
    hotel.luggage_time && { icon: 'luggage', value: toTimeInput(hotel.luggage_time) },
    hotel.breakfast_time && { icon: 'coffee', value: toTimeInput(hotel.breakfast_time) },
    hotel.wifi_password && { icon: 'wifi', value: hotel.wifi_password },
  ].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-ink-muted">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <Icon name={item.icon} size={13} />
          {item.value}
        </span>
      ))}
    </div>
  )
}
