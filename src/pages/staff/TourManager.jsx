import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import {
  getStaffSession,
  getActiveOrgId,
  getActiveTourId,
  switchActiveTour,
} from '../../lib/staffSession'
import { can } from '../../lib/permissions'
import { clearTourCache } from '../../lib/TourContext'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import SelectField from '../../components/common/SelectField'
import BottomSheet from '../../components/common/BottomSheet'

const STATUS_LABEL = {
  draft: { text: 'ร่าง', cls: 'bg-amber-100 text-amber-800' },
  active: { text: 'ใช้งานอยู่', cls: 'bg-emerald-100 text-emerald-800' },
  archived: { text: 'จบแล้ว', cls: 'bg-slate-100 text-slate-600' },
  completed: { text: 'จบแล้ว', cls: 'bg-slate-100 text-slate-600' },
  cancelled: { text: 'ยกเลิก', cls: 'bg-rose-100 text-rose-700' },
}

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'active', label: 'ใช้งานอยู่' },
  { key: 'draft', label: 'ร่าง' },
  { key: 'archived', label: 'จบแล้ว' },
]

// ตัวเลือกตอน clone — ตรงกับพารามิเตอร์ของ RPC clone_tour ทีละตัว
const COPY_OPTIONS = [
  {
    key: 'copy_itinerary',
    param: 'p_copy_itinerary',
    label: 'กำหนดการ',
    hint: 'ก๊อปเป็นของทริปใหม่ เลื่อนวันตามวันเริ่มที่ตั้งไว้',
    copies: true,
  },
  {
    key: 'copy_transport',
    param: 'p_copy_transport',
    label: 'ผังรถ + ที่นั่ง',
    hint: 'ก๊อปผัง ที่นั่งว่างทั้งหมด',
    copies: true,
  },
  {
    key: 'copy_hotels',
    param: 'p_copy_hotels',
    label: 'โรงแรม + ผังห้อง',
    hint: 'ก๊อปผัง ยังไม่จัดคนเข้าห้อง',
    copies: true,
  },
  {
    key: 'copy_form',
    param: 'p_copy_form',
    label: 'ฟอร์มลงทะเบียน',
    hint: 'ใช้คำถามชุดเดียวกับต้นแบบ รวมข้อที่ปิดไว้',
  },
  {
    key: 'copy_guide',
    param: 'p_copy_guide',
    label: 'คู่มือทริป + ศัพท์',
    hint: 'ใช้เนื้อหาชุดเดียวกัน แก้ที่คลังครั้งเดียวอัปเดตทุกทริป',
  },
  {
    key: 'copy_emergency',
    param: 'p_copy_emergency',
    label: 'เบอร์ฉุกเฉิน',
    hint: 'ใช้ชุดเดียวกับต้นแบบ',
  },
  {
    key: 'copy_suppliers',
    param: 'p_copy_suppliers',
    label: 'Supplier',
    hint: 'รายชื่อเจ้าที่ทริปต้นแบบใช้',
    copies: true,
  },
  {
    key: 'copy_staff',
    param: 'p_copy_staff',
    label: 'ทีมงาน',
    hint: 'ยกทีมชุดเดิมมาพร้อม PIN เดิม',
    defaultOff: true,
  },
]

const DEFAULT_COPY = Object.fromEntries(COPY_OPTIONS.map((o) => [o.key, !o.defaultOff]))

const EMPTY_DRAFT = {
  name: '',
  start_date: '',
  end_date: '',
  destination_id: '',
  mode: 'clone',
  source_tour_id: '',
  ...DEFAULT_COPY,
}

function StatusChip({ status }) {
  const s = STATUS_LABEL[status] ?? { text: status, cls: 'bg-slate-100 text-slate-600' }
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.text}
    </span>
  )
}

export default function TourManager() {
  const navigate = useNavigate()
  const session = getStaffSession()
  const orgId = getActiveOrgId()
  const activeTourId = getActiveTourId()

  const [tours, setTours] = useState([])
  const [destinations, setDestinations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)

  // sheet สร้างทริป
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [createError, setCreateError] = useState(null)

  // sheet แก้ไขทริป
  const [editTour, setEditTour] = useState(null)
  const [editDraft, setEditDraft] = useState({
    name: '',
    start_date: '',
    end_date: '',
    destination_id: '',
    is_template: false,
  })
  const [editError, setEditError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [toursRes, destRes] = await Promise.all([
      supabase.rpc('list_org_tours', { p_org_id: orgId }),
      supabase.rpc('list_destinations', { p_org_id: orgId }),
    ])

    if (toursRes.error) {
      console.error('[TourManager] โหลดรายการทริปไม่สำเร็จ', toursRes.error)
      setError('โหลดรายการทริปไม่สำเร็จ')
    } else {
      setTours(toursRes.data ?? [])
    }
    if (destRes.error) console.error('[TourManager] โหลดปลายทางไม่สำเร็จ', destRes.error)
    else setDestinations(destRes.data ?? [])

    setLoading(false)
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  // ---------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------
  async function run(label, fn) {
    setBusy(true)
    try {
      const { error: e } = await fn()
      if (e) throw e
      clearTourCache()
      await load()
    } catch (e) {
      console.error(`[TourManager] ${label} ไม่สำเร็จ`, e)
      window.alert(e.message ?? `${label}ไม่สำเร็จ`)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreateError(null)

    if (!draft.name.trim()) {
      setCreateError('ต้องระบุชื่อทริป')
      return
    }
    if (draft.mode === 'clone' && !draft.source_tour_id) {
      setCreateError('เลือกทริปต้นแบบก่อน')
      return
    }
    if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) {
      setCreateError('วันจบทริปต้องไม่ก่อนวันเริ่ม')
      return
    }

    setBusy(true)
    try {
      let newId
      if (draft.mode === 'clone') {
        // clone_tour จัดการทั้งการก๊อปแถวและการชี้คลังให้ตามตัวเลือกที่ติ๊กไว้แล้ว
        const flags = Object.fromEntries(
          COPY_OPTIONS.map((o) => [o.param, Boolean(draft[o.key])])
        )
        const { data, error: e } = await supabase.rpc('clone_tour', {
          p_source_tour_id: draft.source_tour_id,
          p_new_name: draft.name.trim(),
          p_start_date: draft.start_date || null,
          p_end_date: draft.end_date || null,
          // ใส่คนที่กดสร้างเป็น lead ให้อัตโนมัติ ไม่งั้นทริปใหม่จะไม่มีใครเข้าได้เลย
          p_created_by: session?.staff?.id ?? null,
          ...flags,
        })
        if (e) throw e
        newId = data
      } else {
        const { data, error: e } = await supabase.rpc('create_tour', {
          p_org_id: orgId,
          p_name: draft.name.trim(),
          p_start_date: draft.start_date || null,
          p_end_date: draft.end_date || null,
          p_destination_id: draft.destination_id || null,
          p_pull_library: true,
          p_created_by: session?.staff?.id ?? null,
        })
        if (e) throw e
        newId = data
      }

      setCreateOpen(false)
      setDraft(EMPTY_DRAFT)
      clearTourCache()
      await load()
      window.alert('สร้างทริปแล้ว — อยู่ในสถานะ "ร่าง" กด "เปิดใช้งาน" เมื่อพร้อมให้ลูกทัวร์เข้า')
    } catch (e) {
      console.error('[TourManager] สร้างทริปไม่สำเร็จ', e)
      setCreateError(e.message ?? 'สร้างทริปไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function handleSwitch(tour) {
    const next = switchActiveTour(tour.id)
    if (!next) {
      window.alert('สลับไปทริปนี้ไม่ได้')
      return
    }
    clearTourCache()
    navigate('/staff')
  }

  function handleArchive(tour) {
    if (!window.confirm(`ปิดทริป "${tour.name}" ?\nลูกทัวร์จะยังเปิดดูย้อนหลังได้ แต่แก้ไขไม่ได้`)) return
    run('ปิดทริป', () => supabase.rpc('archive_tour', { p_tour_id: tour.id }))
  }

  function handleUnarchive(tour) {
    run('เปิดทริปอีกครั้ง', () => supabase.rpc('unarchive_tour', { p_tour_id: tour.id }))
  }

  function handleActivate(tour) {
    run('เปิดใช้งาน', () =>
      supabase.rpc('update_tour', { p_tour_id: tour.id, p_status: 'active' })
    )
  }

  function handleRegenCode(tour) {
    if (
      !window.confirm(
        `ออกรหัสใหม่ให้ "${tour.name}" ?\n⚠️ QR และลิงก์เดิมที่แจกไปแล้วจะใช้ไม่ได้ทันที`
      )
    )
      return
    run('ออกรหัสใหม่', () => supabase.rpc('regenerate_join_code', { p_tour_id: tour.id }))
  }

  function handleReset(tour) {
    const typed = window.prompt(
      `ล้างข้อมูลหน้างานของ "${tour.name}"\n\n` +
        `จะลบ: ลูกทัวร์ ${tour.guest_count} คน, เช็คอิน, กระเป๋า, ที่นั่ง, ห้อง, ประกาศ\n` +
        `จะเก็บ: กำหนดการ ผังรถ ผังห้อง ฟอร์ม คู่มือ\n\n` +
        `พิมพ์ชื่อทริปเพื่อยืนยัน:`
    )
    if (typed === null) return
    run('ล้างข้อมูล', () =>
      supabase.rpc('reset_tour_runtime_data', { p_tour_id: tour.id, p_confirm_name: typed })
    )
  }

  function handlePurge(tour) {
    const typed = window.prompt(
      `ลบข้อมูลส่วนบุคคลของ "${tour.name}" ตาม PDPA\n\n` +
        `จะลบถาวร: ตำแหน่ง คำตอบฟอร์ม SOS และล้างชื่อ/เบอร์ของลูกทัวร์\n` +
        `⚠️ ย้อนกลับไม่ได้\n\n` +
        `พิมพ์ชื่อทริปเพื่อยืนยัน:`
    )
    if (typed === null) return
    run('ลบข้อมูลส่วนบุคคล', () =>
      supabase.rpc('purge_tour_personal_data', { p_tour_id: tour.id, p_confirm_name: typed })
    )
  }

  function handleDelete(tour) {
    const typed = window.prompt(
      `ลบทริป "${tour.name}" ถาวร\n\nพิมพ์ชื่อทริปเพื่อยืนยัน:`
    )
    if (typed === null) return
    run('ลบทริป', () =>
      supabase.rpc('delete_empty_tour', { p_tour_id: tour.id, p_confirm_name: typed })
    )
  }

  function copyLink(tour) {
    const url = `${window.location.origin}/t/${tour.join_code}`
    navigator.clipboard?.writeText(url)
    window.alert(`คัดลอกแล้ว\n${url}`)
  }

  function startEdit(tour) {
    setEditTour(tour)
    setEditDraft({
      name: tour.name ?? '',
      start_date: tour.start_date ?? '',
      end_date: tour.end_date ?? '',
      destination_id: tour.destination_id ?? '',
      is_template: Boolean(tour.is_template),
    })
    setEditError(null)
  }

  async function handleEditSave(e) {
    e.preventDefault()
    setEditError(null)

    if (!editDraft.name.trim()) {
      setEditError('ต้องระบุชื่อทริป')
      return
    }
    if (
      editDraft.start_date &&
      editDraft.end_date &&
      editDraft.end_date < editDraft.start_date
    ) {
      setEditError('วันจบทริปต้องไม่ก่อนวันเริ่ม')
      return
    }

    setBusy(true)
    try {
      const { error: e1 } = await supabase.rpc('update_tour', {
        p_tour_id: editTour.id,
        p_name: editDraft.name.trim(),
        p_start_date: editDraft.start_date || null,
        p_end_date: editDraft.end_date || null,
        p_destination_id: editDraft.destination_id || null,
        p_is_template: editDraft.is_template,
      })
      if (e1) throw e1

      setEditTour(null)
      clearTourCache()
      await load()
    } catch (e2) {
      console.error('[TourManager] แก้ไขทริปไม่สำเร็จ', e2)
      setEditError(e2.message ?? 'แก้ไขไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------
  const visible = tours.filter((t) => {
    if (filter === 'all') return true
    if (filter === 'archived') return ['archived', 'completed', 'cancelled'].includes(t.status)
    return t.status === filter
  })

  const canCreate = can(session, 'tour.create')
  const canPurge = can(session, 'tour.purge')
  const canDelete = can(session, 'tour.delete')

  const cloneSources = tours.filter((t) => t.status !== 'cancelled')

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="mx-auto max-w-2xl px-4 py-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-ink">จัดการทริป</h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              {session?.staff?.name} · {session?.orgRole === 'owner' ? 'เจ้าของ' : 'แอดมิน'}
            </p>
          </div>
          {canCreate && (
            <Button fullWidth={false} onClick={() => setCreateOpen(true)} disabled={busy}>
              + สร้างทริป
            </Button>
          )}
        </div>

        <div className="mb-4 flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-semibold transition ${
                filter === f.key
                  ? 'bg-brand text-white shadow-brand'
                  : 'bg-white text-ink-muted ring-1 ring-black/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-ink-muted">กำลังโหลด…</p>}
        {error && <p className="text-rose-600">{error}</p>}

        {!loading && visible.length === 0 && (
          <Card>
            <p className="text-center text-sm text-ink-muted">ไม่มีทริปในหมวดนี้</p>
          </Card>
        )}

        <div className="space-y-3">
          {visible.map((tour) => {
            const isCurrent = tour.id === activeTourId
            const isArchived = ['archived', 'completed', 'cancelled'].includes(tour.status)

            return (
              <Card key={tour.id} className={isCurrent ? 'ring-2 ring-brand' : ''}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-bold text-ink">{tour.name}</h2>
                      <StatusChip status={tour.status} />
                      {tour.is_template && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                          แม่แบบ
                        </span>
                      )}
                      {isCurrent && (
                        <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-hover">
                          กำลังใช้อยู่
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-ink-muted">
                      รหัส <span className="font-mono font-semibold">{tour.join_code}</span>
                      {tour.start_date && ` · ${tour.start_date}`}
                      {tour.end_date && ` – ${tour.end_date}`}
                      {tour.destination_name && ` · ${tour.destination_name}`}
                    </p>

                    <p className="mt-1 text-xs text-ink-faint">
                      ลูกทัวร์ {tour.guest_count} · ทีมงาน {tour.staff_count} · กำหนดการ{' '}
                      {tour.itinerary_count}
                      {tour.personal_data_purged_at && ' · ลบข้อมูลส่วนบุคคลแล้ว'}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-black/5 pt-3">
                  {!isCurrent && !isArchived && (
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handleSwitch(tour)}
                      disabled={busy}
                    >
                      เข้าทำงานทริปนี้
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    fullWidth={false}
                    className="px-3 py-1.5 text-sm"
                    onClick={() => startEdit(tour)}
                    disabled={busy}
                  >
                    แก้ไขชื่อ/วันที่
                  </Button>

                  <Button
                    variant="secondary"
                    fullWidth={false}
                    className="px-3 py-1.5 text-sm"
                    onClick={() => copyLink(tour)}
                  >
                    คัดลอกลิงก์
                  </Button>

                  {tour.status === 'draft' && (
                    <Button
                      fullWidth={false}
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handleActivate(tour)}
                      disabled={busy}
                    >
                      เปิดใช้งาน
                    </Button>
                  )}

                  {tour.status === 'active' && (
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handleArchive(tour)}
                      disabled={busy}
                    >
                      ปิดทริป
                    </Button>
                  )}

                  {isArchived && (
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handleUnarchive(tour)}
                      disabled={busy}
                    >
                      เปิดอีกครั้ง
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    fullWidth={false}
                    className="px-3 py-1.5 text-sm"
                    onClick={() => handleRegenCode(tour)}
                    disabled={busy}
                  >
                    ออกรหัสใหม่
                  </Button>

                  <Button
                    variant="secondary"
                    fullWidth={false}
                    className="px-3 py-1.5 text-sm"
                    onClick={() => handleReset(tour)}
                    disabled={busy}
                  >
                    ล้างข้อมูลหน้างาน
                  </Button>

                  {canPurge && isArchived && !tour.personal_data_purged_at && (
                    <Button
                      variant="danger"
                      fullWidth={false}
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handlePurge(tour)}
                      disabled={busy}
                    >
                      ลบข้อมูลส่วนบุคคล
                    </Button>
                  )}

                  {canDelete && tour.guest_count === 0 && !isCurrent && (
                    <Button
                      variant="danger"
                      fullWidth={false}
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handleDelete(tour)}
                      disabled={busy}
                    >
                      ลบทริป
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* ---------------- sheet แก้ไขทริป ---------------- */}
      <BottomSheet open={Boolean(editTour)} onClose={() => setEditTour(null)} title="แก้ไขทริป">
        <form onSubmit={handleEditSave} className="flex flex-col gap-4">
          <TextField
            label="ชื่อทริป"
            required
            value={editDraft.name}
            onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="วันเริ่ม"
              type="date"
              value={editDraft.start_date}
              onChange={(e) => setEditDraft((d) => ({ ...d, start_date: e.target.value }))}
            />
            <TextField
              label="วันจบ"
              type="date"
              value={editDraft.end_date}
              onChange={(e) => setEditDraft((d) => ({ ...d, end_date: e.target.value }))}
            />
          </div>

          <SelectField
            label="ปลายทาง"
            options={destinations.map((d) => ({ value: d.id, label: d.name }))}
            value={editDraft.destination_id}
            onChange={(e) => setEditDraft((d) => ({ ...d, destination_id: e.target.value }))}
          />

          <label className="flex items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={editDraft.is_template}
              onChange={(e) => setEditDraft((d) => ({ ...d, is_template: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded"
            />
            <span>
              ใช้เป็นแม่แบบ
              <span className="block text-xs text-ink-muted">
                ลูกทัวร์เข้าด้วยรหัสไม่ได้ แต่เลือกเป็นต้นแบบตอนสร้างทริปใหม่ได้
              </span>
            </span>
          </label>

          <p className="rounded-control bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
            เปลี่ยนชื่อไม่กระทบรหัสทริป — QR และลิงก์ที่แจกไปแล้วยังใช้ได้ตามปกติ
          </p>

          {editError && <p className="text-sm text-rose-600">{editError}</p>}

          <Button type="submit" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </form>
      </BottomSheet>

      {/* ---------------- sheet สร้างทริป ---------------- */}
      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title="สร้างทริปใหม่">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex rounded-control bg-surface-sunken p-1">
            {[
              { key: 'clone', label: 'ก๊อปจากทริปเดิม' },
              { key: 'blank', label: 'เริ่มจากว่าง' },
            ].map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, mode: m.key }))}
                className={`flex-1 rounded-[10px] py-2 text-sm font-semibold transition ${
                  draft.mode === m.key ? 'bg-white text-brand shadow-card' : 'text-ink-muted'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <TextField
            label="ชื่อทริป"
            required
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="เช่น ทริปญี่ปุ่น พ.ย. 2569"
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="วันเริ่ม"
              type="date"
              value={draft.start_date}
              onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))}
            />
            <TextField
              label="วันจบ"
              type="date"
              value={draft.end_date}
              onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))}
            />
          </div>

          {draft.mode === 'clone' ? (
            <>
              <SelectField
                label="ทริปต้นแบบ"
                required
                options={cloneSources.map((t) => ({
                  value: t.id,
                  label: `${t.name}${t.is_template ? ' (แม่แบบ)' : ''}`,
                }))}
                value={draft.source_tour_id}
                onChange={(e) => setDraft((d) => ({ ...d, source_tour_id: e.target.value }))}
              />
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-text">
                    เลือกสิ่งที่จะดึงมา
                  </span>
                  <div className="flex gap-2 text-xs font-semibold">
                    <button
                      type="button"
                      className="text-brand"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          ...Object.fromEntries(COPY_OPTIONS.map((o) => [o.key, true])),
                        }))
                      }
                    >
                      เลือกทั้งหมด
                    </button>
                    <span className="text-ink-faint">·</span>
                    <button
                      type="button"
                      className="text-ink-muted"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          ...Object.fromEntries(COPY_OPTIONS.map((o) => [o.key, false])),
                        }))
                      }
                    >
                      ล้าง
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-black/5 overflow-hidden rounded-control bg-surface-sunken">
                  {COPY_OPTIONS.map((o) => (
                    <label
                      key={o.key}
                      className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(draft[o.key])}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [o.key]: e.target.checked }))
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 rounded"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-ink">{o.label}</span>
                          {!o.copies && (
                            <span className="rounded-full bg-brand-light px-1.5 py-px text-[10px] font-semibold text-brand-hover">
                              ใช้ร่วม
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-ink-muted">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <p className="mt-2 rounded-control bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
                  <span className="font-semibold text-brand-hover">ใช้ร่วม</span> = ชี้ไปที่คลังกลาง
                  ไม่ได้ก๊อปแถวใหม่ แก้ที่คลังครั้งเดียวทุกทริปที่ใช้อยู่จะอัปเดตตาม
                  (อยากแก้เฉพาะทริปนี้ใช้ปุ่ม “แยกสำเนา” ในหน้าคู่มือ/ฟอร์ม)
                  <br />
                  <span className="font-semibold text-ink">
                    ไม่ก๊อปลูกทัวร์และข้อมูลส่วนตัวใดๆ ทุกกรณี
                  </span>
                </p>
              </div>
            </>
          ) : (
            <>
              <SelectField
                label="ปลายทาง"
                options={destinations.map((d) => ({ value: d.id, label: d.name }))}
                value={draft.destination_id}
                onChange={(e) => setDraft((d) => ({ ...d, destination_id: e.target.value }))}
              />
              <p className="rounded-control bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
                คู่มือ ศัพท์ และเบอร์ฉุกเฉินของปลายทางที่เลือกจะถูกดึงมาให้อัตโนมัติ
                ปิดข้อที่ไม่ใช้ได้ทีหลัง
              </p>
            </>
          )}

          {createError && <p className="text-sm text-rose-600">{createError}</p>}

          <Button type="submit" disabled={busy}>
            {busy ? 'กำลังสร้าง…' : 'สร้างทริป'}
          </Button>
        </form>
      </BottomSheet>
    </div>
  )
}
