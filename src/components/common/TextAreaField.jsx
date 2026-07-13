import { forwardRef } from 'react'

const TextAreaField = forwardRef(function TextAreaField(
  { label, required = false, className = '', ...props },
  ref
) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
          {label}
          {required && <span className="text-accent"> *</span>}
        </span>
      )}
      <textarea
        ref={ref}
        rows={3}
        className="w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-3 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
        {...props}
      />
    </label>
  )
})

export default TextAreaField
