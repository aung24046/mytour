export default function SelectField({
  label,
  required = false,
  options = [],
  className = '',
  ...props
}) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1 block text-sm font-medium text-neutral-text">
          {label}
          {required && <span className="text-danger"> *</span>}
        </span>
      )}
      <select
        className="w-full rounded-control border border-gray-300 bg-surface px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
        {...props}
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
