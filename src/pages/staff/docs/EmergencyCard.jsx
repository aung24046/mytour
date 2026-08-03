import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// บัตรฉุกเฉิน (DataSpec §6) — A5 แนวนอน พับครึ่งแล้วพกใส่กระเป๋าได้
// ด้านซ้าย = เบอร์ + ที่พัก · ด้านขวา = ประโยคช่วยเหลือจาก phrasebook
export default function EmergencyCard() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.EMERGENCY_CARD)

  const [contacts, setContacts] = useState([])
  const [hotels, setHotels] = useState([])
  const [phrases, setPhrases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [contactsRes, hotelsRes, phrasesRes] = await Promise.all([
        supabase
          .from('v_tour_emergency_contacts')
          .select('label, phone, category, sort_order, is_active')
          .eq('tour_id', tourId)
          .order('sort_order'),
        supabase
          .from('hotels')
          .select('id, name, check_in_date, check_out_date, general_info')
          .eq('tour_id', tourId)
          .order('check_in_date'),
        supabase.from('v_tour_phrasebook').select('*').eq('tour_id', tourId).limit(60),
      ])

      if (cancelled) return
      if (contactsRes.error) {
        console.error('[EmergencyCard] load failed', contactsRes.error)
        setError('โหลดเบอร์ฉุกเฉินไม่สำเร็จ')
        setLoading(false)
        return
      }

      setContacts((contactsRes.data ?? []).filter((c) => c.is_active !== false))
      setHotels(hotelsRes.data ?? [])
      setPhrases(phrasesRes.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  // phrasebook มีคอลัมน์ไม่แน่นอนระหว่างทริป — คัดเฉพาะหมวดฉุกเฉินแล้วเดาชื่อคอลัมน์แบบยืดหยุ่น
  const emergencyPhrases = useMemo(() => {
    return phrases
      .filter((p) => {
        const cat = String(p.category ?? p.category_key ?? '').toLowerCase()
        return cat.includes('emergency') || cat.includes('ฉุกเฉิน') || cat.includes('help')
      })
      .slice(0, 6)
      .map((p) => ({
        th: p.text_th ?? p.th ?? p.label_th ?? '',
        local: p.text_local ?? p.local ?? p.translation ?? p.text_en ?? '',
        pronounce: p.pronunciation ?? p.romanization ?? '',
      }))
      .filter((p) => p.th)
  }, [phrases])

  const joinUrl =
    ctx.tour?.join_code && typeof window !== 'undefined'
      ? `${window.location.origin}/t/${ctx.tour.join_code}`
      : ''

  const meta = DOC_TITLES.emergency_card

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a5_landscape}
      orientationNote="A5 แนวนอน · พับครึ่งแล้วพกได้"
      onPrint={defaultPrint}
    >
      <div className="grid grid-cols-2 gap-4">
        {/* ด้านหน้า */}
        <div className="pr-4" style={{ borderRight: '1px dashed #9ca3af' }}>
          <h3 className="border-b-2 border-gray-800 pb-1 text-[10pt] font-medium">
            เบอร์ฉุกเฉิน
          </h3>
          <table className="mt-1.5 w-full text-[8pt]">
            <tbody>
              {ctx.leader && (
                <tr>
                  <td className="py-0.5">หัวหน้าทัวร์ {ctx.leader.name}</td>
                  <td className="doc-num py-0.5 text-right">{ctx.leader.phone}</td>
                </tr>
              )}
              {contacts.map((c, i) => (
                <tr key={i}>
                  <td className="py-0.5">{c.label}</td>
                  <td className="doc-num py-0.5 text-right">{c.phone}</td>
                </tr>
              ))}
              {ctx.org?.phone && (
                <tr>
                  <td className="py-0.5">{ctx.org.name}</td>
                  <td className="doc-num py-0.5 text-right">{ctx.org.phone}</td>
                </tr>
              )}
            </tbody>
          </table>

          {hotels.length > 0 && (
            <div
              className="mt-2 rounded bg-gray-100 px-1.5 py-1 text-[7.5pt]"
              style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
            >
              {hotels.map((h) => (
                <div key={h.id} className="mb-1 last:mb-0">
                  <span className="font-medium">{h.name}</span>
                  {h.general_info && <div className="text-gray-600">{h.general_info}</div>}
                </div>
              ))}
            </div>
          )}

          <p className="mt-2 text-[7pt] text-gray-500">
            {ctx.tour?.name} · {ctx.tour?.join_code}
          </p>
        </div>

        {/* ด้านหลัง */}
        <div>
          <h3 className="border-b-2 border-gray-800 pb-1 text-[10pt] font-medium">
            ประโยคช่วยเหลือ
          </h3>

          {emergencyPhrases.length > 0 ? (
            <div className="mt-1.5 space-y-1 text-[8pt]">
              {emergencyPhrases.map((p, i) => (
                <div key={i}>
                  <span>{p.th}</span>
                  {p.local && <span className="text-gray-600"> — {p.local}</span>}
                  {p.pronounce && <span className="text-gray-500"> ({p.pronounce})</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[8pt] text-gray-400">
              ยังไม่มีประโยคหมวดฉุกเฉินในคลังศัพท์ของทริปนี้
            </p>
          )}

          {joinUrl && (
            <div className="mt-3 flex items-center gap-2 border-t border-gray-300 pt-2">
              <QRCodeSVG value={joinUrl} size={44} />
              <p className="text-[7pt] text-gray-500">
                สแกนดูเบอร์ แผนที่ และกำหนดการล่าสุดในแอป
              </p>
            </div>
          )}

          {ctx.org?.doc_footer_note && (
            <p className="mt-2 text-[7pt] text-gray-400">{ctx.org.doc_footer_note}</p>
          )}
        </div>
      </div>
    </DocumentShell>
  )
}
