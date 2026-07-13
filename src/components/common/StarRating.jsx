import { useState } from 'react'

import Icon from './Icon'

// ให้คะแนนดาว 1–5 — ใช้เป็น field_type "rating" ใน DynamicField (ฟอร์ม Feedback)
// value: number (1-5) หรือ '' (ยังไม่เลือก) — เก็บลง guest_form_responses เป็น string เดียวกับ field อื่นๆ
export default function StarRating({ label, required = false, value, onChange, size = 30 }) {
  const [hoverValue, setHoverValue] = useState(0)
  const current = Number(value) || 0

  return (
    <div>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
          {label}
          {required && <span className="text-accent"> *</span>}
        </span>
      )}
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= (hoverValue || current)
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(String(n))}
              onMouseEnter={() => setHoverValue(n)}
              onMouseLeave={() => setHoverValue(0)}
              className="p-0.5 transition active:scale-90"
              aria-label={`${n} ดาว`}
            >
              <Icon name="star" size={size} filled={filled} color={filled ? '#f59e0b' : '#d1d5db'} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
