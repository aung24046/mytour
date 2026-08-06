import { useContext } from 'react'

import { ColorModeContext } from '../../lib/colorMode'
import Icon from './Icon'

// สวิตช์โหมดสว่าง/มืด — สามตัวเลือก ไม่ใช่สองตัว
//
// "ตามระบบ" ต้องมีและต้องเป็นค่าเริ่มต้น เพราะคนที่ตั้งมือถือให้สลับ
// เป็นโหมดมืดตอนพระอาทิตย์ตกคาดหวังให้แอปทำตามด้วย ถ้ามีแค่สวิตช์เปิด/ปิด
// ผู้ใช้จะถูกล็อกอยู่โหมดใดโหมดหนึ่งตลอดโดยไม่รู้ตัว

const OPTIONS = [
  { key: 'light', label: 'สว่าง', icon: 'target' },
  { key: 'dark', label: 'มืด', icon: 'compass' },
  { key: 'system', label: 'ตามระบบ', icon: 'settings' },
]

export default function ColorModeToggle({ className = '' }) {
  const ctx = useContext(ColorModeContext)
  if (!ctx) return null

  const { preference, setPreference } = ctx

  return (
    <div
      className={`inline-flex rounded-pill bg-surface-sunken p-0.5 ${className}`}
      role="radiogroup"
      aria-label="โหมดสีของหน้าจอ"
    >
      {OPTIONS.map((o) => {
        const active = preference === o.key
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(o.key)}
            className={`flex items-center gap-1 rounded-pill px-2.5 py-1.5 text-[12px] font-semibold transition ${
              active ? 'bg-surface text-brand-hover shadow-card' : 'text-ink-muted'
            }`}
          >
            <Icon name={o.icon} size={14} />
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
