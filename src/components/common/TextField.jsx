export default function TextField({
  label,
  required = false,
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
      <input
        className="w-full rounded-control border border-gray-300 px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
        {...props}
      />
    </label>
  )
}
