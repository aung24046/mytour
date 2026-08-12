import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CATEGORIES,
  appendAmountKey,
  parseAmount,
  payerOptions,
  localDateString,
  shiftDate,
} from './expenseHelpers'
import AmountField from './AmountField'
import { selectArrowStyle } from './controls'

// ฟอร์มลงรายการทีละรายการ — พอดีหนึ่งจอมือถือ ไม่ต้องเลื่อน (390×844pt)
//
// งบความสูงที่ใช้จัดหน้า: หัวข้อ ~52 + ยอด ~90 + หมวด 2 แถว 86 + วันที่/คนจ่าย 36
// + รายละเอียด 40 + แป้น ~250 + ปุ่มบันทึก 52 ≈ 610 จาก 714 ที่ใช้ได้จริง
// เหลือ ~100 เป็นช่องไฟและเผื่อจอเล็ก (iPhone SE สูง 667 ก็ยังไม่ล้นเพราะแป้นยืดหดได้)
//
// ทำไมเขียนแป้นตัวเลขเอง: คีย์บอร์ดเครื่องกิน 302pt (36% ของจอ) และดันเนื้อหาขึ้นลง
// ทุกครั้งที่เปิด-ปิด แป้นที่วาดเองอยู่กับที่ นิ้วโป้งเอื้อมถึง และเหลือที่ให้หมวด
// กับยอดอยู่บนจอพร้อมกันได้ — ช่องรายละเอียดยังใช้คีย์บอร์ดจริงตามปกติ
export default function QuickAdd({ staffList, me, draft, onDraftChange, onSubmit, saving }) {
  const { t } = useTranslation()
  const payers = useMemo(() => payerOptions(staffList, me), [staffList, me])
  const fileInputRef = useRef(null)
  const holdTimer = useRef(null)

  const amountRef = useRef(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [useDeviceKeyboard, setUseDeviceKeyboard] = useState(false)
  const [error, setError] = useState(null)

  const today = localDateString()
  const yesterday = shiftDate(today, -1)
  const amountValue = parseAmount(draft.amount)
  const isOtherDate = draft.expense_date !== today && draft.expense_date !== yesterday

  function set(patch) {
    onDraftChange({ ...draft, ...patch })
  }

  function press(key) {
    setError(null)
    set({ amount: appendAmountKey(draft.amount, key) })
  }

  // กดค้างที่ปุ่มลบ = ล้างทั้งช่อง — เร็วกว่าเคาะทีละตัวตอนพิมพ์ผิดยาวๆ
  function holdBackspace() {
    holdTimer.current = setTimeout(() => set({ amount: '' }), 500)
  }
  function releaseBackspace() {
    clearTimeout(holdTimer.current)
  }

  // เปิดหน้ามาให้เคอร์เซอร์อยู่ในช่องยอดเลย — คีย์บอร์ดของเครื่องไม่ขึ้นเพราะ inputMode="none"
  // แต่คีย์บอร์ดจริงบนคอมพิมพ์ได้ทันทีโดยไม่ต้องคลิกก่อน
  useEffect(() => {
    amountRef.current?.focus({ preventScroll: true })
  }, [])

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    set({ photoFile: file })
    setPhotoPreview(URL.createObjectURL(file))
  }

  function clearPhoto() {
    set({ photoFile: null })
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (amountValue == null) {
      setError(t('staff.expenseTracker.amountError'))
      return
    }
    setError(null)

    await onSubmit({ ...draft, amount: amountValue })

    // เคลียร์เฉพาะสิ่งที่เปลี่ยนทุกรายการ — หมวด/วันที่/คนจ่ายคงไว้ เพราะลงติดกันทีเดียวหลายรายการ
    set({ amount: '', description: '', photoFile: null })
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    amountRef.current?.focus({ preventScroll: true })
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace']

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <AmountField
          inputRef={amountRef}
          value={draft.amount}
          onChange={(amount) => set({ amount })}
          useDeviceKeyboard={useDeviceKeyboard}
          onToggleKeyboard={() => setUseDeviceKeyboard((v) => !v)}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <p className="flex-1 text-xs text-ink-faint">{t('staff.expenseTracker.sumTip')}</p>
          <button
            type="button"
            onClick={() => press('+')}
            className="rounded-control bg-surface-sunken px-2.5 py-1 text-xs font-semibold text-ink-muted"
          >
            {t('staff.expenseTracker.plusChunk')}
          </button>
        </div>
      </div>

      {/* หมวด 7 ช่อง + ปุ่มใบเสร็จเป็นช่องที่ 8 — เต็มกริดพอดี ไม่เสียแถวให้ปุ่มกล้องแยก */}
      <div className="grid grid-cols-4 gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => set({ category: c })}
            aria-pressed={draft.category === c}
            className={`h-10 truncate rounded-control px-1 text-[13px] font-semibold transition ${
              draft.category === c
                ? 'bg-brand text-white shadow-brand'
                : 'bg-surface-sunken text-ink-muted'
            }`}
          >
            {t(`staff.expenseTracker.category.${c}`)}
          </button>
        ))}

        <div className="relative">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('staff.expenseTracker.receiptPhoto')}
            className={`flex h-10 w-full items-center justify-center gap-1 overflow-hidden rounded-control text-[13px] font-semibold transition ${
              photoPreview ? 'bg-brand-lighter text-brand' : 'bg-surface-sunken text-ink-muted'
            }`}
          >
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l1-1.6h6.6l1 1.6h1.2A2.5 2.5 0 0 1 19 8.5v8A2.5 2.5 0 0 1 16.5 19h-11A2.5 2.5 0 0 1 3 16.5v-8Z" />
                <circle cx="11" cy="12" r="3.2" />
              </svg>
            )}
          </button>
          {photoPreview && (
            <button
              type="button"
              onClick={clearPhoto}
              aria-label={t('staff.expenseTracker.removePhoto')}
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-xs leading-none text-surface"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* วันที่ + คนจ่าย — บรรทัดเดียว สูงเท่ากันหมด */}
      <div className="flex items-center gap-1.5">
        {showDatePicker || isOtherDate ? (
          <input
            type="date"
            value={draft.expense_date}
            onChange={(e) => set({ expense_date: e.target.value })}
            aria-label={t('staff.expenseTracker.expenseDate')}
            className="h-9 flex-1 rounded-control bg-surface-sunken px-2 text-sm text-ink-muted"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => set({ expense_date: today })}
              aria-pressed={draft.expense_date === today}
              className={`h-9 rounded-control px-3 text-sm font-semibold ${
                draft.expense_date === today
                  ? 'bg-ink text-surface'
                  : 'bg-surface-sunken text-ink-muted'
              }`}
            >
              {t('staff.expenseTracker.today')}
            </button>
            <button
              type="button"
              onClick={() => set({ expense_date: yesterday })}
              aria-pressed={draft.expense_date === yesterday}
              className={`h-9 rounded-control px-3 text-sm font-semibold ${
                draft.expense_date === yesterday
                  ? 'bg-ink text-surface'
                  : 'bg-surface-sunken text-ink-muted'
              }`}
            >
              {t('staff.expenseTracker.yesterday')}
            </button>
            <button
              type="button"
              onClick={() => setShowDatePicker(true)}
              aria-label={t('staff.expenseTracker.pickDate')}
              className="h-9 rounded-control bg-surface-sunken px-2.5 text-ink-muted"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
                <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
              </svg>
            </button>
          </>
        )}

        <select
          value={draft.paid_by ?? ''}
          onChange={(e) => set({ paid_by: e.target.value || null })}
          aria-label={t('staff.expenseTracker.paidBy')}
          style={selectArrowStyle}
          className="ml-auto h-9 max-w-[9rem] appearance-none rounded-control bg-surface-sunken bg-[length:0.6rem] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-6 text-sm text-ink-muted"
        >
          <option value="">—</option>
          {payers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* รายละเอียด — จังหวะเดียวที่คีย์บอร์ดเครื่องขึ้น */}
      <input
        value={draft.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder={t('staff.expenseTracker.descriptionPlaceholder')}
        aria-label={t('staff.expenseTracker.description')}
        className="h-10 w-full rounded-control border border-transparent bg-surface-sunken px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none"
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* แป้นตัวเลข — ยืดเต็มที่ว่างที่เหลือ จอใหญ่ปุ่มใหญ่ จอเล็กก็ยังไม่ล้น */}
      <div className="grid min-h-[13rem] flex-1 grid-cols-3 gap-2">
        {keys.map((k) =>
          k === 'backspace' ? (
            <button
              key={k}
              type="button"
              onClick={() => press('backspace')}
              onPointerDown={holdBackspace}
              onPointerUp={releaseBackspace}
              onPointerLeave={releaseBackspace}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={t('staff.expenseTracker.backspace')}
              className="flex items-center justify-center rounded-control bg-surface-sunken text-ink-muted transition active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9L3 12l6-7Z" />
                <path d="M12 9.5l5 5M17 9.5l-5 5" />
              </svg>
            </button>
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="rounded-control bg-surface-sunken text-2xl font-semibold text-ink transition active:scale-95"
            >
              {k}
            </button>
          )
        )}
      </div>

      {/* ยอดอยู่บนปุ่ม — กันกดพลาดตอนพิมพ์เลขผิดหลัก ซึ่งเป็นความผิดพลาดที่แก้ทีหลังยากสุด */}
      <button
        type="submit"
        disabled={saving || amountValue == null}
        className="shrink-0 rounded-card bg-brand-gradient py-3.5 text-base font-semibold text-white shadow-brand transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
      >
        {saving
          ? t('staff.expenseTracker.saving')
          : amountValue == null
            ? t('staff.expenseTracker.addExpense')
            : t('staff.expenseTracker.saveWithAmount', { amount: amountValue.toLocaleString() })}
      </button>
    </form>
  )
}
