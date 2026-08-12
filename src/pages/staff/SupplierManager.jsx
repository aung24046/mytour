import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId, useActiveOrgId } from '../../lib/staffSession'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import BottomSheet from '../../components/common/BottomSheet'
import StarRating from '../../components/common/StarRating'

const CATEGORIES = ['hotel', 'restaurant', 'transport', 'attraction', 'shop', 'other']

const EMPTY_DRAFT = {
  name: '',
  category: 'hotel',
  contact_person: '',
  phone: '',
  line_id: '',
  address: '',
  notes: '',
  linkToTrip: true,
}

function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6.1 6.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.5 11.5c0 3.9-3.8 7-8.5 7-.9 0-1.8-.1-2.6-.3L4.5 20l1.2-3.2A6.7 6.7 0 0 1 3.5 11.5c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" />
    </svg>
  )
}

// คลังคู่ค้า — จัดหน้าแบบสมุดโทรศัพท์ (แบบ G)
//
// ของเดิมเป็นการ์ดใบละ ~200pt (ชื่อ + ผู้ติดต่อ + ที่อยู่ + ปุ่มติดต่อ + โน้ต + ดาว +
// แก้ไข/ลบ) จอหนึ่งเห็นได้ 3-4 เจ้า คลัง 42 เจ้าจึงต้องเลื่อนสิบกว่าหน้า ทั้งที่
// หน้างานจริงต้องการแค่ "โทรหาเจ้านี้" ส่วนดาวกับปุ่มลบใช้ปีละไม่กี่ครั้งแต่กินที่ทุกใบ
//
// ที่นี่ยุบเหลือแถวละ ~52pt (เห็น ~11 เจ้าต่อจอ) เหลือบนแถวแค่สิ่งที่ใช้ตัดสินใจว่า
// "ใช่เจ้านี้ไหม" กับปุ่มติดต่อที่อยู่ตำแหน่งเดิมทุกแถว — ที่เหลือย้ายเข้าชีตรายละเอียด
export default function SupplierManager() {
  const tourId = useActiveTourId()
  const orgId = useActiveOrgId()
  const { t } = useTranslation()

  const [suppliers, setSuppliers] = useState([])
  const [tourSupplierIds, setTourSupplierIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [scope, setScope] = useState('trip') // trip | all | top
  const [search, setSearch] = useState('')

  const [detailId, setDetailId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null) // null = new
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [showMore, setShowMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  async function loadData() {
    setLoading(true)
    setError(null)

    const [suppliersRes, linksRes] = await Promise.all([
      supabase
        .from('suppliers')
        .select('id, name, category, contact_person, phone, line_id, address, notes, rating, is_active')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase.from('tour_suppliers').select('supplier_id').eq('tour_id', tourId),
    ])

    if (suppliersRes.error) {
      console.error('[SupplierManager] load failed', suppliersRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setSuppliers(suppliersRes.data ?? [])
    if (!linksRes.error) {
      setTourSupplierIds(new Set((linksRes.data ?? []).map((l) => l.supplier_id)))
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tripCount = useMemo(
    () => suppliers.filter((s) => tourSupplierIds.has(s.id)).length,
    [suppliers, tourSupplierIds]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return suppliers.filter((s) => {
      // ค้นหาไปทั้งคลังเสมอ — คนพิมพ์ชื่อเจ้าที่จำได้ ไม่ได้อยากได้ผลลัพธ์
      // ที่ถูกตัดด้วยตัวกรองที่ตัวเองลืมว่าเปิดค้างไว้
      if (!q) {
        if (scope === 'trip' && !tourSupplierIds.has(s.id)) return false
        if (scope === 'top' && (s.rating ?? 0) < 4) return false
      }
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        (s.contact_person ?? '').toLowerCase().includes(q) ||
        (s.notes ?? '').toLowerCase().includes(q) ||
        (s.phone ?? '').includes(q)
      )
    })
  }, [suppliers, scope, search, tourSupplierIds])

  /** จัดกลุ่มตามหมวดโดยคงลำดับหมวดที่ตั้งไว้ และตัดหมวดที่ว่างทิ้ง */
  const groups = useMemo(() => {
    return CATEGORIES.map((category) => ({
      category,
      items: visible
        .filter((s) => s.category === category)
        .sort((a, b) => a.name.localeCompare(b.name, 'th')),
    })).filter((g) => g.items.length > 0)
  }, [visible])

  const detail = useMemo(
    () => suppliers.find((s) => s.id === detailId) ?? null,
    [suppliers, detailId]
  )

  function openNew() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setShowMore(false)
    setFormError(null)
    setDetailId(null)
    setFormOpen(true)
  }

  function openEdit(supplier) {
    setEditingId(supplier.id)
    setDraft({
      name: supplier.name,
      category: supplier.category,
      contact_person: supplier.contact_person ?? '',
      phone: supplier.phone ?? '',
      line_id: supplier.line_id ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
      linkToTrip: tourSupplierIds.has(supplier.id),
    })
    // เจ้าที่มีข้อมูลส่วนเพิ่มอยู่แล้วต้องกางให้เห็นตั้งแต่แรก ไม่งั้นจะนึกว่าข้อมูลหาย
    setShowMore(
      Boolean(supplier.contact_person || supplier.line_id || supplier.address || supplier.notes)
    )
    setFormError(null)
    setDetailId(null)
    setFormOpen(true)
  }

  async function saveSupplier() {
    if (!draft.name.trim()) return
    setSaving(true)
    setFormError(null)

    try {
      const payload = {
        org_id: orgId,
        name: draft.name.trim(),
        category: draft.category,
        contact_person: draft.contact_person.trim() || null,
        phone: draft.phone.trim() || null,
        line_id: draft.line_id.trim() || null,
        address: draft.address.trim() || null,
        notes: draft.notes.trim() || null,
      }

      let supplierId = editingId
      if (editingId) {
        const { error: updateError } = await supabase
          .from('suppliers')
          .update(payload)
          .eq('id', editingId)
        if (updateError) throw updateError
      } else {
        const { data, error: insertError } = await supabase
          .from('suppliers')
          .insert(payload)
          .select('id')
          .single()
        if (insertError) throw insertError
        supplierId = data.id
      }

      await setTripLink(supplierId, draft.linkToTrip)

      setFormOpen(false)
      loadData()
    } catch (err) {
      console.error('[SupplierManager] save failed', err)
      setFormError(err.message ?? t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  async function setTripLink(supplierId, linked) {
    const isLinked = tourSupplierIds.has(supplierId)
    if (linked && !isLinked) {
      const { error: linkError } = await supabase
        .from('tour_suppliers')
        .insert({ tour_id: tourId, supplier_id: supplierId })
      if (!linkError) setTourSupplierIds((prev) => new Set(prev).add(supplierId))
    } else if (!linked && isLinked) {
      const { error: unlinkError } = await supabase
        .from('tour_suppliers')
        .delete()
        .eq('tour_id', tourId)
        .eq('supplier_id', supplierId)
      if (!unlinkError) {
        setTourSupplierIds((prev) => {
          const next = new Set(prev)
          next.delete(supplierId)
          return next
        })
      }
    }
  }

  async function updateRating(supplier, rating) {
    setSuppliers((prev) => prev.map((s) => (s.id === supplier.id ? { ...s, rating } : s)))
    const { error: ratingError } = await supabase
      .from('suppliers')
      .update({ rating })
      .eq('id', supplier.id)
    if (ratingError) {
      console.error('[SupplierManager] update rating failed', ratingError)
      loadData()
    }
  }

  async function deleteSupplier(supplier) {
    const confirmed = window.confirm(
      t('staff.supplierManager.confirmDelete', { name: supplier.name })
    )
    if (!confirmed) return
    setDetailId(null)
    setSuppliers((prev) => prev.filter((s) => s.id !== supplier.id))
    const { error: delError } = await supabase.from('suppliers').delete().eq('id', supplier.id)
    if (delError) {
      console.error('[SupplierManager] delete failed', delError)
      loadData()
    }
  }

  const categoryOptions = CATEGORIES.map((c) => ({
    value: c,
    label: t(`staff.supplierManager.category.${c}`),
  }))

  const scopes = [
    { id: 'trip', label: t('staff.supplierManager.filterUsedInTrip'), count: tripCount },
    { id: 'all', label: t('staff.supplierManager.filterAllSuppliers'), count: suppliers.length },
    { id: 'top', label: t('staff.supplierManager.filterHighRating'), count: null },
  ]

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader
        icon="store"
        title={t('staff.supplierManager.title')}
        actions={
          <button onClick={openNew} className="rounded-pill px-2 py-1.5 text-sm font-semibold text-brand">
            + {t('staff.supplierManager.addSupplier')}
          </button>
        }
      />
      <div className="mx-auto max-w-md px-4 pb-16 pt-3">

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('staff.supplierManager.searchPlaceholder')}
          className="h-10 w-full rounded-control border border-transparent bg-surface-sunken px-3.5 text-base text-ink placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none"
        />

        <div className="mt-2 flex gap-1.5">
          {scopes.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              aria-pressed={scope === s.id}
              className={`h-8 rounded-pill px-3 text-xs font-semibold transition ${
                scope === s.id ? 'bg-brand text-white' : 'bg-surface-sunken text-ink-muted'
              }`}
            >
              {s.label}
              {s.count != null && <span className="ml-1 opacity-70">{s.count}</span>}
            </button>
          ))}
        </div>

        {loading && <p className="mt-4 text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-danger">{error}</p>}

        {!loading && !error && suppliers.length === 0 && (
          <p className="mt-6 text-sm text-ink-faint">{t('staff.supplierManager.noSuppliers')}</p>
        )}
        {!loading && !error && suppliers.length > 0 && groups.length === 0 && (
          <p className="mt-6 text-sm text-ink-faint">
            {scope === 'trip' && !search
              ? t('staff.supplierManager.noneInTrip')
              : t('staff.supplierManager.noResults')}
          </p>
        )}

        {groups.map(({ category, items }) => (
          <section key={category}>
            {/* หัวข้อหมวด — ติดขอบบนตอนเลื่อน จึงรู้ตลอดว่ากำลังอยู่หมวดไหน
                ต้องมีพื้นหลังทึบ ไม่งั้นแถวที่เลื่อนผ่านจะทะลุขึ้นมาซ้อนตัวหนังสือ */}
            <div className="sticky top-0 z-10 -mx-4 mt-4 bg-surface-muted px-4 pb-1.5 pt-2">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1 rounded-full bg-brand" />
                <h2 className="text-[15px] font-bold text-ink">
                  {t(`staff.supplierManager.category.${category}`)}
                </h2>
                <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                  {items.length}
                </span>
                <span className="ml-1 h-px flex-1 bg-line" />
              </div>
            </div>

            <div className="overflow-hidden rounded-card bg-surface">
              {items.map((s, i) => {
                const linked = tourSupplierIds.has(s.id)
                const sub = [
                  s.contact_person,
                  s.rating ? '★'.repeat(s.rating) : null,
                  !s.contact_person && !s.rating ? s.notes : null,
                ]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-2 px-3 ${
                      i > 0 ? 'border-t border-line-subtle' : ''
                    }`}
                  >
                    <button
                      onClick={() => setDetailId(s.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {linked && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                              aria-label={t('staff.supplierManager.usedInTrip')}
                            />
                          )}
                          <span className="truncate text-[15px] text-ink">{s.name}</span>
                        </span>
                        {sub && (
                          <span className="mt-0.5 block truncate text-xs text-ink-muted">{sub}</span>
                        )}
                      </span>
                    </button>

                    {/* ปุ่มติดต่ออยู่ตำแหน่งเดิมทุกแถว — จางลงเมื่อไม่มีข้อมูล แทนที่จะหายไป
                        ไม่งั้นปุ่มจะขยับตำแหน่งไปมาตามว่าเจ้าไหนมีไลน์ */}
                    {s.phone ? (
                      <a
                        href={`tel:${s.phone}`}
                        aria-label={`${t('staff.supplierManager.callAction')} ${s.name}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-brand"
                      >
                        <PhoneIcon />
                      </a>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-faint/40"
                      >
                        <PhoneIcon />
                      </span>
                    )}
                    {s.line_id ? (
                      <a
                        href={`https://line.me/ti/p/~${s.line_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${t('staff.supplierManager.lineAction')} ${s.name}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-success-text"
                      >
                        <ChatIcon />
                      </a>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-faint/40"
                      >
                        <ChatIcon />
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {/* รายละเอียด — ทุกอย่างที่ถูกยกออกจากแถวมารวมกันที่นี่ */}
      <BottomSheet
        open={Boolean(detail)}
        onClose={() => setDetailId(null)}
        title={detail?.name ?? ''}
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-pill bg-brand-lighter px-2.5 py-1 text-xs font-semibold text-brand">
                {t(`staff.supplierManager.category.${detail.category}`)}
              </span>
              <button
                onClick={() => setTripLink(detail.id, !tourSupplierIds.has(detail.id))}
                className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${
                  tourSupplierIds.has(detail.id)
                    ? 'bg-success-bg text-success-text'
                    : 'bg-surface-sunken text-ink-muted'
                }`}
              >
                {tourSupplierIds.has(detail.id)
                  ? t('staff.supplierManager.removeFromTrip')
                  : t('staff.supplierManager.addToTrip')}
              </button>
            </div>

            <div className="flex gap-2">
              <a
                href={detail.phone ? `tel:${detail.phone}` : undefined}
                aria-disabled={!detail.phone}
                className={`flex flex-1 items-center justify-center gap-2 rounded-control py-2.5 text-sm font-semibold ${
                  detail.phone
                    ? 'bg-brand-lighter text-brand'
                    : 'pointer-events-none bg-surface-sunken text-ink-faint'
                }`}
              >
                <PhoneIcon />
                {detail.phone ?? t('staff.supplierManager.noPhone')}
              </a>
              {detail.line_id && (
                <a
                  href={`https://line.me/ti/p/~${detail.line_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-control bg-success-bg py-2.5 text-sm font-semibold text-success-text"
                >
                  <ChatIcon />
                  {detail.line_id}
                </a>
              )}
            </div>

            <dl className="flex flex-col gap-2 text-sm">
              {detail.contact_person && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-faint">
                    {t('staff.supplierManager.contactPerson')}
                  </dt>
                  <dd className="text-ink">{detail.contact_person}</dd>
                </div>
              )}
              {detail.address && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-faint">
                    {t('staff.supplierManager.address')}
                  </dt>
                  <dd className="text-ink">{detail.address}</dd>
                </div>
              )}
              {detail.notes && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-faint">
                    {t('staff.supplierManager.notes')}
                  </dt>
                  <dd className="text-ink">{detail.notes}</dd>
                </div>
              )}
            </dl>

            <div className="flex items-center justify-between border-t border-line-subtle pt-3">
              <span className="text-sm text-ink-faint">
                {t('staff.supplierManager.ratingLabel')}
              </span>
              <StarRating
                value={detail.rating ?? ''}
                onChange={(v) => updateRating(detail, Number(v))}
                size={22}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => openEdit(detail)}>
                {t('staff.supplierManager.editSupplier')}
              </Button>
              <Button variant="ghost" onClick={() => deleteSupplier(detail)} className="text-danger">
                {t('staff.supplierManager.deleteSupplier')}
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* ฟอร์มเพิ่ม/แก้ไข */}
      <BottomSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={
          editingId
            ? t('staff.supplierManager.editSupplier')
            : t('staff.supplierManager.addSupplier')
        }
      >
        {/* กรอกขั้นต่ำก่อน (แบบ M) — บังคับจริงแค่ชื่อ ส่วนหมวดกับเบอร์คือสิ่งที่ทำให้
            คู่ค้ารายนี้ "ใช้งานได้" (หาเจอ + โทรออก) ที่เหลือพับไว้เพราะเพิ่มระหว่างทริป
            มักไม่มีข้อมูลครบอยู่แล้ว — ค่อยกลับมาเติมทีหลังได้ */}
        <div className="flex flex-col gap-3">
          <TextField
            label={t('staff.supplierManager.name')}
            required
            autoFocus
            placeholder={t('staff.supplierManager.namePlaceholder')}
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          />

          {/* หมวดเป็นชิปกริด — แตะเดียวจบ แทน dropdown ที่กิน 3 จังหวะบนมือถือ */}
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
              {t('staff.supplierManager.categoryLabel')}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {categoryOptions.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, category: c.value }))}
                  aria-pressed={draft.category === c.value}
                  className={`h-10 truncate rounded-control px-1 text-[13px] font-semibold transition ${
                    draft.category === c.value
                      ? 'bg-brand text-white shadow-brand'
                      : 'bg-surface-sunken text-ink-muted'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <TextField
            label={t('staff.supplierManager.phone')}
            type="tel"
            inputMode="tel"
            placeholder={t('staff.supplierManager.phonePlaceholder')}
            value={draft.phone}
            onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
          />

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="self-start text-sm font-semibold text-brand"
          >
            {showMore
              ? t('staff.supplierManager.fewerFields')
              : t('staff.supplierManager.moreFields')}
          </button>

          {showMore && (
            <>
              <TextField
                label={t('staff.supplierManager.contactPerson')}
                value={draft.contact_person}
                onChange={(e) => setDraft((prev) => ({ ...prev, contact_person: e.target.value }))}
              />
              <TextField
                label={t('staff.supplierManager.lineId')}
                value={draft.line_id}
                onChange={(e) => setDraft((prev) => ({ ...prev, line_id: e.target.value }))}
              />
              <TextField
                label={t('staff.supplierManager.address')}
                value={draft.address}
                onChange={(e) => setDraft((prev) => ({ ...prev, address: e.target.value }))}
              />
              <TextAreaField
                label={t('staff.supplierManager.notes')}
                placeholder={t('staff.supplierManager.notesPlaceholder')}
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </>
          )}

          <button
            type="button"
            onClick={() => setDraft((prev) => ({ ...prev, linkToTrip: !prev.linkToTrip }))}
            role="switch"
            aria-checked={draft.linkToTrip}
            className="flex items-center justify-between rounded-control bg-surface-sunken px-3 py-2.5"
          >
            <span className="text-sm font-medium text-neutral-text">
              {t('staff.supplierManager.linkToTrip')}
            </span>
            <span
              className={`flex h-6 w-10 items-center rounded-pill p-0.5 transition ${
                draft.linkToTrip ? 'bg-brand' : 'bg-line-strong'
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-surface transition ${
                  draft.linkToTrip ? 'translate-x-4' : ''
                }`}
              />
            </span>
          </button>

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <Button onClick={saveSupplier} disabled={saving || !draft.name.trim()}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
