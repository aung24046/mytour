// Badge สถานะแบบ pill ที่ใช้ซ้ำกันหลายหน้า (GuestManager, CheckIn, LuggageManager, BingoHost ฯลฯ)
// รวมเป็น component เดียวตาม design tokens ใน tailwind.config.js
// tone: 'success' | 'warning' | 'danger' | 'neutral'
const TONE_CLASSES = {
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  danger: 'bg-danger-bg text-danger-text',
  neutral: 'bg-neutral-bg text-ink-muted',
}

export default function StatusBadge({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone] ?? TONE_CLASSES.neutral} ${className}`}
    >
      {children}
    </span>
  )
}
