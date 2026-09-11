import { useLocation } from 'react-router-dom'
import Icon from './Icon'
import BackButton from './BackButton'

// แถบหัวเรื่องของหน้าฝั่งทีมงาน — ปักบนสุด มีปุ่มย้อนกลับในตัว
//
// ทำไมต้องมี: เดิมทางกลับหน้าหลักคือปุ่มลอยมุมซ้ายล่าง (HomeButton) ซึ่งทับเนื้อหา
// แถวสุดท้ายของทุกหน้าที่ไม่ได้เผื่อที่ไว้เอง — และเผื่อไว้จริงแค่ 3 หน้าจาก 20 กว่าหน้า
// ย้ายขึ้นมาไว้บนแทน ได้พื้นที่ล่างจอคืนเต็ม และเลิกแย่ง z-index กับ BottomSheet/แถบเมนู
//
// วิธีใช้:
//   <StaffHeader title={t('staff.checkIn.title')} subtitle="..." icon="check" />
//   <StaffHeader title="..." actions={<button>…</button>} />       // ปุ่มมุมขวา
//   <StaffHeader title="..." backTo="/staff/documents" />          // กำหนดปลายทางเอง
//   <StaffHeader title="..." backTo={null} />                      // ไม่มีปุ่มย้อนกลับ (หน้าแรก)
//   <StaffHeader title="..." onBack={() => setDraft(null)} />      // ย้อนภายในหน้า (ฟอร์ม → รายการ)
//
// ⚠️ ต้องวางเป็นลูกตัวแรกของ root ที่ "ไม่มี padding" แล้วค่อยห่อเนื้อหาด้วย p-4 ข้างใน
//    ไม่งั้นแถบจะไม่เต็มความกว้างตอนปักบน:
//      <div className="min-h-screen bg-surface-muted">
//        <StaffHeader … />
//        <div className="mx-auto max-w-md p-4">…</div>
//      </div>

// ส่วนเกม — ลำดับชั้นจริงคือ แดชบอร์ด → หน้ารวมเกม → หน้าของเกม → คุมห้อง/แก้ชุด
// ★ เดิมทุกหน้าในนี้ตกไปที่ '/staff' กดย้อนกลับจากห้องปริศนาจึงเด้งข้ามสองชั้นไปแดชบอร์ด
//   (เจ้าของโปรเจกต์แจ้ง 11 ก.ย. 2026: บิงโก · ปริศนาใบ้คำ · เปิดแผ่นป้าย)
//   ควิซกับสุ่มรายชื่อไม่เจอเพราะส่ง backTo เองไว้ — ย้ายกติกามาไว้ที่นี่ที่เดียว
//   เกมใหม่ที่ใช้โครง /staff/<เกม>/(builder|host|report)/:id จะย้อนถูกเองโดยไม่ต้องจำ
const GAME_HUB = '/staff/games'
const GAME_PAGES = ['bingo-host', 'lucky-draw', 'quiz', 'puzzle', 'tiles', 'words', 'shuffle']

/** เดาปลายทางของปุ่มย้อนกลับจาก path — หน้าลูกกลับไปหาหน้าแม่ ที่เหลือกลับแดชบอร์ด */
export function defaultBackTo(pathname) {
  if (pathname.startsWith('/staff/documents/')) return '/staff/documents'
  if (pathname.startsWith('/staff/broadcast/')) return '/staff/broadcast'

  // /staff/<เกม>            → หน้ารวมเกม
  // /staff/<เกม>/<อะไรก็ได้> → หน้าของเกมนั้น
  const game = /^\/staff\/([^/]+)(\/.*)?$/.exec(pathname)
  if (game && GAME_PAGES.includes(game[1])) {
    const rest = (game[2] ?? '').replace(/\/+$/, '')
    return rest ? `/staff/${game[1]}` : GAME_HUB
  }
  return '/staff'
}

export default function StaffHeader({
  title,
  subtitle,
  icon,
  backTo,
  onBack,
  actions,
  className = '',
}) {
  const { pathname } = useLocation()
  const target = backTo === undefined ? defaultBackTo(pathname) : backTo

  return (
    <header
      className={`no-print sticky top-0 z-30 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur print:hidden ${className}`}
      style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}
    >
      <div className="mx-auto flex max-w-md items-center gap-2.5">
        <BackButton to={target} onClick={onBack} />

        {icon && (
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-brand-lighter text-brand">
            <Icon name={icon} size={18} filled />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-extrabold leading-tight text-ink">{title}</h1>
          {subtitle && <p className="truncate text-[11.5px] leading-tight text-ink-muted">{subtitle}</p>}
        </div>

        {actions && <div className="flex flex-none items-center gap-1.5">{actions}</div>}
      </div>
    </header>
  )
}
