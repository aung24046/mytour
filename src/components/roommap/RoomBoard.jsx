import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BottomSheet from '../common/BottomSheet'
import Button from '../common/Button'
import Card from '../common/Card'
import Icon from '../common/Icon'
import { genderTextClass } from '../../lib/genderColor'
import { autoPair, roomLabel, roomTypeShort, sortRoomsForDisplay } from '../../lib/roomAssign'

const ROOM_TYPES = [
  { value: 'single', label: 'Single Room', maxGuests: 1 },
  { value: 'twin', label: 'Twin Room', maxGuests: 2 },
  { value: 'double', label: 'Double Room', maxGuests: 2 },
  { value: 'triple', label: 'Triple Room', maxGuests: 3 },
  { value: 'quad', label: 'Quad Room', maxGuests: 4 },
  { value: 'family', label: 'Family Room', maxGuests: 4 },
]

export function maxGuestsFor(roomType) {
  return ROOM_TYPES.find((rt) => rt.value === roomType)?.maxGuests ?? 2
}

export { ROOM_TYPES }

function genderDotClass(gender) {
  if (gender === 'ชาย') return 'bg-blue-600'
  if (gender === 'หญิง') return 'bg-pink-600'
  return 'bg-ink-faint'
}

/** จุดแทนเตียงใต้เลขห้อง — ทึบ = มีคนแล้ว, จาง = ว่าง
 *  อ่านสถานะห้องได้จากการกวาดตา ไม่ต้องอ่านตัวเลข */
function BedDots({ occupants, maxGuests }) {
  return (
    <div className="mt-1 flex justify-center gap-[3px]">
      {Array.from({ length: maxGuests }, (_, i) => {
        const guest = occupants[i]
        return (
          <span
            key={i}
            className={`h-[7px] w-[7px] rounded-full ${
              guest ? genderDotClass(guest.gender) : 'bg-black/[0.12]'
            }`}
          />
        )
      })}
    </div>
  )
}

export default function RoomBoard({
  rooms,
  guests,
  assignmentsByRoom,
  guestById,
  onAssignMany,
  onRemoveAssignment,
  onUpdateRoom,
  onDeleteRoom,
  onAddRooms,
}) {
  const { t } = useTranslation()
  const [selectedGuestIds, setSelectedGuestIds] = useState([])
  const [openRoomId, setOpenRoomId] = useState(null)
  const [pairPlan, setPairPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  const assignedIds = useMemo(() => {
    const set = new Set()
    for (const room of rooms) {
      for (const a of assignmentsByRoom[room.id] ?? []) set.add(a.guest_id)
    }
    return set
  }, [rooms, assignmentsByRoom])

  const unassigned = useMemo(
    () => guests.filter((g) => !assignedIds.has(g.id)),
    [guests, assignedIds]
  )

  const visibleUnassigned = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return unassigned
    return unassigned.filter(
      (g) => g.name?.toLowerCase().includes(q) || g.nickname?.toLowerCase().includes(q)
    )
  }, [unassigned, search])

  const occupantsOf = (room) =>
    (assignmentsByRoom[room.id] ?? []).map((a) => guestById[a.guest_id]).filter(Boolean)

  const capacityLeftOf = (room) =>
    Math.max(0, (room.max_guests ?? 0) - (assignmentsByRoom[room.id] ?? []).length)

  // จัดกลุ่มตามชั้น — ห้องที่ยังไม่ระบุชั้นไปรวมกลุ่มท้ายสุด ไม่ปนกับชั้นที่ระบุแล้ว
  // ในแต่ละชั้นเรียงตามเลขห้อง (ส่ง rooms ลำดับดั้งเดิมให้ sortRoomsForDisplay
  // เพื่อไม่ให้เลขชั่วคราว TWN-1/TWN-2 สลับกันเอง)
  const floors = useMemo(() => {
    const map = new Map()
    for (const room of rooms) {
      const key = (room.floor ?? '').trim() || '__none'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(room)
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        if (a === '__none') return 1
        if (b === '__none') return -1
        return a.localeCompare(b, undefined, { numeric: true })
      })
      .map(([floor, list]) => [floor, sortRoomsForDisplay(list, rooms)])
  }, [rooms])

  function toggleGuest(id) {
    setSelectedGuestIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function placeInRoom(room) {
    const left = capacityLeftOf(room)
    if (left <= 0 || selectedGuestIds.length === 0) return
    // วางได้ไม่เกินที่เหลือ — คนที่เหลือยังคงถูกเลือกไว้ ให้ไปวางห้องถัดไปต่อได้ทันที
    const take = selectedGuestIds.slice(0, left)
    setBusy(true)
    await onAssignMany(room.id, take)
    setSelectedGuestIds((prev) => prev.filter((id) => !take.includes(id)))
    setBusy(false)
  }

  function buildAutoPair() {
    const plan = autoPair({
      rooms,
      unassignedGuests: unassigned,
      capacityLeftOf,
    })
    setPairPlan(plan.length > 0 ? plan : [])
  }

  async function applyAutoPair() {
    setBusy(true)
    for (const step of pairPlan) {
      await onAssignMany(step.roomId, step.guestIds)
    }
    setBusy(false)
    setPairPlan(null)
    setSelectedGuestIds([])
  }

  const openRoom = rooms.find((r) => r.id === openRoomId) ?? null
  const selecting = selectedGuestIds.length > 0

  return (
    <>
      {/* ถาดคนที่ยังไม่มีห้อง — เห็นชื่อจริง ไม่ใช่แค่ตัวเลข */}
      {unassigned.length > 0 ? (
        <div className="mt-3 rounded-card bg-warning-bg p-2.5 ring-1 ring-warning/20">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-warning-text">
              {t('staff.roomMap.unassignedTray')} {unassigned.length}
            </span>
            <span className="flex-1" />
            {selecting ? (
              <button
                onClick={() => setSelectedGuestIds([])}
                className="text-[11px] font-semibold text-warning-text underline"
              >
                {t('staff.roomMap.clearSelection')}
              </button>
            ) : (
              <button
                onClick={buildAutoPair}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning-text underline"
              >
                <Icon name="star" size={12} />
                {t('staff.roomMap.autoPair')}
              </button>
            )}
          </div>

          {unassigned.length > 8 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('staff.checkIn.searchPlaceholder')}
              className="mb-1.5 w-full rounded-control border border-line bg-surface px-2 py-1.5 text-xs focus:outline-none"
            />
          )}

          <div className="flex flex-wrap gap-1.5">
            {visibleUnassigned.map((g) => {
              const on = selectedGuestIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  onClick={() => toggleGuest(g.id)}
                  className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium transition ${
                    on
                      ? 'bg-brand text-white'
                      : `bg-surface ring-1 ring-line-subtle ${genderTextClass(g.gender) || 'text-ink'}`
                  }`}
                >
                  {!on && <span className={`h-1.5 w-1.5 rounded-full ${genderDotClass(g.gender)}`} />}
                  {g.nickname || g.name}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        guests.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 rounded-control bg-success-bg px-3 py-2 text-xs font-semibold text-success-text">
            <Icon name="checkCircle" size={14} />
            {t('staff.roomMap.allAssigned')}
          </p>
        )
      )}

      {selecting && (
        <p className="mt-2 px-1 text-[11px] font-semibold text-brand">
          {t('staff.roomMap.selectedCount', { count: selectedGuestIds.length })} ·{' '}
          {t('staff.roomMap.tapRoomToPlace')}
        </p>
      )}

      {/* ผังห้องแบ่งตามชั้น */}
      <div className="mt-3 flex flex-col gap-3">
        {rooms.length === 0 && (
          <p className="text-sm text-ink-faint">{t('staff.roomMap.noRooms')}</p>
        )}

        {floors.map(([floorKey, floorRooms]) => {
          const vacant = floorRooms.filter((r) => capacityLeftOf(r) > 0).length
          return (
            <div key={floorKey}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-[11px] text-ink-faint">
                  {floorKey === '__none'
                    ? t('staff.roomMap.floorNone')
                    : t('staff.roomMap.floorLabel', { floor: floorKey })}
                </span>
                <span className="h-px flex-1 bg-black/[0.06]" />
                <span className="text-[11px] text-ink-faint">
                  {t('staff.roomMap.filterVacant')} {vacant}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {floorRooms.map((room) => {
                  const occupants = occupantsOf(room)
                  const left = capacityLeftOf(room)
                  const { label, isTemporary } = roomLabel(room, rooms)
                  const canPlace = selecting && left > 0
                  return (
                    <button
                      key={room.id}
                      onClick={() => (canPlace ? placeInRoom(room) : setOpenRoomId(room.id))}
                      disabled={busy}
                      className={`relative rounded-control p-2 text-center transition ${
                        canPlace
                          ? 'bg-brand-lighter ring-2 ring-brand'
                          : 'bg-surface ring-1 ring-line'
                      }`}
                    >
                      <div
                        className={`text-[15px] font-bold leading-tight ${
                          isTemporary ? 'text-ink-muted' : 'text-ink'
                        }`}
                      >
                        {label}
                      </div>
                      <div className="text-[10px] text-ink-faint">{roomTypeShort(room.room_type)}</div>
                      <BedDots occupants={occupants} maxGuests={room.max_guests ?? 0} />
                      {room.note && (
                        <span className="absolute right-1 top-1 text-ink-faint">
                          <Icon name="notes" size={11} />
                        </span>
                      )}
                    </button>
                  )
                })}

                <button
                  onClick={onAddRooms}
                  className="rounded-control border border-dashed border-brand/40 p-2 text-center text-[11px] font-semibold text-brand"
                >
                  + {t('staff.roomMap.addRoomsShort')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* รายละเอียดห้อง */}
      <BottomSheet
        open={!!openRoom}
        onClose={() => setOpenRoomId(null)}
        title={openRoom ? roomLabel(openRoom, rooms).label : ''}
      >
        {openRoom && (
          <div className="flex flex-col gap-3">
            {roomLabel(openRoom, rooms).isTemporary && (
              <p className="rounded-control bg-warning-bg px-2.5 py-1.5 text-[11px] text-warning-text">
                {t('staff.roomMap.tempNumberHint')}
              </p>
            )}

            <div className="flex gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-xs font-semibold text-ink-muted">
                  {t('staff.roomMap.roomNumber')}
                </span>
                <input
                  type="text"
                  defaultValue={openRoom.room_number ?? ''}
                  onBlur={(e) => onUpdateRoom(openRoom.id, { room_number: e.target.value })}
                  className="w-full rounded-control border border-line px-2.5 py-2 text-base focus:outline-none"
                />
              </label>
              <label className="w-20">
                <span className="mb-1 block text-xs font-semibold text-ink-muted">
                  {t('staff.roomMap.floor')}
                </span>
                <input
                  type="text"
                  defaultValue={openRoom.floor ?? ''}
                  onBlur={(e) => onUpdateRoom(openRoom.id, { floor: e.target.value })}
                  className="w-full rounded-control border border-line px-2.5 py-2 text-base focus:outline-none"
                />
              </label>
            </div>

            <label>
              <span className="mb-1 block text-xs font-semibold text-ink-muted">
                {t('staff.roomMap.roomType')}
              </span>
              <select
                value={openRoom.room_type}
                onChange={(e) => {
                  const nextMax = maxGuestsFor(e.target.value)
                  if ((assignmentsByRoom[openRoom.id] ?? []).length > nextMax) {
                    window.alert(
                      t('staff.roomMap.bedsShort', {
                        count: (assignmentsByRoom[openRoom.id] ?? []).length - nextMax,
                      })
                    )
                    return
                  }
                  onUpdateRoom(openRoom.id, { room_type: e.target.value, max_guests: nextMax })
                }}
                className="w-full rounded-control border border-line px-2.5 py-2 text-base focus:outline-none"
              >
                {ROOM_TYPES.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label} · {rt.maxGuests}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-1 block text-xs font-semibold text-ink-muted">
                {t('staff.roomMap.roomDetail')}
              </span>
              <div className="flex flex-col gap-1.5">
                {(assignmentsByRoom[openRoom.id] ?? []).map((a) => {
                  const g = guestById[a.guest_id]
                  return (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 rounded-control bg-surface-muted px-2.5 py-2"
                    >
                      <span className={`h-2 w-2 rounded-full ${genderDotClass(g?.gender)}`} />
                      <span
                        className={`flex-1 text-sm font-medium ${genderTextClass(g?.gender) || 'text-ink'}`}
                      >
                        {g ? g.nickname || g.name : '—'}
                      </span>
                      <button
                        onClick={() => onRemoveAssignment(a.id)}
                        className="text-sm font-semibold text-danger"
                      >
                        {t('staff.roomMap.removeGuest')}
                      </button>
                    </div>
                  )
                })}
                {Array.from({ length: capacityLeftOf(openRoom) }, (_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="rounded-control border border-dashed border-line px-2.5 py-2 text-sm text-ink-faint"
                  >
                    {t('staff.roomMap.emptyBed')}
                  </div>
                ))}
              </div>
            </div>

            <label>
              <span className="mb-1 block text-xs font-semibold text-ink-muted">
                {t('staff.roomMap.roomNote')}
              </span>
              <input
                type="text"
                defaultValue={openRoom.note ?? ''}
                placeholder={t('staff.roomMap.roomNotePlaceholder')}
                onBlur={(e) => onUpdateRoom(openRoom.id, { note: e.target.value.trim() || null })}
                className="w-full rounded-control border border-line px-2.5 py-2 text-sm focus:outline-none"
              />
            </label>

            <button
              onClick={() => {
                onDeleteRoom(openRoom)
                setOpenRoomId(null)
              }}
              className="self-start text-sm font-semibold text-danger"
            >
              {t('staff.formBuilder.delete')}
            </button>
          </div>
        )}
      </BottomSheet>

      {/* ร่างการจับคู่อัตโนมัติ — ต้องกดยืนยันก่อนถึงบันทึก */}
      <BottomSheet
        open={pairPlan !== null}
        onClose={() => setPairPlan(null)}
        title={t('staff.roomMap.autoPairTitle')}
      >
        {pairPlan !== null && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-ink-muted">{t('staff.roomMap.autoPairHint')}</p>

            {pairPlan.length === 0 ? (
              <p className="text-sm text-ink-faint">{t('staff.roomMap.autoPairNone')}</p>
            ) : (
              <>
                <div className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto">
                  {pairPlan.map((step) => {
                    const room = rooms.find((r) => r.id === step.roomId)
                    return (
                      <Card key={step.roomId} className="p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-brand">
                            {room ? roomLabel(room, rooms).label : '—'}
                          </span>
                          <span className="flex-1 text-xs text-ink-muted">
                            {step.guestIds
                              .map((id) => guestById[id]?.nickname || guestById[id]?.name)
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                          <span className="shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-muted">
                            {t(
                              `staff.roomMap.reason${step.reason[0].toUpperCase()}${step.reason.slice(1)}`
                            )}
                          </span>
                        </div>
                      </Card>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <Button onClick={applyAutoPair} disabled={busy}>
                    {t('staff.roomMap.autoPairApply')}
                  </Button>
                  <Button variant="secondary" onClick={() => setPairPlan(null)} disabled={busy}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  )
}
