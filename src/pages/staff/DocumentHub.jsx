import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveOrgId, useActiveTourId } from '../../lib/staffSession'
import { can } from '../../lib/permissions'
import Icon from '../../components/common/Icon'

// หน้ารวมเอกสารรูปเล่ม — แยกจาก /staff/print ที่เป็นป้ายสติกเกอร์กับ QR
//
// จัดกลุ่มตามผู้รับ เพราะเวลาใช้งานจริงหัวหน้าทัวร์คิดว่า "จะส่งให้ใคร"
// ไม่ได้คิดว่า "เอกสารชื่ออะไร"
//
// แสดงชื่อทริปไว้บนสุดเสมอ — แอดมินสลับทริปไปมาได้ ถ้าไม่บอกว่ากำลังดูทริปไหน
// มีโอกาสพิมพ์รายชื่อผิดกรุ๊ปส่งโรงแรมไปแล้วค่อยรู้ตัว

const RECENT_KEY = 'mytour.recentDocs'
const RECENT_MAX = 2

const GROUPS = [
  {
    title: 'ส่งคู่ค้า',
    hint: 'โรงแรม ร้านอาหาร บริษัทรถ',
    docs: [
      { to: 'rooming-list', name: 'ใบจัดห้องพัก', icon: 'bed', tint: '#0f6e56', meta: 'A4 นอน', cap: 'document.print' },
      { to: 'dietary-sheet', name: 'สรุปข้อจำกัดด้านอาหาร', icon: 'bowl', tint: '#854f0b', meta: 'A4 ตั้ง', cap: 'document.print' },
      { to: 'seat-manifest', name: 'ผังที่นั่งรถ', icon: 'bus', tint: '#185fa5', meta: 'A4 ตั้ง', cap: 'document.print' },
    ],
  },
  {
    title: 'ราชการและประกัน',
    hint: 'ตม. สายการบิน ประกันภัย',
    docs: [
      {
        to: 'guest-manifest',
        name: 'บัญชีรายชื่อผู้เดินทาง',
        icon: 'people',
        tint: '#3c3489',
        meta: 'A4',
        cap: 'document.print',
        sensitive: true,
      },
    ],
  },
  {
    title: 'แจกลูกค้า',
    hint: 'พิมพ์แจกก่อนออกเดินทาง',
    docs: [
      { to: 'itinerary-booklet', name: 'เล่มโปรแกรมทัวร์', icon: 'book', tint: '#993556', meta: 'A5 เล่ม', cap: 'document.print' },
      { to: 'emergency-card', name: 'บัตรฉุกเฉิน', icon: 'alert', tint: '#a32d2d', meta: 'A5 พับ', cap: 'document.print' },
      // ฟอร์มเปล่าไว้แจกคนที่กรอกในมือถือไม่ไหว — คนละใบกับ "รายงานความพึงพอใจ" ในกลุ่มปิดทริป
      { to: 'feedback-form', name: 'แบบประเมิน (ฉบับกระดาษ)', icon: 'star', tint: '#854f0b', meta: 'A4 ตั้ง', cap: 'document.print' },
    ],
  },
  {
    title: 'ปิดทริป',
    hint: 'เก็บเข้าแฟ้มและส่งบัญชี',
    docs: [
      { to: 'expense-report', name: 'รายงานค่าใช้จ่าย', icon: 'wallet', tint: '#3b6d11', meta: 'A4 นอน', cap: 'expense.edit' },
      { to: 'feedback-report', name: 'รายงานความพึงพอใจ', icon: 'star', tint: '#993c1d', meta: 'A4 ตั้ง', cap: 'feedback.view' },
    ],
  },
]

const ALL_DOCS = GROUPS.flatMap((g) => g.docs.map((d) => ({ ...d, group: g.title })))

function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(to) {
  try {
    const next = [to, ...readRecent().filter((x) => x !== to)].slice(0, 6)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // โหมดส่วนตัวของบางเบราว์เซอร์เขียน localStorage ไม่ได้ — ไม่ใช่เรื่องคอขาดบาดตาย
  }
}

export default function DocumentHub() {
  const navigate = useNavigate()
  const session = getStaffSession()
  const orgId = useActiveOrgId()
  const tourId = useActiveTourId()

  const [orgReady, setOrgReady] = useState(true)
  const [tour, setTour] = useState(null)
  const [guestCount, setGuestCount] = useState(null)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(() => readRecent())

  // หัวหน้าทัวร์ที่จะขึ้นบนเอกสารทุกใบของทริปนี้
  const [staff, setStaff] = useState([])
  const [leaderId, setLeaderId] = useState('')
  const [savingLeader, setSavingLeader] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [orgRes, tourRes, guestsRes, staffRes] = await Promise.all([
        supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle(),
        supabase
          .from('tours')
          .select('name, start_date, end_date, doc_leader_staff_id')
          .eq('id', tourId)
          .maybeSingle(),
        supabase.from('guests').select('id', { count: 'exact', head: true }).eq('tour_id', tourId),
        supabase
          .from('v_tour_staff')
          .select('id, name, role, job_title, is_active')
          .eq('tour_id', tourId)
          .order('name'),
      ])

      if (cancelled) return

      const name = orgRes.data?.name
      setOrgReady(Boolean(name) && !String(name).includes('ยังไม่ได้ตั้งชื่อ'))
      setTour(tourRes.data ?? null)
      setGuestCount(guestsRes.count ?? null)
      setStaff((staffRes.data ?? []).filter((s) => s.is_active !== false))
      setLeaderId(tourRes.data?.doc_leader_staff_id ?? '')
    }

    load()
    return () => {
      cancelled = true
    }
  }, [orgId, tourId])

  const allowed = useMemo(() => ALL_DOCS.filter((d) => can(session, d.cap)), [session])

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () =>
      q
        ? allowed.filter(
            (d) => d.name.toLowerCase().includes(q) || d.group.toLowerCase().includes(q)
          )
        : null,
    [allowed, q]
  )

  const recentDocs = useMemo(
    () =>
      recent
        .map((to) => allowed.find((d) => d.to === to))
        .filter(Boolean)
        .slice(0, RECENT_MAX),
    [recent, allowed]
  )

  function open(to) {
    pushRecent(to)
    setRecent(readRecent())
  }

  // เรียงคนที่เป็น lead ขึ้นก่อน แต่ยังเลือกคนอื่นในทีมได้
  // (บางทริปคนที่ยืนชื่อบนเอกสารไม่ใช่คนที่มี role lead ในระบบ)
  const staffOptions = useMemo(() => {
    const rank = (s) => (s.role === 'lead' ? 0 : 1)
    return [...staff].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'th'))
  }, [staff])

  async function saveLeader(value) {
    setLeaderId(value)
    setSavingLeader(true)
    const { error } = await supabase
      .from('tours')
      .update({ doc_leader_staff_id: value || null })
      .eq('id', tourId)
    setSavingLeader(false)
    if (error) console.error('[DocumentHub] save doc leader failed', error)
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        {/* หัวเรื่อง — บอกทริปที่กำลังทำงานอยู่ */}
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-lg text-ink-muted shadow-card"
            aria-label="ย้อนกลับ"
          >
            ←
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight text-ink">เอกสาร</h1>
            <p className="truncate text-xs text-ink-muted">
              {tour?.name ?? 'กำลังโหลด…'}
              {guestCount != null && ` · ${guestCount} ท่าน`}
            </p>
          </div>

          {can(session, 'org.profile') && (
            <Link
              to="/staff/company-profile"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface shadow-card"
              aria-label="ข้อมูลบริษัท"
            >
              <Icon name="settings" size={18} className="text-ink-muted" />
            </Link>
          )}
        </div>

        {!orgReady && can(session, 'org.profile') && (
          <Link
            to="/staff/company-profile"
            className="mb-3 flex items-center gap-2 rounded-control bg-warning-bg px-3 py-2.5 text-sm text-warning-text"
          >
            <Icon name="alert" size={17} className="text-warning-text" />
            ยังไม่ได้ตั้งค่าข้อมูลบริษัท — เอกสารจะไม่มีหัวกระดาษ
          </Link>
        )}

        {/* หัวหน้าทัวร์บนเอกสาร — ใช้กับทุกใบของทริปนี้ ตั้งที่เดียวจบ */}
        {can(session, 'tourstaff.manage') && staffOptions.length > 0 && (
          <div className="mb-3 rounded-card bg-surface px-3 py-2.5 shadow-card">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-faint">หัวหน้าทัวร์บนเอกสาร</span>
              {savingLeader && <span className="text-[11px] text-ink-faint">กำลังบันทึก…</span>}
            </div>
            <select
              value={leaderId}
              onChange={(e) => saveLeader(e.target.value)}
              className="w-full rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink outline-none focus:bg-surface focus:ring-2 focus:ring-brand-light"
            >
              <option value="">— ไม่แสดงชื่อหัวหน้าทัวร์ —</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.role === 'lead' ? ' (หัวหน้าทัวร์)' : s.job_title ? ` (${s.job_title})` : ''}
                </option>
              ))}
            </select>
            {!leaderId && (
              <p className="mt-1 text-[11px] text-ink-muted">
                ทริปนี้มีหัวหน้าทัวร์หลายคน ระบบไม่เดาให้ — เลือกเองว่าจะให้ชื่อใครขึ้นเอกสาร
              </p>
            )}
          </div>
        )}

        {/* ค้นหา */}
        <div className="mb-3 flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 shadow-card">
          <Icon name="search" size={17} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเอกสาร"
            className="w-full border-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-sm text-ink-faint" aria-label="ล้างคำค้น">
              ✕
            </button>
          )}
        </div>

        {/* ผลค้นหา — แทนที่รายการปกติทั้งหมด */}
        {matches ? (
          matches.length > 0 ? (
            <DocRows docs={matches} onOpen={open} />
          ) : (
            <p className="py-8 text-center text-sm text-ink-muted">ไม่พบเอกสารที่ตรงกับ “{query}”</p>
          )
        ) : (
          <>
            {recentDocs.length > 0 && (
              <>
                <GroupLabel title="ใช้บ่อย" />
                <div className="mb-1 flex gap-2">
                  {recentDocs.map((doc) => (
                    <Link
                      key={doc.to}
                      to={`/staff/documents/${doc.to}`}
                      onClick={() => open(doc.to)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-card bg-surface px-3 py-2.5 shadow-card"
                    >
                      <Icon name={doc.icon} size={18} color={doc.tint} />
                      <span className="truncate text-xs font-medium text-ink">{doc.name}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {GROUPS.map((group) => {
              const visible = group.docs.filter((d) => can(session, d.cap))
              if (visible.length === 0) return null
              return (
                <div key={group.title}>
                  <GroupLabel title={group.title} hint={group.hint} />
                  <DocRows docs={visible} onOpen={open} />
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

function GroupLabel({ title, hint }) {
  return (
    <p className="mb-1.5 mt-4 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
      {title}
      {hint && <span className="ml-1.5 normal-case font-normal">· {hint}</span>}
    </p>
  )
}

// แถวกระชับในการ์ดใบเดียว — เส้นคั่นบางระหว่างแถว ไม่ใช่การ์ดแยกใบ
// ทำให้กวาดสายตาหาชื่อเอกสารได้เร็วกว่าเมื่อมีหลายรายการ
function DocRows({ docs, onOpen }) {
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card">
      {docs.map((doc, i) => (
        <Link
          key={doc.to}
          to={`/staff/documents/${doc.to}`}
          onClick={() => onOpen(doc.to)}
          className={`flex items-center gap-3 px-3 py-2.5 active:bg-surface-sunken ${
            i > 0 ? 'border-t border-line-subtle' : ''
          }`}
        >
          <Icon name={doc.icon} size={19} color={doc.tint} />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{doc.name}</span>

          {doc.sensitive && (
            <span className="shrink-0 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-medium text-warning-text">
              อ่อนไหว
            </span>
          )}
          <span className="shrink-0 text-[10px] text-ink-faint">{doc.meta}</span>
          <span className="shrink-0 text-ink-faint">›</span>
        </Link>
      ))}
    </div>
  )
}
