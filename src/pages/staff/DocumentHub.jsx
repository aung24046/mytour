import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveOrgId } from '../../lib/staffSession'
import { can } from '../../lib/permissions'
import Card from '../../components/common/Card'

// หน้ารวมเอกสารรูปเล่ม — แยกจาก /staff/print ที่เป็นป้ายสติกเกอร์กับ QR
//
// จัดกลุ่มตามผู้รับ เพราะเวลาใช้งานจริงหัวหน้าทัวร์คิดว่า "จะส่งให้ใคร"
// ไม่ได้คิดว่า "เอกสารชื่ออะไร"
const GROUPS = [
  {
    title: 'ส่งคู่ค้า',
    hint: 'โรงแรม ร้านอาหาร บริษัทรถ',
    docs: [
      { to: 'rooming-list', name: 'ใบจัดห้องพัก', desc: 'ส่งโรงแรมล่วงหน้า · A4 แนวนอน', cap: 'document.print' },
      { to: 'dietary-sheet', name: 'สรุปข้อจำกัดด้านอาหาร', desc: 'ส่งร้านอาหาร · A4 แนวตั้ง', cap: 'document.print' },
      { to: 'seat-manifest', name: 'ผังที่นั่งรถ', desc: 'ให้คนขับและไกด์ · A4 แนวตั้ง', cap: 'document.print' },
    ],
  },
  {
    title: 'ราชการและประกัน',
    hint: 'ตม. สายการบิน ประกันภัย',
    docs: [
      {
        to: 'guest-manifest',
        name: 'บัญชีรายชื่อผู้เดินทาง',
        desc: 'ชุดข้อมูลเข้มที่สุด · มีข้อมูลอ่อนไหว',
        cap: 'document.print',
        sensitive: true,
      },
    ],
  },
  {
    title: 'แจกลูกค้า',
    hint: 'พิมพ์แจกก่อนออกเดินทาง',
    docs: [
      { to: 'itinerary-booklet', name: 'เล่มโปรแกรมทัวร์', desc: 'A5 เย็บเล่ม · 1 วันต่อ 1 หน้า', cap: 'document.print' },
      { to: 'emergency-card', name: 'บัตรฉุกเฉิน', desc: 'A5 พับครึ่ง · พกใส่กระเป๋าได้', cap: 'document.print' },
    ],
  },
  {
    title: 'ปิดทริป',
    hint: 'เก็บเข้าแฟ้มและส่งบัญชี',
    docs: [
      { to: 'expense-report', name: 'รายงานค่าใช้จ่าย', desc: 'ส่งบัญชี · A4 แนวนอน', cap: 'expense.edit' },
      { to: 'feedback-report', name: 'รายงานความพึงพอใจ', desc: 'ไม่ระบุตัวตน · A4 แนวตั้ง', cap: 'feedback.view' },
    ],
  },
]

export default function DocumentHub() {
  const navigate = useNavigate()
  const session = getStaffSession()
  const orgId = useActiveOrgId()
  const [orgReady, setOrgReady] = useState(true)

  // เตือนล่วงหน้าถ้ายังไม่ได้ตั้งค่าบริษัท — ดีกว่าให้ไปเจอตอนพิมพ์ออกมาแล้วหัวว่าง
  useEffect(() => {
    let cancelled = false
    supabase
      .from('organizations')
      .select('name, logo_url')
      .eq('id', orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setOrgReady(Boolean(data?.name) && !String(data.name).includes('ยังไม่ได้ตั้งชื่อ'))
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg text-ink-muted ring-1 ring-black/5"
            aria-label="ย้อนกลับ"
          >
            ←
          </button>
          <div>
            <h1 className="text-xl font-bold text-ink">เอกสาร</h1>
            <p className="text-sm text-ink-muted">พิมพ์เป็นรูปเล่ม A4 / A5</p>
          </div>
        </div>

        {!orgReady && can(session, 'org.profile') && (
          <Link
            to="/staff/company-profile"
            className="mb-3 block rounded-control bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
          >
            ยังไม่ได้ตั้งค่าข้อมูลบริษัท — เอกสารจะไม่มีหัวกระดาษ แตะเพื่อกรอก
          </Link>
        )}

        {GROUPS.map((group) => {
          const visible = group.docs.filter((d) => can(session, d.cap))
          if (visible.length === 0) return null

          return (
            <div key={group.title} className="mb-4">
              <p className="mb-1.5 text-xs font-semibold text-ink-faint">
                {group.title}
                <span className="ml-1.5 font-normal">· {group.hint}</span>
              </p>
              <div className="space-y-2">
                {visible.map((doc) => (
                  <Link key={doc.to} to={`/staff/documents/${doc.to}`}>
                    <Card hover className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">{doc.name}</p>
                        <p className="text-xs text-ink-muted">{doc.desc}</p>
                      </div>
                      {doc.sensitive && (
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          อ่อนไหว
                        </span>
                      )}
                      <span className="shrink-0 text-ink-faint">›</span>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )
        })}

        {can(session, 'org.profile') && (
          <Link to="/staff/company-profile">
            <Card hover className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">ข้อมูลบริษัท</p>
                <p className="text-xs text-ink-muted">โลโก้และหัวกระดาษของเอกสารทุกใบ</p>
              </div>
              <span className="shrink-0 text-ink-faint">›</span>
            </Card>
          </Link>
        )}
      </div>
    </div>
  )
}
