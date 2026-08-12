import { useTranslation } from 'react-i18next'

import { formatAmountDisplay, sanitizeAmountInput } from './expenseHelpers'

// ช่องยอดเงิน — ใช้ร่วมกันทั้งหน้าทีละรายการและตะกร้าตามหมวด
//
// เป็น <input> จริง ไม่ใช่ข้อความ เพื่อให้พิมพ์ได้สามทาง:
//   1. แป้นในแอป (ค่าตั้งต้นบนมือถือ)
//   2. คีย์บอร์ดจริงบนคอม — ได้ฟรีเพราะช่องนี้โฟกัสอยู่
//   3. คีย์บอร์ดของเครื่อง — กดปุ่มสลับด้านขวา
//
// inputMode="none" คือกุญแจของข้อ 1: บอกมือถือว่าอย่าเด้งคีย์บอร์ดขึ้นมาเมื่อโฟกัส
// แต่ตัวช่องยังรับ keydown ตามปกติ คีย์บอร์ดจริงจึงพิมพ์ได้ทั้งที่คีย์บอร์ดจอไม่ขึ้น
//
// ⚠️ ค่าที่แสดงใส่คอมมาคั่นหลัก แต่ค่าที่เก็บใน state เป็นตัวเลขดิบ — ตอน onChange
//    จึงต้องส่งผ่าน sanitizeAmountInput เสมอ ไม่งั้นคอมมาที่เราเติมเองจะย้อนกลับเข้า state
export default function AmountField({
  value,
  onChange,
  useDeviceKeyboard,
  onToggleKeyboard,
  onEnter,
  inputRef,
  size = 'lg',
  trailing = null,
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-baseline gap-2 border-b border-line pb-2">
      <input
        ref={inputRef}
        value={formatAmountDisplay(value)}
        onChange={(e) => onChange(sanitizeAmountInput(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
        inputMode={useDeviceKeyboard ? 'decimal' : 'none'}
        enterKeyHint="done"
        autoComplete="off"
        placeholder="0"
        aria-label={t('staff.expenseTracker.amount')}
        className={`min-w-0 flex-1 border-0 bg-transparent p-0 font-extrabold leading-tight tabular-nums text-ink placeholder:text-ink-faint/40 focus:outline-none focus:ring-0 ${
          size === 'lg' ? 'text-[2.75rem]' : 'text-3xl'
        }`}
      />
      {trailing}
      <button
        type="button"
        onClick={onToggleKeyboard}
        aria-pressed={useDeviceKeyboard}
        aria-label={t('staff.expenseTracker.toggleKeyboard')}
        className={`shrink-0 rounded-control p-1.5 transition ${
          useDeviceKeyboard ? 'bg-brand-lighter text-brand' : 'text-ink-faint'
        }`}
      >
        {/* ⚠️ จุดปุ่มบนคีย์บอร์ดวาดด้วยเส้นยาวเกือบศูนย์ ('h.01') จะเห็นก็ต่อเมื่อ
            ปลายเส้นเป็นทรงกลม — ขาด strokeLinecap="round" เมื่อไร จุดจะหายหมด
            เหลือแค่กรอบสี่เหลี่ยมกับขีดสเปซบาร์ตรงกลาง */}
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
          <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 14h.01M17 14h.01M10 14h4" />
        </svg>
      </button>
      <span className="shrink-0 text-xl font-bold text-ink-faint">฿</span>
    </div>
  )
}
