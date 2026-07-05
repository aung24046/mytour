import { useTranslation } from 'react-i18next'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

// เก็บ/ส่งค่าเป็น string เดียวรูปแบบ "HH:MM" ให้เข้ากับ contract ของ DynamicField (value เป็น string เสมอ)
// ใช้สำหรับคำถามแบบ "ระยะเวลา" เช่น เวลาเดินทางมาจุดนัดพบ (เอาไปคำนวณเวลาโทรปลุกลูกทัวร์)
export default function DurationField({ label, required = false, value, onChange, className = '' }) {
  const { t } = useTranslation()
  const [h = '00', m = '00'] = (value ?? '').split(':')

  function setHours(nextH) {
    onChange(`${nextH}:${m}`)
  }

  function setMinutes(nextM) {
    onChange(`${h}:${nextM}`)
  }

  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
          {label}
          {required && <span className="text-accent"> *</span>}
        </span>
      )}
      <div className="flex items-center gap-2">
        <select
          value={h}
          onChange={(e) => setHours(e.target.value)}
          className="min-w-0 flex-1 rounded-control border border-transparent bg-surface-sunken px-3 py-3 text-base text-ink shadow-inner focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
        >
          {HOURS.map((hh) => (
            <option key={hh} value={hh}>
              {hh}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-sm font-medium text-ink-muted">{t('common.hoursShort')}</span>

        <select
          value={m}
          onChange={(e) => setMinutes(e.target.value)}
          className="min-w-0 flex-1 rounded-control border border-transparent bg-surface-sunken px-3 py-3 text-base text-ink shadow-inner focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
        >
          {MINUTES.map((mm) => (
            <option key={mm} value={mm}>
              {mm}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-sm font-medium text-ink-muted">{t('common.minutesShort')}</span>
      </div>
    </label>
  )
}
