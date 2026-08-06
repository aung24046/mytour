import { buildEntry, extractText, matchEntry } from '../../lib/optionOtherText'

export default function CheckboxGroup({
  label,
  required = false,
  options = [],
  value = [],
  onChange,
  className = '',
}) {
  function findEntry(optValue) {
    return value.find((entry) => matchEntry(entry, optValue))
  }

  function toggle(opt) {
    const existing = findEntry(opt.value)
    if (existing !== undefined) {
      onChange?.(value.filter((entry) => entry !== existing))
    } else {
      onChange?.([...value, buildEntry(opt.value, '')])
    }
  }

  function updateText(opt, text) {
    const existing = findEntry(opt.value)
    if (existing === undefined) return
    onChange?.(
      value.map((entry) => (entry === existing ? buildEntry(opt.value, text) : entry))
    )
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
          const existing = findEntry(opt.value)
          const checked = existing !== undefined
          const text = existing !== undefined ? extractText(existing, opt.value) : ''
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
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  className="h-5 w-5 rounded-md border-line-strong text-brand focus:ring-brand-light"
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
                  className="mt-1.5 w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-2.5 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
