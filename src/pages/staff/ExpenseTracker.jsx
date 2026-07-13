import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getStaffSession } from '../../lib/staffSession'
import { enqueue, getQueue, removeFromQueue } from '../../lib/offlineQueue'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import SelectField from '../../components/common/SelectField'

const CATEGORIES = ['food', 'transport', 'accommodation', 'entrance', 'tip', 'misc']

const EMPTY_DRAFT = {
  amount: '',
  category: 'food',
  description: '',
  paid_by: '',
  expense_date: new Date().toISOString().slice(0, 10),
}

function csvEscape(value) {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// บีบอัดรูปฝั่ง client ก่อนอัปโหลด (เหมือน pattern ใน GuideBuilder/LuggageManager)
// คืนทั้ง blob (อัปตอน online) และ dataUrl (เก็บลง offline queue ตอน offline เพราะ localStorage เก็บได้แค่ string)
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onload = (e) => {
      img.onload = () => {
        const maxDim = 800
        let { width, height } = img
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        canvas.toBlob((blob) => resolve({ blob, dataUrl }), 'image/jpeg', 0.7)
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/data:(.*);base64/)?.[1] ?? 'image/jpeg'
  const binary = atob(base64)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
  return new Blob([array], { type: mime })
}

async function uploadReceipt(blob) {
  const path = `${ACTIVE_TOUR_ID}/${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from('receipt-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('receipt-photos').getPublicUrl(path)
  return data.publicUrl
}

function makeId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function ExpenseTracker() {
  const { t } = useTranslation()
  const staffSession = getStaffSession()

  const [expenses, setExpenses] = useState([])
  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)

  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const fileInputRef = useRef(null)

  const [filterCategory, setFilterCategory] = useState('all')
  const [filterPaidBy, setFilterPaidBy] = useState('all')
  const [filterDate, setFilterDate] = useState('')

  // showSpinner=false ใช้ตอน refresh เงียบๆ หลัง sync คิว — ไม่งั้นทุก 15 วิที่ interval เช็คคิว
  // จะสั่ง setLoading(true) ทำให้ทั้งฟอร์ม+ลิสต์หายไปโชว์ "กำลังโหลด..." ชั่วครู่ ดูเหมือนหน้า refresh ตลอด
  async function loadExpenses({ showSpinner = true } = {}) {
    if (showSpinner) setLoading(true)
    setError(null)

    const [expensesRes, staffRes] = await Promise.all([
      supabase
        .from('expenses')
        .select('id, amount, category, description, receipt_url, paid_by, expense_date, created_by, created_at')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('staff').select('id, name').eq('tour_id', ACTIVE_TOUR_ID),
    ])

    if (expensesRes.error) {
      console.error('[ExpenseTracker] load failed', expensesRes.error)
      setError(t('common.error'))
      if (showSpinner) setLoading(false)
      return
    }

    setExpenses(expensesRes.data ?? [])
    if (!staffRes.error) setStaffList(staffRes.data ?? [])
    if (showSpinner) setLoading(false)
  }

  function refreshPendingCount() {
    setPendingCount(getQueue().filter((a) => a.type === 'expense').length)
  }

  async function flushQueue() {
    const queue = getQueue().filter((a) => a.type === 'expense')
    if (queue.length === 0) return // ไม่มีอะไรต้อง sync — ไม่ต้อง reload ข้อมูลซ้ำๆ ทุก 15 วิ

    let syncedAny = false
    for (const action of queue) {
      try {
        let receiptUrl = null
        if (action.receiptDataUrl) {
          receiptUrl = await uploadReceipt(dataUrlToBlob(action.receiptDataUrl))
        }
        const { error } = await supabase.from('expenses').insert({
          tour_id: action.tour_id,
          amount: action.amount,
          category: action.category,
          description: action.description,
          paid_by: action.paid_by,
          expense_date: action.expense_date,
          created_by: action.created_by,
          receipt_url: receiptUrl,
        })
        if (error) throw error
        removeFromQueue(action.id)
        syncedAny = true
      } catch (err) {
        console.error('[ExpenseTracker] flush failed — will retry later', action.id, err)
      }
    }
    refreshPendingCount()
    if (syncedAny) loadExpenses({ showSpinner: false })
  }

  useEffect(() => {
    loadExpenses()
    refreshPendingCount()
    flushQueue()

    function handleOnline() {
      flushQueue()
    }
    window.addEventListener('online', handleOnline)

    const retryInterval = setInterval(() => {
      if (navigator.onLine) flushQueue()
    }, 15000)

    return () => {
      window.removeEventListener('online', handleOnline)
      clearInterval(retryInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const staffById = useMemo(() => {
    const map = {}
    for (const s of staffList) map[s.id] = s
    return map
  }, [staffList])

  const totalAmount = useMemo(
    () => expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [expenses]
  )

  const totalsByCategory = useMemo(() => {
    const totals = {}
    for (const e of expenses) {
      totals[e.category] = (totals[e.category] ?? 0) + Number(e.amount || 0)
    }
    return CATEGORIES.map((c) => ({ category: c, total: totals[c] ?? 0 })).filter((c) => c.total > 0)
  }, [expenses])

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (filterCategory !== 'all' && e.category !== filterCategory) return false
      if (filterPaidBy !== 'all' && e.paid_by !== filterPaidBy) return false
      if (filterDate && e.expense_date !== filterDate) return false
      return true
    })
  }, [expenses, filterCategory, filterPaidBy, filterDate])

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function resetForm() {
    setDraft(EMPTY_DRAFT)
    setPhotoFile(null)
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)

    const amountNum = Number(draft.amount)
    if (!draft.amount || Number.isNaN(amountNum) || amountNum <= 0) {
      setFormError(t('staff.expenseTracker.amountError'))
      return
    }

    setSaving(true)

    const basePayload = {
      tour_id: ACTIVE_TOUR_ID,
      amount: amountNum,
      category: draft.category,
      description: draft.description.trim() || null,
      paid_by: draft.paid_by || null,
      expense_date: draft.expense_date,
      created_by: staffSession?.id ?? null,
    }

    let compressed = null
    try {
      if (photoFile) compressed = await compressImage(photoFile)

      if (!navigator.onLine) {
        enqueue({ type: 'expense', dedupeKey: makeId(), ...basePayload, receiptDataUrl: compressed?.dataUrl ?? null })
        refreshPendingCount()
        resetForm()
        return
      }

      let receiptUrl = null
      if (compressed) receiptUrl = await uploadReceipt(compressed.blob)

      const { error } = await supabase.from('expenses').insert({ ...basePayload, receipt_url: receiptUrl })
      if (error) throw error

      resetForm()
      loadExpenses()
    } catch (err) {
      console.error('[ExpenseTracker] save failed — queued for retry', err)
      enqueue({ type: 'expense', dedupeKey: makeId(), ...basePayload, receiptDataUrl: compressed?.dataUrl ?? null })
      refreshPendingCount()
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  async function deleteExpense(expense) {
    const confirmed = window.confirm(t('staff.expenseTracker.confirmDelete'))
    if (!confirmed) return
    setExpenses((prev) => prev.filter((e) => e.id !== expense.id))
    const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
    if (error) {
      console.error('[ExpenseTracker] delete failed', error)
      loadExpenses()
    }
  }

  function handleExportCsv() {
    const header = [
      t('staff.expenseTracker.csvDate'),
      t('staff.expenseTracker.csvCategory'),
      t('staff.expenseTracker.csvAmount'),
      t('staff.expenseTracker.csvDescription'),
      t('staff.expenseTracker.csvPaidBy'),
      t('staff.expenseTracker.csvCreatedBy'),
      t('staff.expenseTracker.csvReceiptUrl'),
    ]
    const rows = [header]
    for (const e of expenses) {
      rows.push([
        e.expense_date,
        t(`staff.expenseTracker.category.${e.category}`),
        e.amount,
        e.description ?? '',
        staffById[e.paid_by]?.name ?? '',
        staffById[e.created_by]?.name ?? '',
        e.receipt_url ?? '',
      ])
    }
    downloadCsv('expenses.csv', rows)
  }

  // SelectField เติม option ว่างเปล่า ("—") ให้เองแล้ว — ไม่ต้องเติมซ้ำ
  const staffOptions = staffList.map((s) => ({ value: s.id, label: s.name }))
  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: t(`staff.expenseTracker.category.${c}`) }))

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.expenseTracker.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('staff.expenseTracker.subtitle')}</p>

        {loading && <p className="mt-4 text-gray-500">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            {/* สรุปรวมทั้งทริป */}
            <Card className="mt-4">
              <p className="text-sm text-gray-500">{t('staff.expenseTracker.totalLabel')}</p>
              <p className="mt-0.5 text-3xl font-extrabold text-gray-900">
                {totalAmount.toLocaleString()} <span className="text-base font-semibold text-gray-400">฿</span>
              </p>
              {totalsByCategory.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5 border-t border-gray-100 pt-3">
                  <p className="text-xs font-semibold uppercase text-gray-400">
                    {t('staff.expenseTracker.byCategoryLabel')}
                  </p>
                  {totalsByCategory.map((c) => (
                    <div key={c.category} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{t(`staff.expenseTracker.category.${c.category}`)}</span>
                      <span className="font-semibold text-gray-900">{c.total.toLocaleString()} ฿</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ฟอร์มบันทึกเร็ว */}
            <Card className="mt-4">
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <TextField
                  label={t('staff.expenseTracker.amount')}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={draft.amount}
                  onChange={(e) => setDraft((prev) => ({ ...prev, amount: e.target.value }))}
                />
                <SelectField
                  label={t('staff.expenseTracker.categoryLabel')}
                  options={categoryOptions}
                  value={draft.category}
                  onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
                />
                <TextAreaField
                  label={t('staff.expenseTracker.description')}
                  placeholder={t('staff.expenseTracker.descriptionPlaceholder')}
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                />
                <SelectField
                  label={t('staff.expenseTracker.paidBy')}
                  options={staffOptions}
                  value={draft.paid_by}
                  onChange={(e) => setDraft((prev) => ({ ...prev, paid_by: e.target.value }))}
                />
                <TextField
                  label={t('staff.expenseTracker.expenseDate')}
                  type="date"
                  value={draft.expense_date}
                  onChange={(e) => setDraft((prev) => ({ ...prev, expense_date: e.target.value }))}
                />

                <div>
                  <p className="mb-1.5 text-sm font-semibold text-gray-700">{t('staff.expenseTracker.receiptPhoto')}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-xl bg-gray-100 px-3 py-2.5 text-sm font-semibold text-gray-700"
                  >
                    {t('staff.expenseTracker.takePhoto')}
                  </button>
                  {photoPreview && (
                    <img src={photoPreview} alt="preview" className="mt-2 h-32 w-full rounded-xl object-cover" />
                  )}
                </div>

                {formError && <p className="text-sm text-red-500">{formError}</p>}

                <Button type="submit" disabled={saving}>
                  {saving ? t('staff.expenseTracker.saving') : t('staff.expenseTracker.addExpense')}
                </Button>

                {!navigator.onLine && (
                  <p className="text-xs text-amber-700">{t('staff.expenseTracker.queuedNotice')}</p>
                )}
                {pendingCount > 0 && (
                  <p className="text-xs text-amber-700">
                    {t('staff.expenseTracker.pendingSync', { count: pendingCount })}
                  </p>
                )}
              </form>
            </Card>

            {/* ตัวกรอง */}
            <div className="mt-4 flex flex-wrap gap-2">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="all">{t('staff.expenseTracker.filterAll')}</option>
                {categoryOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={filterPaidBy}
                onChange={(e) => setFilterPaidBy(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="all">{t('staff.expenseTracker.filterAll')}</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm"
              />
              {(filterCategory !== 'all' || filterPaidBy !== 'all' || filterDate) && (
                <button
                  onClick={() => {
                    setFilterCategory('all')
                    setFilterPaidBy('all')
                    setFilterDate('')
                  }}
                  className="text-sm font-medium text-sky-600"
                >
                  {t('staff.expenseTracker.clearFilters')}
                </button>
              )}
              <button
                onClick={handleExportCsv}
                disabled={expenses.length === 0}
                className="ml-auto text-sm font-semibold text-sky-600 disabled:opacity-40"
              >
                {t('staff.expenseTracker.exportCsv')}
              </button>
            </div>

            {/* ลิสต์รายจ่าย */}
            <div className="mt-3 flex flex-col gap-2">
              {expenses.length === 0 && (
                <p className="text-sm text-gray-400">{t('staff.expenseTracker.noExpenses')}</p>
              )}
              {expenses.length > 0 && filteredExpenses.length === 0 && (
                <p className="text-sm text-gray-400">{t('staff.expenseTracker.noResults')}</p>
              )}
              {filteredExpenses.map((e) => (
                <Card key={e.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-600">
                          {t(`staff.expenseTracker.category.${e.category}`)}
                        </span>
                        <span className="text-xs text-gray-400">{e.expense_date}</span>
                      </div>
                      {e.description && <p className="mt-1 text-sm text-gray-700">{e.description}</p>}
                      {e.paid_by && staffById[e.paid_by] && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {t('staff.expenseTracker.paidBy')}: {staffById[e.paid_by].name}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 font-bold text-gray-900">{Number(e.amount).toLocaleString()} ฿</p>
                  </div>
                  <div className="mt-2 flex items-center gap-3 border-t border-gray-100 pt-2">
                    {e.receipt_url && (
                      <a
                        href={e.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-sky-600"
                      >
                        {t('staff.expenseTracker.viewReceipt')}
                      </a>
                    )}
                    <button
                      onClick={() => deleteExpense(e)}
                      className="text-sm font-medium text-red-500"
                    >
                      {t('staff.expenseTracker.deleteExpense')}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
