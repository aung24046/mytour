import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CATEGORIES,
  appendAmountKey,
  parseAmount,
  parsePastedRows,
  payerOptions,
  localDateString,
  shiftDate,
} from './expenseHelpers'
import AmountField from './AmountField'
import { selectArrowStyle } from './controls'

function makeKey() {
  return `e${Date.now()}${Math.random().toString(36).slice(2, 6)}`
}

// โหมดลงหลายรายการแบบ "ตะกร้าตามหมวด" — สำหรับตอนเย็นที่มีใบเสร็จค้างทั้งวัน
//
// ทำไมแยกตามหมวดแทนที่จะเป็นตาราง: การลงย้อนหลังทั้งวันคือการไล่กองใบเสร็จ ซึ่งคน
// แยกกองตามประเภทอยู่แล้วโดยธรรมชาติ (ค่ารถกองหนึ่ง ค่าอาหารกองหนึ่ง) พอลงเรียงตามหมวด
// จึงไม่ต้องเลือกหมวดใหม่ทุกบรรทัด — ซึ่งเป็นจังหวะที่เสียเวลาที่สุดในตารางแบบเดิม
// ผลพลอยได้คือเห็นยอดสะสมรายหมวดทันที ตรงกับตัวเลขที่บัญชีถามตอนปิดทริปพอดี
//
// วันที่กับคนจ่ายยกขึ้นไปตั้งร่วมกันข้างบน เพราะทั้งชุดมักเป็นวันเดียวคนเดียว
export default function BatchAdd({ staffList, me, defaults, onSubmit, saving }) {
  const { t } = useTranslation()
  const payers = useMemo(() => payerOptions(staffList, me), [staffList, me])
  const today = localDateString()
  const yesterday = shiftDate(today, -1)

  const [expenseDate, setExpenseDate] = useState(defaults.expense_date ?? today)
  const [paidBy, setPaidBy] = useState(defaults.paid_by ?? null)
  const [entries, setEntries] = useState([])
  const [openCategory, setOpenCategory] = useState(null)
  // ช่องที่กำลังพิมพ์อยู่ — editingKey ว่าง = กำลังเพิ่มรายการใหม่
  const [buffer, setBuffer] = useState({ amount: '', description: '', editingKey: null })
  const [useDeviceKeyboard, setUseDeviceKeyboard] = useState(false)
  const [error, setError] = useState(null)
  const openCardRef = useRef(null)
  const amountRef = useRef(null)

  const total = entries.reduce((sum, e) => sum + e.amount, 0)
  const bufferValue = parseAmount(buffer.amount)

  const byCategory = useMemo(() => {
    const map = Object.fromEntries(CATEGORIES.map((c) => [c, []]))
    for (const e of entries) (map[e.category] ??= []).push(e)
    return map
  }, [entries])

  function openBucket(category) {
    setOpenCategory(category)
    setBuffer({ amount: '', description: '', editingKey: null })
    setError(null)
    // การ์ดที่กางออกสูงกว่าเดิมมาก ถ้าอยู่ท้ายจอจะโดนดันตกขอบ
    // แล้วโฟกัสช่องยอดทันที เพื่อให้คีย์บอร์ดจริงบนคอมพิมพ์ต่อได้โดยไม่ต้องคลิกซ้ำ
    requestAnimationFrame(() => {
      openCardRef.current?.scrollIntoView({ block: 'nearest' })
      amountRef.current?.focus({ preventScroll: true })
    })
  }

  function press(key) {
    setError(null)
    setBuffer((b) => ({ ...b, amount: appendAmountKey(b.amount, key) }))
  }

  function commit() {
    if (bufferValue == null) {
      setError(t('staff.expenseTracker.amountError'))
      return
    }
    const description = buffer.description.trim()

    setEntries((prev) =>
      buffer.editingKey
        ? prev.map((e) =>
            e.key === buffer.editingKey ? { ...e, amount: bufferValue, description } : e
          )
        : [...prev, { key: makeKey(), category: openCategory, amount: bufferValue, description }]
    )
    setBuffer({ amount: '', description: '', editingKey: null })
    // ลงเสร็จแล้วเคอร์เซอร์กลับมาที่ยอด พร้อมพิมพ์รายการถัดไปในหมวดเดิมทันที
    amountRef.current?.focus({ preventScroll: true })
  }

  function editEntry(entry) {
    setOpenCategory(entry.category)
    setBuffer({
      amount: String(entry.amount),
      description: entry.description,
      editingKey: entry.key,
    })
  }

  function removeEntry(key) {
    setEntries((prev) => prev.filter((e) => e.key !== key))
    setBuffer((b) => (b.editingKey === key ? { amount: '', description: '', editingKey: null } : b))
  }

  /** วางจากชีต/โน้ตได้ทั้งก้อน — ลงเข้าหมวดที่กางอยู่ทั้งหมด ไม่ต้องพิมพ์ใหม่ทีละบรรทัด */
  function handlePaste(e) {
    const text = e.clipboardData?.getData('text') ?? ''
    if (!/[\n\t]/.test(text)) return

    const incoming = parsePastedRows(text)
    if (incoming.length === 0) return

    e.preventDefault()
    setEntries((prev) => [
      ...prev,
      ...incoming.map((item) => ({
        key: makeKey(),
        category: openCategory,
        amount: item.amount,
        description: item.description,
      })),
    ])
    setBuffer({ amount: '', description: '', editingKey: null })
  }

  async function handleSave() {
    if (entries.length === 0) {
      setError(t('staff.expenseTracker.amountError'))
      return
    }
    setError(null)
    await onSubmit(
      entries.map((e) => ({
        amount: e.amount,
        category: e.category,
        description: e.description || null,
        paid_by: paidBy || null,
        expense_date: expenseDate,
      }))
    )
    setEntries([])
    setOpenCategory(null)
    setBuffer({ amount: '', description: '', editingKey: null })
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'backspace', '0', 'commit']

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* วันที่ + คนจ่าย ของทั้งชุด */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setExpenseDate(today)}
          aria-pressed={expenseDate === today}
          className={`h-9 rounded-control px-3 text-sm font-semibold ${
            expenseDate === today ? 'bg-ink text-surface' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          {t('staff.expenseTracker.today')}
        </button>
        <button
          type="button"
          onClick={() => setExpenseDate(yesterday)}
          aria-pressed={expenseDate === yesterday}
          className={`h-9 rounded-control px-3 text-sm font-semibold ${
            expenseDate === yesterday ? 'bg-ink text-surface' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          {t('staff.expenseTracker.yesterday')}
        </button>
        <input
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          aria-label={t('staff.expenseTracker.expenseDate')}
          className="h-9 w-[7.5rem] rounded-control bg-surface-sunken px-2 text-sm text-ink-muted"
        />
        <select
          value={paidBy ?? ''}
          onChange={(e) => setPaidBy(e.target.value || null)}
          aria-label={t('staff.expenseTracker.paidBy')}
          style={selectArrowStyle}
          className="ml-auto h-9 max-w-[7rem] appearance-none rounded-control bg-surface-sunken bg-[length:0.6rem] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-6 text-sm text-ink-muted"
        >
          <option value="">—</option>
          {payers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <p className="shrink-0 text-xs text-ink-faint">{t('staff.expenseTracker.bucketHint')}</p>

      {/* ตะกร้ารายหมวด — ที่กางอยู่มีแป้นในตัว ที่เหลือยุบเหลือบรรทัดเดียว */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {CATEGORIES.map((category) => {
          const items = byCategory[category] ?? []
          const sum = items.reduce((s, e) => s + e.amount, 0)
          const isOpen = openCategory === category

          return (
            <div
              key={category}
              ref={isOpen ? openCardRef : null}
              className={`shrink-0 rounded-card p-3 transition ${
                isOpen ? 'bg-surface ring-1 ring-brand' : 'bg-surface-sunken'
              }`}
            >
              <button
                type="button"
                onClick={() => (isOpen ? setOpenCategory(null) : openBucket(category))}
                className="flex w-full items-center justify-between gap-2"
              >
                <span className="text-[15px] font-semibold text-ink">
                  {t(`staff.expenseTracker.category.${category}`)}
                </span>
                <span className={`text-sm ${sum > 0 ? 'font-bold text-ink' : 'text-ink-faint'}`}>
                  {sum > 0
                    ? `${sum.toLocaleString()} ฿`
                    : isOpen
                      ? ''
                      : t('staff.expenseTracker.bucketAdd')}
                </span>
              </button>

              {/* รายการที่ลงแล้วในหมวดนี้ — แตะเพื่อแก้ กด × เพื่อลบ */}
              {items.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {items.map((e) => (
                    <span
                      key={e.key}
                      className={`flex items-center gap-1 rounded-control px-2 py-1 text-xs ${
                        buffer.editingKey === e.key
                          ? 'bg-brand text-white'
                          : 'bg-surface text-ink-muted ring-1 ring-line'
                      }`}
                    >
                      <button type="button" onClick={() => editEntry(e)} className="font-semibold">
                        {e.amount.toLocaleString()}
                        {e.description && (
                          <span className="font-normal opacity-80"> · {e.description}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(e.key)}
                        aria-label={t('staff.expenseTracker.bucketDelete')}
                        className="opacity-60"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {!isOpen && (
                    <button
                      type="button"
                      onClick={() => openBucket(category)}
                      className="rounded-control border border-dashed border-line px-2 py-1 text-xs text-ink-faint"
                    >
                      {t('staff.expenseTracker.bucketAdd')}
                    </button>
                  )}
                </div>
              )}

              {/* ช่องพิมพ์ของหมวดที่กางอยู่ */}
              {isOpen && (
                <div className="mt-2 border-t border-line-subtle pt-2">
                  <AmountField
                    inputRef={amountRef}
                    size="sm"
                    value={buffer.amount}
                    onChange={(amount) => setBuffer((b) => ({ ...b, amount }))}
                    onEnter={commit}
                    useDeviceKeyboard={useDeviceKeyboard}
                    onToggleKeyboard={() => setUseDeviceKeyboard((v) => !v)}
                    trailing={
                      <button
                        type="button"
                        onClick={() => press('+')}
                        className="shrink-0 rounded-control bg-surface-sunken px-2 py-1 text-xs font-semibold text-ink-muted"
                      >
                        {t('staff.expenseTracker.plusChunk')}
                      </button>
                    }
                  />

                  <input
                    value={buffer.description}
                    onChange={(ev) => setBuffer((b) => ({ ...b, description: ev.target.value }))}
                    onPaste={handlePaste}
                    placeholder={t('staff.expenseTracker.descriptionPlaceholder')}
                    aria-label={t('staff.expenseTracker.description')}
                    className="mt-2 h-10 w-full rounded-control border border-transparent bg-surface-sunken px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none"
                  />

                  {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}

                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {keys.map((k) =>
                      k === 'commit' ? (
                        <button
                          key={k}
                          type="button"
                          onClick={commit}
                          disabled={bufferValue == null}
                          className="h-11 rounded-control bg-brand text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
                        >
                          {buffer.editingKey
                            ? t('staff.expenseTracker.bucketUpdate')
                            : t('staff.expenseTracker.bucketCommit')}
                        </button>
                      ) : k === 'backspace' ? (
                        <button
                          key={k}
                          type="button"
                          onClick={() => press('backspace')}
                          aria-label={t('staff.expenseTracker.backspace')}
                          className="flex h-11 items-center justify-center rounded-control bg-surface-sunken text-ink-muted transition active:scale-95"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9L3 12l6-7Z" />
                            <path d="M12 9.5l5 5M17 9.5l-5 5" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          key={k}
                          type="button"
                          onClick={() => press(k)}
                          className="h-11 rounded-control bg-surface-sunken text-xl font-semibold text-ink transition active:scale-95"
                        >
                          {k}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ยอดรวมของทั้งชุด + บันทึกทีเดียว */}
      <div className="shrink-0 border-t border-line pt-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-ink-muted">
            {t('staff.expenseTracker.entryCount', { count: entries.length })}
          </span>
          <span className="text-lg font-bold text-ink">{total.toLocaleString()} ฿</span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || entries.length === 0}
          className="w-full rounded-card bg-brand-gradient py-3.5 text-base font-semibold text-white shadow-brand transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
        >
          {saving
            ? t('staff.expenseTracker.saving')
            : t('staff.expenseTracker.batchSaveAll', {
                count: entries.length,
                amount: total.toLocaleString(),
              })}
        </button>
      </div>
    </div>
  )
}
