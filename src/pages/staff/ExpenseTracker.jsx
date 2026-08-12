import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveTourId } from '../../lib/staffSession'
import { enqueue, getQueue, removeFromQueue } from '../../lib/offlineQueue'
import Card from '../../components/common/Card'
import StaffHeader from '../../components/common/StaffHeader'
import QuickAdd from './expense/QuickAdd'
import BatchAdd from './expense/BatchAdd'
import {
  CATEGORIES,
  localDateString,
  readExpensePrefs,
  writeExpensePrefs,
} from './expense/expenseHelpers'

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

// ⚠️ เดิมฟังก์ชันนี้อ้าง `tourId` ที่อยู่ในคอมโพเนนต์ ทั้งที่ตัวเองเป็นฟังก์ชันระดับโมดูล
// ผลคือทุกครั้งที่แนบรูปใบเสร็จจะโยน ReferenceError → ตกเข้า catch → รายการถูกดันลง
// offline queue เงียบๆ ผู้ใช้เห็นฟอร์มเคลียร์เหมือนบันทึกสำเร็จ แต่ของค้างคิว retry ไม่จบ
// รับ tourId เป็นพารามิเตอร์แทน
async function uploadReceipt(tourId, blob) {
  const path = `${tourId}/${Date.now()}.jpg`
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
  const tourId = useActiveTourId()
  const { t } = useTranslation()
  // ⚠️ getStaffSession() คืน session ทั้งก้อน { staff, orgRole, activeTourId, ... }
  //    ไม่ใช่แถว staff — โค้ดเดิมอ่าน staffSession?.id ซึ่งเป็น undefined เสมอ
  //    ผลคือ paid_by/created_by ถูกบันทึกเป็น null ทุกใบตั้งแต่ต้น และช่องคนจ่ายขึ้น "—"
  const me = getStaffSession()?.staff ?? null

  const [expenses, setExpenses] = useState([])
  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)

  const [mode, setMode] = useState('quick')
  const [saving, setSaving] = useState(false)
  // รายการที่เพิ่งบันทึก ไว้ให้กด "เลิกทำ" — แทนที่จะให้ผู้ใช้ไปหาแล้วกดลบทีละอัน
  // การพิมพ์เลขผิดหลักคือความผิดพลาดที่เกิดบ่อยสุดตอนลงเร็วๆ ต้องถอยกลับได้ทันที
  const [lastSaved, setLastSaved] = useState(null)
  const undoTimer = useRef(null)
  const listRef = useRef(null)

  const prefs = useMemo(() => readExpensePrefs(tourId), [tourId])
  const [draft, setDraft] = useState(() => ({
    amount: '',
    category: prefs.category ?? CATEGORIES[0],
    description: '',
    // คนจ่ายคือบัญชีที่ล็อกอินอยู่เสมอ — ไม่จำค่าล่าสุดไว้ทับ เพราะถ้าเคยเลือกเป็นคนอื่น
    // ครั้งเดียว รายการที่ลงหลังจากนั้นทั้งหมดจะติดชื่อผิดคนโดยไม่มีใครสังเกต
    paid_by: me?.id ?? null,
    expense_date: localDateString(),
    photoFile: null,
  }))

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
        .eq('tour_id', tourId)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('v_tour_staff').select('id, name').eq('tour_id', tourId),
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
          receiptUrl = await uploadReceipt(action.tour_id, dataUrlToBlob(action.receiptDataUrl))
        }
        const { error: insertError } = await supabase.from('expenses').insert({
          tour_id: action.tour_id,
          amount: action.amount,
          category: action.category,
          description: action.description,
          paid_by: action.paid_by,
          expense_date: action.expense_date,
          created_by: action.created_by,
          receipt_url: receiptUrl,
        })
        if (insertError) throw insertError
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
      if (undoTimer.current) clearTimeout(undoTimer.current)
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

  // ยอดของ "วันที่กำลังลงอยู่" ไม่ใช่ยอดทั้งทริป — ตอนลงย้อนหลังตอนเย็นต้องรู้ว่า
  // วันนั้นลงไปแล้วเท่าไร เพื่อกระทบกับใบเสร็จในมือ ยอดทั้งทริปดูตอนสรุปพอ
  const todayTotal = useMemo(
    () =>
      expenses
        .filter((e) => e.expense_date === draft.expense_date)
        .reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [expenses, draft.expense_date]
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

  function showUndo(rows) {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setLastSaved(rows)
    undoTimer.current = setTimeout(() => setLastSaved(null), 8000)
  }

  async function undoLastSave() {
    if (!lastSaved?.length) return
    const ids = lastSaved.map((r) => r.id)
    setLastSaved(null)
    setExpenses((prev) => prev.filter((e) => !ids.includes(e.id)))
    const { error: delError } = await supabase.from('expenses').delete().in('id', ids)
    if (delError) {
      console.error('[ExpenseTracker] undo failed', delError)
      loadExpenses({ showSpinner: false })
    }
  }

  /**
   * บันทึกรายการ (หนึ่งหรือหลายรายการ) — ใช้ร่วมกันทั้งโหมดเร็วและโหมดหลายรายการ
   * ออฟไลน์หรือพังกลางทาง → ลงคิวไว้ทั้งชุด แล้ว retry เองทุก 15 วิ
   */
  async function persist(entries, photoFile) {
    setSaving(true)
    const payloads = entries.map((e) => ({
      tour_id: tourId,
      amount: e.amount,
      category: e.category,
      description: e.description ?? null,
      paid_by: e.paid_by || null,
      expense_date: e.expense_date,
      created_by: me?.id ?? null,
    }))

    // จำหมวดที่เพิ่งใช้ไว้เป็นค่าตั้งต้นครั้งหน้า (ไม่จำคนจ่าย — ยึดบัญชีที่ล็อกอินเสมอ)
    writeExpensePrefs(tourId, { category: entries[entries.length - 1].category })

    let compressed = null
    try {
      if (photoFile) compressed = await compressImage(photoFile)

      if (!navigator.onLine) {
        for (const p of payloads) {
          enqueue({ type: 'expense', dedupeKey: makeId(), ...p, receiptDataUrl: compressed?.dataUrl ?? null })
        }
        refreshPendingCount()
        return
      }

      let receiptUrl = null
      if (compressed) receiptUrl = await uploadReceipt(tourId, compressed.blob)

      const { data, error: insertError } = await supabase
        .from('expenses')
        .insert(payloads.map((p, i) => ({ ...p, receipt_url: i === 0 ? receiptUrl : null })))
        .select('id, amount, category, description, receipt_url, paid_by, expense_date, created_by, created_at')
      if (insertError) throw insertError

      // เติมลิสต์ทันทีแทนการโหลดใหม่ทั้งหน้า — ลงรายการรัวๆ จะได้ไม่กระพริบทุกครั้ง
      setExpenses((prev) => [...(data ?? []), ...prev])
      if (data?.length) showUndo(data)
    } catch (err) {
      console.error('[ExpenseTracker] save failed — queued for retry', err)
      for (const p of payloads) {
        enqueue({ type: 'expense', dedupeKey: makeId(), ...p, receiptDataUrl: compressed?.dataUrl ?? null })
      }
      refreshPendingCount()
    } finally {
      setSaving(false)
    }
  }

  async function deleteExpense(expense) {
    const confirmed = window.confirm(t('staff.expenseTracker.confirmDelete'))
    if (!confirmed) return
    setExpenses((prev) => prev.filter((e) => e.id !== expense.id))
    const { error: delError } = await supabase.from('expenses').delete().eq('id', expense.id)
    if (delError) {
      console.error('[ExpenseTracker] delete failed', delError)
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

  const categoryOptions = CATEGORIES.map((c) => ({
    value: c,
    label: t(`staff.expenseTracker.category.${c}`),
  }))

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader icon="wallet" title={t('staff.expenseTracker.title')} />
      <div className="mx-auto max-w-md px-4">
        {loading && <p className="pt-4 text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="pt-4 text-danger">{error}</p>}

        {!loading && !error && (
          <>
            {/* จอแรก = ช่องลงรายการอย่างเดียว สูงพอดีหนึ่งวิวพอร์ต ไม่ต้องเลื่อน
                (100dvh ไม่ใช่ 100vh — บนมือถือ 100vh นับรวมแถบที่อยู่เว็บของเบราว์เซอร์
                ที่ยุบเข้าออกได้ ปุ่มบันทึกเลยหลุดใต้ขอบจอตอนแถบยังกางอยู่)
                รายการที่ลงไปแล้วอยู่หน้าถัดไป เลื่อนลงดูได้ — งานหลักคือ "ลง" ไม่ใช่ "ดู" */}
            <section className="flex h-[calc(100dvh-3.5rem)] flex-col gap-3 py-3">
              <div className="flex shrink-0 items-baseline justify-between">
                <p className="text-lg font-bold text-ink">{t('staff.expenseTracker.todayLabel')}</p>
                <button
                  onClick={() => listRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="text-sm font-semibold text-ink-muted"
                >
                  {t('staff.expenseTracker.todayTotal', { amount: todayTotal.toLocaleString() })}
                </button>
              </div>

              <div className="flex shrink-0 gap-1 rounded-control bg-surface-sunken p-1">
                {[
                  { id: 'quick', label: t('staff.expenseTracker.modeQuick') },
                  { id: 'batch', label: t('staff.expenseTracker.modeBatch') },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    aria-pressed={mode === m.id}
                    className={`flex-1 rounded-control px-3 py-1.5 text-sm font-semibold transition ${
                      mode === m.id ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {mode === 'quick' ? (
                <QuickAdd
                  staffList={staffList}
                  me={me}
                  draft={draft}
                  onDraftChange={setDraft}
                  saving={saving}
                  onSubmit={(entry) => persist([entry], entry.photoFile)}
                />
              ) : (
                <BatchAdd
                  staffList={staffList}
                  me={me}
                  defaults={draft}
                  saving={saving}
                  onSubmit={(entries) => persist(entries)}
                />
              )}

              {!navigator.onLine && (
                <p className="shrink-0 text-xs text-warning-text">
                  {t('staff.expenseTracker.queuedNotice')}
                </p>
              )}
              {pendingCount > 0 && (
                <p className="shrink-0 text-xs text-warning-text">
                  {t('staff.expenseTracker.pendingSync', { count: pendingCount })}
                </p>
              )}
            </section>

            {/* สรุปรวมทั้งทริป */}
            <div ref={listRef} className="h-3 scroll-mt-3" />
            <Card>
              <p className="text-sm text-ink-muted">{t('staff.expenseTracker.totalLabel')}</p>
              <p className="mt-0.5 text-3xl font-extrabold text-ink">
                {totalAmount.toLocaleString()}{' '}
                <span className="text-base font-semibold text-ink-faint">฿</span>
              </p>
              {totalsByCategory.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5 border-t border-line-subtle pt-3">
                  <p className="text-xs font-semibold uppercase text-ink-faint">
                    {t('staff.expenseTracker.byCategoryLabel')}
                  </p>
                  {totalsByCategory.map((c) => (
                    <div key={c.category} className="flex items-center justify-between text-sm">
                      <span className="text-ink-muted">
                        {t(`staff.expenseTracker.category.${c.category}`)}
                      </span>
                      <span className="font-semibold text-ink">{c.total.toLocaleString()} ฿</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ตัวกรอง */}
            <div className="mt-4 flex flex-wrap gap-2">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm"
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
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm"
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
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm"
              />
              {(filterCategory !== 'all' || filterPaidBy !== 'all' || filterDate) && (
                <button
                  onClick={() => {
                    setFilterCategory('all')
                    setFilterPaidBy('all')
                    setFilterDate('')
                  }}
                  className="text-sm font-medium text-brand"
                >
                  {t('staff.expenseTracker.clearFilters')}
                </button>
              )}
              <button
                onClick={handleExportCsv}
                disabled={expenses.length === 0}
                className="ml-auto text-sm font-semibold text-brand disabled:opacity-40"
              >
                {t('staff.expenseTracker.exportCsv')}
              </button>
            </div>

            {/* ลิสต์รายจ่าย — เผื่อที่ท้ายไว้ให้แถบเลิกทำที่ลอยอยู่ล่างจอ */}
            <div className="mt-3 flex flex-col gap-2 pb-24">
              {expenses.length === 0 && (
                <p className="text-sm text-ink-faint">{t('staff.expenseTracker.noExpenses')}</p>
              )}
              {expenses.length > 0 && filteredExpenses.length === 0 && (
                <p className="text-sm text-ink-faint">{t('staff.expenseTracker.noResults')}</p>
              )}
              {filteredExpenses.map((e) => (
                <Card key={e.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-brand-lighter px-2 py-0.5 text-[11px] font-semibold text-brand">
                          {t(`staff.expenseTracker.category.${e.category}`)}
                        </span>
                        <span className="text-xs text-ink-faint">{e.expense_date}</span>
                      </div>
                      {e.description && (
                        <p className="mt-1 text-sm text-neutral-text">{e.description}</p>
                      )}
                      {e.paid_by && staffById[e.paid_by] && (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {t('staff.expenseTracker.paidBy')}: {staffById[e.paid_by].name}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 font-bold text-ink">
                      {Number(e.amount).toLocaleString()} ฿
                    </p>
                  </div>
                  <div className="mt-2 flex items-center gap-3 border-t border-line-subtle pt-2">
                    {e.receipt_url && (
                      <a
                        href={e.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-brand"
                      >
                        {t('staff.expenseTracker.viewReceipt')}
                      </a>
                    )}
                    <button
                      onClick={() => deleteExpense(e)}
                      className="text-sm font-medium text-danger"
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

      {/* แถบเลิกทำ — ลอยล่างจอ หายเองใน 8 วิ ไม่บังปุ่มบันทึก */}
      {lastSaved?.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-card bg-ink px-4 py-3 text-surface shadow-lg">
          <span className="text-sm">
            {t('staff.expenseTracker.savedToast', { count: lastSaved.length })}
          </span>
          <button onClick={undoLastSave} className="text-sm font-bold underline">
            {t('staff.expenseTracker.undo')}
          </button>
        </div>
      )}
    </div>
  )
}
