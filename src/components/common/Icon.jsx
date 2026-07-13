import { useState } from 'react'

// ============================================================
// MyTour icon set — modern travel-app duotone line icons.
//   • OUTLINE (default): stroked line-art, transparent interior.
//   • FILLED (hover / active): solid duotone — body fills with
//     `color`, interior detail flips to white.
// 24×24 grid, 1.8 stroke, rounded caps/joins. Set state via
// `filled` (persistent, e.g. active nav tab) and/or `interactive`
// (auto-fill on hover).
// ============================================================
const SW = 1.8
const S = { strokeWidth: SW, strokeLinejoin: 'round', strokeLinecap: 'round' }

// Each glyph: (c) => elements, where c = { color, body, detail }
//   body   = fill for the main silhouette (color when filled, else none)
//   detail = interior lines / holes / accents (white when filled, else color)
const RENDER = {
  home: (c) => (
    <>
      <path d="M12 4.2 L20 10.8 V18.8 A1.4 1.4 0 0 1 18.6 20.2 H5.4 A1.4 1.4 0 0 1 4 18.8 V10.8 Z" fill={c.body} stroke={c.color} {...S} />
      <path d="M9.8 20.2 V15.6 A2.2 2.2 0 0 1 14.2 15.6 V20.2" fill="none" stroke={c.detail} {...S} />
    </>
  ),
  map: (c) => (
    <>
      <path d="M3.5 6.2 L9 4.4 L15 6.2 L20.5 4.4 V17.8 L15 19.6 L9 17.8 L3.5 19.6 Z" fill={c.body} stroke={c.color} {...S} />
      <line x1="9" y1="4.7" x2="9" y2="17.8" stroke={c.detail} {...S} />
      <line x1="15" y1="6.2" x2="15" y2="19.3" stroke={c.detail} {...S} />
    </>
  ),
  ticket: (c) => (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" fill={c.body} stroke="none" />
      <path d="M9 5.2 H7 A1.8 1.8 0 0 0 5.2 7 V9" fill="none" stroke={c.detail} {...S} />
      <path d="M15 5.2 H17 A1.8 1.8 0 0 1 18.8 7 V9" fill="none" stroke={c.detail} {...S} />
      <path d="M9 18.8 H7 A1.8 1.8 0 0 1 5.2 17 V15" fill="none" stroke={c.detail} {...S} />
      <path d="M15 18.8 H17 A1.8 1.8 0 0 0 18.8 17 V15" fill="none" stroke={c.detail} {...S} />
      <rect x="9.6" y="9.6" width="2" height="2" rx="0.4" fill={c.detail} />
      <rect x="12.4" y="9.6" width="2" height="2" rx="0.4" fill={c.detail} />
      <rect x="9.6" y="12.4" width="2" height="2" rx="0.4" fill={c.detail} />
      <rect x="12.4" y="12.4" width="2" height="2" rx="0.4" fill={c.detail} />
    </>
  ),
  bed: (c) => (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="3" fill={c.body} stroke={c.color} {...S} />
      <rect x="6" y="6" width="12" height="4.6" rx="2" fill="none" stroke={c.detail} {...S} />
      <line x1="5.5" y1="14" x2="18.5" y2="14" stroke={c.detail} {...S} />
    </>
  ),
  target: (c) => (
    <>
      <circle cx="12" cy="12" r="9" fill={c.body} stroke={c.color} {...S} />
      <circle cx="12" cy="12" r="5.2" fill="none" stroke={c.detail} {...S} />
      <circle cx="12" cy="12" r="1.9" fill={c.detail} stroke="none" />
    </>
  ),
  location: (c) => (
    <>
      <path d="M12 20.8 C12 20.8 5.2 14.6 5.2 9.9 A6.8 6.8 0 0 1 18.8 9.9 C18.8 14.6 12 20.8 12 20.8 Z" fill={c.body} stroke={c.color} {...S} />
      <circle cx="12" cy="9.9" r="2.5" fill="none" stroke={c.detail} {...S} />
    </>
  ),
  check: (c) => (
    <>
      <circle cx="12" cy="12" r="9" fill={c.body} stroke={c.color} {...S} />
      <polyline points="8 12.3 11 15.2 16.2 9" fill="none" stroke={c.detail} strokeWidth={SW + 0.2} strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  people: (c) => (
    <>
      <circle cx="8.6" cy="8" r="2.7" fill={c.body} stroke={c.color} {...S} />
      <path d="M3.8 19 A4.8 4.8 0 0 1 13.4 19 Z" fill={c.body} stroke={c.color} {...S} />
      <circle cx="15.2" cy="8.8" r="3" fill={c.body} stroke={c.color} {...S} />
      <path d="M9.4 19.4 A5.6 5.6 0 0 1 20.6 19.4 Z" fill={c.body} stroke={c.color} {...S} />
    </>
  ),
  bag: (c) => (
    <>
      <path d="M9 7.5 V5.6 A1.6 1.6 0 0 1 10.6 4 H13.4 A1.6 1.6 0 0 1 15 5.6 V7.5" fill="none" stroke={c.color} {...S} />
      <rect x="4.5" y="7.5" width="15" height="13" rx="2.5" fill={c.body} stroke={c.color} {...S} />
      <line x1="4.5" y1="13.5" x2="19.5" y2="13.5" stroke={c.detail} {...S} />
    </>
  ),
  megaphone: (c) => (
    <>
      <polygon points="3.5,10 14,5.5 14,18.5 3.5,14" fill={c.body} stroke={c.color} {...S} />
      <path d="M17 8.8 A5 5 0 0 1 17 15.2" fill="none" stroke={c.color} {...S} />
    </>
  ),
  bowl: (c) => (
    <>
      <path d="M4 12 A8 8 0 0 0 20 12 Z" fill={c.body} stroke={c.color} {...S} />
      <line x1="3" y1="12" x2="21" y2="12" stroke={c.color} {...S} />
      <path d="M10 5 Q11 6.5 10 8" fill="none" stroke={c.color} {...S} />
      <path d="M14 5 Q15 6.5 14 8" fill="none" stroke={c.color} {...S} />
    </>
  ),
  seat: (c) => (
    <>
      <rect x="6" y="4" width="12" height="9" rx="2.5" fill={c.body} stroke={c.color} {...S} />
      <rect x="4.5" y="12.5" width="15" height="4.6" rx="2" fill={c.body} stroke={c.color} {...S} />
      <line x1="7" y1="17.2" x2="7" y2="20" stroke={c.color} {...S} />
      <line x1="17" y1="17.2" x2="17" y2="20" stroke={c.color} {...S} />
    </>
  ),
  compass: (c) => (
    <>
      <circle cx="12" cy="12" r="9" fill={c.body} stroke={c.color} {...S} />
      <polygon points="12,7 14.2,12 12,17 9.8,12" fill={c.detail} stroke={c.detail} {...S} />
    </>
  ),
  book: (c) => (
    <>
      <path d="M12 6.2 C10.4 4.9 7.8 4.4 4.6 4.7 V17.9 C7.8 17.6 10.4 18.1 12 19.4 C13.6 18.1 16.2 17.6 19.4 17.9 V4.7 C16.2 4.4 13.6 4.9 12 6.2 Z" fill={c.body} stroke={c.color} {...S} />
      <line x1="12" y1="6.2" x2="12" y2="19.4" stroke={c.detail} {...S} />
    </>
  ),
  alert: (c) => (
    <>
      <path d="M12 3.3 L21.2 19.4 A1.2 1.2 0 0 1 20.2 21.2 H3.8 A1.2 1.2 0 0 1 2.8 19.4 Z" fill={c.body} stroke={c.color} {...S} />
      <line x1="12" y1="9.3" x2="12" y2="13.8" stroke={c.detail} {...S} />
      <circle cx="12" cy="16.7" r="1" fill={c.detail} stroke="none" />
    </>
  ),
  star: (c) => (
    <>
      <path d="M12 3.2 L14.6 9.2 L21.1 9.8 L16.1 14.1 L17.6 20.5 L12 17.1 L6.4 20.5 L7.9 14.1 L2.9 9.8 L9.4 9.2 Z" fill={c.body} stroke={c.color} {...S} />
    </>
  ),
  wallet: (c) => (
    <>
      <path d="M4 8.2 A2.2 2.2 0 0 1 6.2 6 H17.8 A2.2 2.2 0 0 1 20 8.2 V16.8 A2.2 2.2 0 0 1 17.8 19 H6.2 A2.2 2.2 0 0 1 4 16.8 Z" fill={c.body} stroke={c.color} {...S} />
      <line x1="14" y1="12.5" x2="18.5" y2="12.5" stroke={c.detail} {...S} />
      <circle cx="16" cy="12.5" r="1.1" fill={c.detail} stroke="none" />
    </>
  ),
  briefcase: (c) => (
    <>
      <path d="M9 7.5 V5.8 A1.8 1.8 0 0 1 10.8 4 H13.2 A1.8 1.8 0 0 1 15 5.8 V7.5" fill="none" stroke={c.color} {...S} />
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.2" fill={c.body} stroke={c.color} {...S} />
      <line x1="3.5" y1="13.2" x2="20.5" y2="13.2" stroke={c.detail} {...S} />
      <rect x="10.5" y="12" width="3" height="2.4" rx="0.5" fill={c.detail} stroke="none" />
    </>
  ),
  wifi: (c) => (
    <>
      <path d="M3.7 8.6 A13 13 0 0 1 20.3 8.6" fill="none" stroke={c.color} {...S} />
      <path d="M6.7 12 A8.6 8.6 0 0 1 17.3 12" fill="none" stroke={c.color} {...S} />
      <path d="M9.6 15.4 A4.2 4.2 0 0 1 14.4 15.4" fill="none" stroke={c.color} {...S} />
      <circle cx="12" cy="18.6" r="1.15" fill={c.color} stroke="none" />
    </>
  ),
  coffee: (c) => (
    <>
      <path d="M5 8.5 H16 V13 A4 4 0 0 1 12 17 H9 A4 4 0 0 1 5 13 Z" fill={c.body} stroke={c.color} {...S} />
      <path d="M16 9.6 H17.8 A2.2 2.2 0 0 1 17.8 13.9 H16" fill="none" stroke={c.color} {...S} />
      <path d="M8.2 3.6 Q9.2 5 8.2 6.4" fill="none" stroke={c.color} {...S} />
      <path d="M11.8 3.6 Q12.8 5 11.8 6.4" fill="none" stroke={c.color} {...S} />
      <line x1="5" y1="20" x2="15" y2="20" stroke={c.color} {...S} />
    </>
  ),
  door: (c) => (
    <>
      <rect x="6" y="3.5" width="12" height="17" rx="1.6" fill={c.body} stroke={c.color} {...S} />
      <circle cx="14.6" cy="12" r="1.15" fill={c.detail} stroke="none" />
    </>
  ),
  calendar: (c) => (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.4" fill={c.body} stroke={c.color} {...S} />
      <line x1="4" y1="9.5" x2="20" y2="9.5" stroke={c.color} {...S} />
      <line x1="8" y1="3.4" x2="8" y2="6.6" stroke={c.color} {...S} />
      <line x1="16" y1="3.4" x2="16" y2="6.6" stroke={c.color} {...S} />
      <circle cx="9" cy="14" r="1" fill={c.detail} stroke="none" />
      <circle cx="13" cy="14" r="1" fill={c.detail} stroke="none" />
    </>
  ),
  bus: (c) => (
    <>
      <rect x="4" y="4.5" width="16" height="13" rx="2.6" fill={c.body} stroke={c.color} {...S} />
      <line x1="4.5" y1="10" x2="19.5" y2="10" stroke={c.detail} {...S} />
      <line x1="12" y1="5" x2="12" y2="10" stroke={c.detail} {...S} />
      <circle cx="8.5" cy="19" r="1.5" fill="none" stroke={c.color} {...S} />
      <circle cx="15.5" cy="19" r="1.5" fill="none" stroke={c.color} {...S} />
      <line x1="6" y1="13.6" x2="7.6" y2="13.6" stroke={c.detail} {...S} />
      <line x1="16.4" y1="13.6" x2="18" y2="13.6" stroke={c.detail} {...S} />
    </>
  ),
  'steering-wheel': (c) => (
    <>
      <circle cx="12" cy="12" r="8.5" fill={c.body} stroke={c.color} {...S} />
      <circle cx="12" cy="12" r="2.4" fill="none" stroke={c.detail} {...S} />
      <line x1="12" y1="3.6" x2="12" y2="9.6" stroke={c.detail} {...S} />
      <line x1="4.4" y1="16.4" x2="9.7" y2="13.4" stroke={c.detail} {...S} />
      <line x1="19.6" y1="16.4" x2="14.3" y2="13.4" stroke={c.detail} {...S} />
    </>
  ),
  lock: (c) => (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2.4" fill={c.body} stroke={c.color} {...S} />
      <path d="M8 10 V7.6 A4 4 0 0 1 16 7.6 V10" fill="none" stroke={c.color} {...S} />
      <circle cx="12" cy="14.2" r="1.4" fill={c.detail} stroke="none" />
      <line x1="12" y1="15" x2="12" y2="17" stroke={c.detail} {...S} />
    </>
  ),
  phone: (c) => (
    <path
      d="M20.5 16.3v2.7a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.8-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 2.5 4.8a1.8 1.8 0 0 1 1.8-2h2.7a1.8 1.8 0 0 1 1.8 1.5 11.5 11.5 0 0 0 .6 2.5 1.8 1.8 0 0 1-.4 1.9L7.9 9.9a14.4 14.4 0 0 0 5.4 5.4l1.1-1.1a1.8 1.8 0 0 1 1.9-.4 11.5 11.5 0 0 0 2.5.6 1.8 1.8 0 0 1 1.5 1.8z"
      fill={c.body}
      stroke={c.color}
      {...S}
    />
  ),
  // ---- legacy icons — not yet in the duotone design kit, kept as
  // single-tone outlines so existing pages (Dashboard, PrintExport,
  // FormBuilder, StaffManager) keep working unchanged. Safe to
  // redesign into full duotone glyphs later if the kit adds them.
  print: (c) => (
    <>
      <path d="M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" fill="none" stroke={c.color} {...S} />
      <path d="M7 14h10v6H7Z" fill={c.body} stroke={c.color} {...S} />
    </>
  ),
  form: (c) => (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" fill={c.body} stroke={c.color} {...S} />
      <path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke={c.detail} {...S} />
    </>
  ),
  settings: (c) => (
    <>
      <circle cx="12" cy="12" r="3" fill={c.body} stroke={c.color} {...S} />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" fill="none" stroke={c.color} {...S} />
    </>
  ),
}

export const ICON_NAMES = Object.keys(RENDER)

/**
 * MyTour icon glyph — duotone line icons. OUTLINE by default (colored
 * line-art on a transparent interior); FILLED (solid duotone) when
 * `filled` or hovered (`interactive`). Pass `filled` for a persistent
 * active look (e.g. selected nav tab) and `interactive` to auto-fill
 * on hover (tappable tiles).
 */
export default function Icon({
  name,
  size = 24,
  color = 'currentColor',
  filled = false,
  interactive = false,
  className = '',
  style = {},
  ...props
}) {
  const [hovered, setHovered] = useState(false)
  const renderFn = RENDER[name] || RENDER.compass
  const isFilled = filled || (interactive && hovered)
  const c = { color, body: isFilled ? color : 'none', detail: isFilled ? '#fff' : color }
  const handlers = interactive
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {}

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`mt-icon ${className}`.trim()}
      style={{ display: 'block', flex: 'none', transition: 'fill .15s, stroke .15s', ...style }}
      {...handlers}
      {...props}
    >
      {renderFn(c)}
    </svg>
  )
}
