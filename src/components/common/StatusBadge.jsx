// Badge สถานะแบบ pill ที่ใช้ซ้ำกันหลายหน้า (GuestManager, CheckIn, LuggageManager, BingoHost ฯลฯ)
// รวมเป็น component เดียวตาม design tokens ใน tailwind.config.js
// tone: 'success' | 'warning' | 'danger' | 'neutral' | 'brand'
const TONE_CLASSES = {
  success: 'bg-success-bg text-success-text ring-success/20',
  warning: 'bg-warning-bg text-warning-text ring-warning/20',
  danger: 'bg-danger-bg text-danger-text ring-danger/20',
  neutral: 'bg-neutral-bg text-neutral-text ring-black/5',
  brand: 'bg-brand-light text-brand-hover ring-brand/20',
}

const DOT_CLASSES = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-ink-faint',
  brand: 'bg-brand',
}

export default function StatusBadge({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[tone] ?? TONE_CLASSES.neutral} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone] ?? DOT_CLASSES.neutral}`} />
      {children}
    </span>
  )
}
