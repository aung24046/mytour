import { buildEntry, extractText, matchEntry } from '../../lib/optionOtherText'

// เลือกได้ข้อเดียว (radio) — value เป็น string เดียวเสมอ เข้ากับ contract ของ DynamicField
// รองรับ hasText แบบเดียวกับ CheckboxGroup เช่น "มี (Yes) โปรดระบุชื่อยาที่แพ้"
export default function RadioGroup({
  label,
  required = false,
  options = [],
  value = '',
  onChange,
  className = '',
}) {
  function select(opt) {
    onChange?.(buildEntry(opt.value, ''))
  }

  function updateText(opt, text) {
    onChange?.(buildEntry(opt.value, text))
  }

  return (
    <div className={className}>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
          {label}
          {required && <span className="text-accent"> *</span>}
        </span>
      )}
      <div className="flex flex-col gap-2">
        {options.map((opt) => {
          const checked = matchEntry(value, opt.value)
          const text = checked ? extractText(value, opt.value) : ''
          return (
            <div key={opt.value}>
              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-control border px-3.5 py-3 transition ${
                  checked
                    ? 'border-brand bg-brand-lighter ring-1 ring-brand-light'
                    : 'border-transparent bg-surface-sunken hover:bg-neutral-bg'
                }`}
              >
                <input
                  type="radio"
                  checked={checked}
                  onChange={() => select(opt)}
                  className="h-5 w-5 border-gray-300 text-brand focus:ring-brand-light"
                />
                <span className="text-base text-ink">{opt.label}</span>
              </label>
              {checked && opt.hasText && (
                <input
                  type="text"
                  autoFocus
                  value={text}
                  onChange={(e) => updateText(opt, e.target.value)}
                  placeholder={opt.textPlaceholder ?? ''}
                  className="mt-1.5 w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-2.5 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
