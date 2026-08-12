import { QRCodeSVG } from 'qrcode.react'

import { DOC_TITLES, DOC_TYPES, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'
import DocumentHeader from '../../../components/document/DocumentHeader'

// โปสเตอร์ QR เข้าร่วมทริป — A4 ตั้ง ติดที่จุดนัดพบ/หน้ารถ
//
// ทำไมต้องมี: ตอน onboarding ทีมงานต้องบอกรหัสทริปทีละคน หรือส่งลิงก์ในกลุ่มแล้ว
// คนที่เข้ากลุ่มไม่ทันก็หาไม่เจอ ใบนี้ให้สแกนเองได้เลย และรหัสตัวใหญ่ไว้พิมพ์มือ
// สำหรับคนที่กล้องสแกนไม่ติด
//
// ⚠️ ใบนี้ "ตั้งใจ" ให้ join_code โผล่บนกระดาษ ต่างจากเอกสารใบอื่นที่ห้ามแสดง
//    (ดู DocumentHeader — เอกสารส่งคู่ค้าไม่ควรมีรหัสเข้าทริปติดไป)
//    เพราะใบนี้มีไว้ให้ลูกทัวร์อ่านโดยเฉพาะ ไม่ใช่ใบที่ส่งออกไปข้างนอก
export default function JoinPoster() {
  const ctx = useDocumentContext(DOC_TYPES.JOIN_POSTER)
  const meta = DOC_TITLES.join_poster

  const joinCode = ctx.tour?.join_code ?? ''
  const joinUrl =
    joinCode && typeof window !== 'undefined' ? `${window.location.origin}/t/${joinCode}` : ''

  if (ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (ctx.error) return <p className="p-8 text-center text-danger">{ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_portrait}
      orientationNote="A4 แนวตั้ง · ติดที่จุดนัดพบ"
      onPrint={defaultPrint}
    >
      <DocumentHeader
        org={ctx.org}
        tour={ctx.tour}
        leader={ctx.leader}
        title={meta.title}
        subtitle={meta.subtitle}
      />

      <div className="flex flex-col items-center pt-6 text-center">
        <p className="text-[13pt] text-gray-500">ยินดีต้อนรับสู่</p>
        <h2 className="mt-1 px-6 text-[26pt] font-medium leading-tight">{ctx.tour?.name}</h2>

        <p className="mt-6 text-[12pt] text-gray-600">สแกนเพื่อลงทะเบียนและดูข้อมูลทริป</p>

        <div className="mt-3 border-2 border-gray-800 p-4">
          {joinUrl ? (
            <QRCodeSVG value={joinUrl} size={300} level="M" />
          ) : (
            <div className="flex h-[300px] w-[300px] items-center justify-center text-gray-400">
              ทริปนี้ยังไม่มีรหัสเข้าร่วม
            </div>
          )}
        </div>

        {joinCode && (
          <>
            <p className="mt-5 text-[11pt] text-gray-600">สแกนไม่ได้? เข้าเว็บแล้วกรอกรหัสนี้</p>
            <p
              className="doc-num mt-1 text-[34pt] font-medium leading-none tracking-[0.12em]"
              style={{ letterSpacing: '0.12em' }}
            >
              {joinCode}
            </p>
            <p className="doc-num mt-2 text-[11pt] text-gray-500">{joinUrl}</p>
          </>
        )}

        {/* ขั้นตอน — เขียนสั้นที่สุดเท่าที่จะสั้นได้ คนอ่านยืนอยู่หน้ารถ ไม่มีเวลาอ่านย่อหน้า */}
        <ol className="mt-8 w-full max-w-[130mm] text-left text-[11pt] leading-relaxed">
          <li className="border-t border-gray-300 py-2">1. เปิดกล้องมือถือ สแกน QR ด้านบน</li>
          <li className="border-t border-gray-300 py-2">2. กรอกชื่อและข้อมูลติดต่อ</li>
          <li className="border-t border-b border-gray-300 py-2">
            3. เก็บหน้า QR ของตัวเองไว้ ใช้ตอนเช็คอินขึ้นรถ
          </li>
        </ol>

        {ctx.leader && (
          <p className="mt-6 text-[11pt] text-gray-700">
            มีปัญหาการลงทะเบียน ติดต่อ {ctx.leader.name}
            {ctx.leader.phone && <span className="doc-num"> · {ctx.leader.phone}</span>}
          </p>
        )}
      </div>
    </DocumentShell>
  )
}
