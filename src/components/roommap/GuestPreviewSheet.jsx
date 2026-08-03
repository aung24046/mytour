import { useTranslation } from 'react-i18next'

import BottomSheet from '../common/BottomSheet'
import Icon from '../common/Icon'
import { FacilityBadge } from './FacilityFields'
import {
  ALL_FACILITIES,
  ROOM_AMENITIES,
  amenityMeta,
  facilityMeta,
  sortByTaxonomy,
} from '../../lib/hotelFacilities'
import { pickGuestVisible } from '../../lib/hotelVisibility'
import { toTimeInput } from '../../lib/timeFormat'

// พรีวิวสิ่งที่ลูกทัวร์เห็นจริงบนหน้า MyRoom
//
// ข้อมูลถูกกรองผ่าน pickGuestVisible() ก่อนเสมอ ไม่ได้อ่านจาก hotel ตรงๆ
// เพื่อให้พรีวิวนี้ "เป็นไปไม่ได้" ที่จะแสดงข้อมูลภายใน แม้จะเผลอเขียนโค้ดอ้างถึงก็ตาม

function Row({ icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-2.5 border-b border-black/[0.06] py-2 last:border-0">
      <span className="shrink-0 text-ink-faint">
        <Icon name={icon} size={16} />
      </span>
      <span className="flex-1 text-sm text-ink-muted">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium text-ink">{value}</span>
    </div>
  )
}

export default function GuestPreviewSheet({ open, onClose, hotel }) {
  const { t } = useTranslation()
  const view = pickGuestVisible(hotel)

  if (!view) return null

  const facilities = sortByTaxonomy(view.facilities, ALL_FACILITIES)
  const amenities = sortByTaxonomy(view.room_amenities, ROOM_AMENITIES)

  const hasAnything =
    view.address ||
    view.phone ||
    view.map_url ||
    view.wifi_name ||
    view.wifi_password ||
    view.breakfast_time ||
    view.dinner_time ||
    view.check_in_time ||
    view.checkout_time ||
    view.morning_call ||
    view.luggage_time ||
    view.meeting_point ||
    view.general_info ||
    view.power_plug ||
    facilities.length > 0 ||
    amenities.length > 0

  return (
    <BottomSheet open={open} onClose={onClose} title={t('staff.roomMap.guestPreviewTitle')}>
      <div className="max-h-[65vh] overflow-y-auto">
        <p className="mb-2 flex items-center gap-1.5 rounded-control bg-success-bg px-2.5 py-1.5 text-[11px] text-success-text">
          <Icon name="lock" size={13} />
          {t('staff.roomMap.guestPreviewHint')}
        </p>

        {!hasAnything ? (
          <p className="py-6 text-center text-sm text-ink-faint">
            {t('staff.roomMap.guestPreviewEmpty')}
          </p>
        ) : (
          <div className="rounded-card bg-surface-muted p-3">
            <p className="font-bold text-ink">{view.name}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {view.check_in_date || '—'} → {view.check_out_date || '—'}
            </p>

            {(view.address || view.address_local || view.phone || view.map_url) && (
              <div className="mt-2 rounded-control bg-surface p-2.5">
                {view.address && (
                  <p className="whitespace-pre-wrap text-sm text-ink">{view.address}</p>
                )}
                {view.address_local && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                    {view.address_local}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {view.phone && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-brand">
                      <Icon name="phone" size={12} /> {t('guest.myRoom.callHotel')}
                    </span>
                  )}
                  {view.map_url && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-brand">
                      <Icon name="map" size={12} /> {t('guest.myRoom.openMap')}
                    </span>
                  )}
                  {view.address_local && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-brand">
                      <Icon name="language" size={12} /> {t('guest.myRoom.showLocalAddress')}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-2 rounded-control bg-surface px-2.5">
              <Row
                icon="wifi"
                label={t('guest.myRoom.wifi')}
                value={[view.wifi_name, view.wifi_password].filter(Boolean).join(' · ')}
              />
              <Row
                icon="coffee"
                label={t('guest.myRoom.breakfast')}
                value={[toTimeInput(view.breakfast_time), view.breakfast_location]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <Row
                icon="cutlery"
                label={t('guest.myRoom.dinner')}
                value={[toTimeInput(view.dinner_time), view.dinner_location]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <Row
                icon="key"
                label={t('guest.myRoom.checkIn')}
                value={toTimeInput(view.check_in_time)}
              />
              <Row
                icon="door"
                label={t('guest.myRoom.checkout')}
                value={toTimeInput(view.checkout_time)}
              />
              <Row
                icon="alarm"
                label={t('guest.myRoom.morningCall')}
                value={toTimeInput(view.morning_call)}
              />
              <Row
                icon="luggage"
                label={t('guest.myRoom.luggageTime')}
                value={toTimeInput(view.luggage_time)}
              />
              <Row icon="bus" label={t('guest.myRoom.meetingPoint')} value={view.meeting_point} />
            </div>

            {(facilities.length > 0 || amenities.length > 0 || view.power_plug) && (
              <div className="mt-2 rounded-control bg-surface p-2.5">
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
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                {view.power_plug && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <Icon name="plug" size={13} />
                    {t('common.facility.powerPlug')}: {view.power_plug}
                  </p>
                )}
              </div>
            )}

            {view.general_info && (
              <div className="mt-2 rounded-control bg-surface p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  {t('guest.myRoom.notes')}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                  {view.general_info}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
