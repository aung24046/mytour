export default function CheckboxGroup({
  label,
  required = false,
  options = [],
  value = [],
  onChange,
  className = '',
}) {
  function toggle(optValue) {
    const next = value.includes(optValue)
      ? value.filter((v) => v !== optValue)
      : [...value, optValue]
    onChange?.(next)
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
          const checked = value.includes(opt.value)
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2.5 rounded-control border px-3.5 py-3 transition ${
                checked
                  ? 'border-brand bg-brand-lighter ring-1 ring-brand-light'
                  : 'border-transparent bg-surface-sunken hover:bg-neutral-bg'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt.value)}
                className="h-5 w-5 rounded-md border-gray-300 text-brand focus:ring-brand-light"
              />
              <span className="text-base text-ink">{opt.label}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
