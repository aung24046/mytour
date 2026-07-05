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
        <span className="mb-1 block text-sm font-medium text-neutral-text">
          {label}
          {required && <span className="text-danger"> *</span>}
        </span>
      )}
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-center gap-2 rounded-control border border-gray-300 px-3 py-2.5"
          >
            <input
              type="checkbox"
              checked={value.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand-light"
            />
            <span className="text-base text-gray-800">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
