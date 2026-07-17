// สี + ป้ายชื่อหมวดของคู่มือทริป (guide_categories) — ใช้ร่วมกันทั้งฝั่ง guest และ staff
// เก็บใน DB เป็น "คีย์สี" (teal/amber/...) แล้ว map เป็น hex ที่นี่ ปรับธีมทีเดียวได้

export const CATEGORY_COLORS = {
  teal:   { border: '#1D9E75', tint: '#E1F5EE', text: '#0F6E56' },
  amber:  { border: '#EF9F27', tint: '#FAEEDA', text: '#854F0B' },
  blue:   { border: '#378ADD', tint: '#E6F1FB', text: '#185FA5' },
  purple: { border: '#7F77DD', tint: '#EEEDFE', text: '#3C3489' },
  coral:  { border: '#D85A30', tint: '#FAECE7', text: '#993C1D' },
  pink:   { border: '#D4537E', tint: '#FBEAF0', text: '#993556' },
  green:  { border: '#639922', tint: '#EAF3DE', text: '#3B6D11' },
  gray:   { border: '#888780', tint: '#F1EFE8', text: '#444441' },
}

export const CATEGORY_COLOR_KEYS = Object.keys(CATEGORY_COLORS)

// ไอคอนที่เหมาะกับหมวดคู่มือ (subset ของ Icon.jsx) — ใช้ทำ dropdown เลือกไอคอนฝั่ง staff
export const CATEGORY_ICON_CHOICES = [
  'star', 'location', 'map', 'bus', 'navigation', 'compass',
  'book', 'bowl', 'coffee', 'bag', 'bed', 'door', 'wallet',
  'alert', 'calendar', 'ticket', 'heart', 'people',
]

export const CATEGORY_LAYOUTS = ['list', 'scroll']

export function catColor(key) {
  return CATEGORY_COLORS[key] || CATEGORY_COLORS.blue
}

// สีป้ายจากสตริง (เช่น ประเภทคำในคลังศัพท์) — deterministic ต่อคำเดิม
export function tagColor(str) {
  if (!str) return CATEGORY_COLORS.gray
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  const keys = CATEGORY_COLOR_KEYS.filter((k) => k !== 'gray')
  return CATEGORY_COLORS[keys[h % keys.length]]
}

// เลือกป้ายชื่อหมวดตามภาษาปัจจุบัน (fallback เป็นไทยเสมอ)
export function catLabel(category, lang) {
  if (!category) return ''
  if (lang === 'en') return category.label_en || category.label_th
  if (lang === 'zh') return category.label_zh || category.label_th
  return category.label_th
}
