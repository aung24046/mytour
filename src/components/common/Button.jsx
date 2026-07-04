export default function Button({
  children,
  variant = 'primary',
  className = '',
  disabled = false,
  ...props
}) {
  const base =
    'w-full rounded-xl px-4 py-3 text-base font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100'

  const variants = {
    primary: 'bg-sky-600 text-white hover:bg-sky-700',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }

  return (
    <button
      className={`${base} ${variants[variant] ?? variants.primary} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
