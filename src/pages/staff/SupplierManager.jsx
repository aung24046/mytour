import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID, ACTIVE_ORG_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import SelectField from '../../components/common/SelectField'
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

export default function SupplierManager() {
  const { t } = useTranslation()

  const [suppliers, setSuppliers] = useState([])
  const [tourSupplierIds, setTourSupplierIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [filterCategory, setFilterCategory] = useState('all')
  const [search, setSearch] = useState('')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingId, setEditingId] = useState(null) // null = new
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  async function loadData() {
    setLoading(true)
    setError(null)

    const [suppliersRes, linksRes] = await Promise.all([
      supabase
        .from('suppliers')
        .select('id, name, category, contact_person, phone, line_id, address, notes, rating, is_active')
        .eq('org_id', ACTIVE_ORG_ID)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase.from('tour_suppliers').select('supplier_id').eq('tour_id', ACTIVE_TOUR_ID),
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

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = suppliers.filter((s) => {
      if (filterCategory !== 'all' && s.category !== filterCategory) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        (s.contact_person ?? '').toLowerCase().includes(q) ||
        (s.notes ?? '').toLowerCase().includes(q)
      )
    })
    // ที่ใช้ในทริปนี้ขึ้นก่อน แล้วเรียงตามชื่อ
    return filtered.sort((a, b) => {
      const aLinked = tourSupplierIds.has(a.id) ? 0 : 1
      const bLinked = tourSupplierIds.has(b.id) ? 0 : 1
      if (aLinked !== bLinked) return aLinked - bLinked
      return a.name.localeCompare(b.name)
    })
  }, [suppliers, filterCategory, search, tourSupplierIds])

  function openNew() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFormError(null)
    setSheetOpen(true)
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
    setFormError(null)
    setSheetOpen(true)
  }

  async function saveSupplier() {
    if (!draft.name.trim()) return
    setSaving(true)
    setFormError(null)

    try {
      const payload = {
        org_id: ACTIVE_ORG_ID,
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
        const { error } = await supabase.from('suppliers').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('suppliers').insert(payload).select('id').single()
        if (error) throw error
        supplierId = data.id
      }

      await setTripLink(supplierId, draft.linkToTrip)

      setSheetOpen(false)
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
      const { error } = await supabase
        .from('tour_suppliers')
        .insert({ tour_id: ACTIVE_TOUR_ID, supplier_id: supplierId })
      if (!error) {
        setTourSupplierIds((prev) => new Set(prev).add(supplierId))
      }
    } else if (!linked && isLinked) {
      const { error } = await supabase
        .from('tour_suppliers')
        .delete()
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('supplier_id', supplierId)
      if (!error) {
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
    const { error } = await supabase.from('suppliers').update({ rating }).eq('id', supplier.id)
    if (error) {
      console.error('[SupplierManager] update rating failed', error)
      loadData()
    }
  }

  async function deleteSupplier(supplier) {
    const confirmed = window.confirm(t('staff.supplierManager.confirmDelete', { name: supplier.name }))
    if (!confirmed) return
    setSuppliers((prev) => prev.filter((s) => s.id !== supplier.id))
    const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id)
    if (error) {
      console.error('[SupplierManager] delete failed', error)
      loadData()
    }
  }

  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: t(`staff.supplierManager.category.${c}`) }))

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.supplierManager.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('staff.supplierManager.subtitle')}</p>

        <button
          onClick={openNew}
          className="mt-3 w-full rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
        >
          + {t('staff.supplierManager.addSupplier')}
        </button>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('staff.supplierManager.searchPlaceholder')}
          className="mt-3 w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => setFilterCategory('all')}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              filterCategory === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {t('staff.supplierManager.filterAll')}
          </button>
          {categoryOptions.map((c) => (
            <button
              key={c.value}
              onClick={() => setFilterCategory(c.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                filterCategory === c.value ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {loading && <p className="mt-4 text-gray-500">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-red-500">{error}</p>}

        {!loading && !error && suppliers.length === 0 && (
          <p className="mt-4 text-sm text-gray-400">{t('staff.supplierManager.noSuppliers')}</p>
        )}
        {!loading && !error && suppliers.length > 0 && filteredSuppliers.length === 0 && (
          <p className="mt-4 text-sm text-gray-400">{t('staff.supplierManager.noResults')}</p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {filteredSuppliers.map((s) => {
            const linked = tourSupplierIds.has(s.id)
            return (
              <Card key={s.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900">{s.name}</p>
                      <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-600">
                        {t(`staff.supplierManager.category.${s.category}`)}
                      </span>
                    </div>
                    {s.contact_person && <p className="mt-0.5 text-sm text-gray-500">{s.contact_person}</p>}
                    {s.address && <p className="mt-0.5 text-xs text-gray-400">{s.address}</p>}
                  </div>
                  <button
                    onClick={() => setTripLink(s.id, !linked)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      linked ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {linked ? t('staff.supplierManager.usedInTrip') : t('staff.supplierManager.notUsedInTrip')}
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  {s.phone && (
                    <a href={`tel:${s.phone}`} className="text-sm font-medium text-sky-600">
                      📞 {s.phone}
                    </a>
                  )}
                  {s.line_id && (
                    <a
                      href={`https://line.me/ti/p/~${s.line_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-green-600"
                    >
                      💬 {s.line_id}
                    </a>
                  )}
                </div>

                {s.notes && <p className="mt-2 text-sm text-gray-600">{s.notes}</p>}

                <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                  <StarRating value={s.rating ?? ''} onChange={(v) => updateRating(s, Number(v))} size={18} />
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(s)} className="text-sm font-medium text-sky-600">
                      {t('staff.supplierManager.editSupplier')}
                    </button>
                    <button onClick={() => deleteSupplier(s)} className="text-sm font-medium text-red-500">
                      {t('staff.supplierManager.deleteSupplier')}
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editingId ? t('staff.supplierManager.editSupplier') : t('staff.supplierManager.addSupplier')}
      >
        <div className="flex flex-col gap-3">
          <TextField
            label={t('staff.supplierManager.name')}
            required
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          />
          <SelectField
            label={t('staff.supplierManager.categoryLabel')}
            options={categoryOptions}
            value={draft.category}
            onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
          />
          <TextField
            label={t('staff.supplierManager.contactPerson')}
            value={draft.contact_person}
            onChange={(e) => setDraft((prev) => ({ ...prev, contact_person: e.target.value }))}
          />
          <TextField
            label={t('staff.supplierManager.phone')}
            type="tel"
            value={draft.phone}
            onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
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

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={draft.linkToTrip}
              onChange={(e) => setDraft((prev) => ({ ...prev, linkToTrip: e.target.checked }))}
              className="h-5 w-5 rounded border-gray-300 text-brand focus:ring-brand-light"
            />
            <span className="text-sm font-medium text-neutral-text">{t('staff.supplierManager.linkToTrip')}</span>
          </label>

          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <Button onClick={saveSupplier} disabled={saving || !draft.name.trim()}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => setSheetOpen(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
