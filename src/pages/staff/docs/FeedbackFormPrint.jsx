import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, useDocumentContext } from '../../../lib/documentData'
import { MARGIN_MM, PAPER } from '../../../lib/printProfiles'
import { slipNo, slipPrefix } from '../../../lib/feedbackPaper'
import { feedbackText } from '../../../lib/feedbackFormText'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// แบบประเมินฉบับกระดาษ — ฟอร์ม "เปล่า" ไว้พิมพ์แจก ไม่ใช่รายงานผล
//
// ⚠️ อย่าสับสนกับ FeedbackReport.jsx ที่อยู่ในกลุ่ม "ปิดทริป" — ใบนั้นมีคะแนนแล้ว
// ใบนี้คือกระดาษเปล่าสำหรับลูกทัวร์ที่กรอกในมือถือไม่ไหว (ส่วนใหญ่เป็นผู้สูงอายุ)
//
// คำถามทั้งหมดอ่านจาก v_tour_form_fields (form_type = 'feedback') ตัวเดียวกับที่
// ฝั่งแอปใช้ — ห้าม hardcode คำถามลงในไฟล์นี้เด็ดขาด ไม่งั้นวันที่หัวหน้าทัวร์
// แก้คำถามในหน้าจัดการฟอร์ม กระดาษกับแอปจะถามคนละชุดโดยไม่มีใครรู้ตัว
//
// เลขที่ใบพิมพ์มาให้ล่วงหน้า ไม่ให้เขียนมือ เพราะเลขนี้คือกุญแจที่ใช้จับกลุ่ม
// คำตอบของใบเดียวกันตอนคีย์กลับ (ดู migration 20260803_feedback_paper_source.sql)
// ลายมือคนอ่านผิดเมื่อไหร่ ข้อมูลใบนั้นก็กระจัดกระจายทันที

// พิมพ์ทีละใบเป็นค่าตั้งต้น — คนส่วนใหญ่เข้าหน้านี้ครั้งแรกเพื่อ "ดูว่าหน้าตาเป็นยังไง"
// ไม่ใช่เพื่อสั่งพิมพ์ทั้งกอง ตั้ง 20 ไว้แล้วเผลอกดพิมพ์ = กระดาษเสีย 20 แผ่น
const DEFAULT_COPIES = 1
const MAX_COPIES = 120

/** ①②③④⑤ — ใช้ตัวเลขในวงกลมแทนรูปดาว เพราะพิมพ์ขาวดำแล้วดูออกชัดกว่าว่าวงไหนถูกเลือก
 *  และตอนคีย์กลับเข้าระบบ คนคีย์อ่านเป็นตัวเลขได้ตรง ๆ ไม่ต้องนับดาว */
const CIRCLED = ['①', '②', '③', '④', '⑤']

/** พื้นที่พิมพ์จริงของ A4 ตั้ง หลังหักระยะขอบ — เกินนี้เมื่อไหร่คือหลุดไปหน้าสอง */
const USABLE_HEIGHT_MM = PAPER.a4_portrait.heightMm - MARGIN_MM.top - MARGIN_MM.bottom

/** 1mm = 3.7795px ที่ 96dpi — ใช้แปลงความสูงที่วัดได้จากหน้าจอเป็นมิลลิเมตรของกระดาษ
 *  ตัวอย่างจำลองใน DocumentShell ตั้งความกว้างเป็น mm อยู่แล้ว อัตราส่วนจึงตรงกัน */
const PX_PER_MM = 3.779527559

// ความหนาแน่นของเนื้อหา
//
// ⚠️ ทุกขนาดตัวอักษรบนฟอร์มคุมจากตรงนี้ที่เดียว ห้ามเขียน text-[7pt] ปนในคอมโพเนนต์อีก
// เดิมตัวเล็กหลายจุดถูกฝังตายไว้ (7pt/7.5pt/8pt) พอเลือกโหมด "อ่านง่าย" มันก็ยังเล็กเท่าเดิม
// เพราะปรับแค่ฟอนต์หลัก — เป็นสาเหตุที่ฟอร์มอ่านยากทั้งที่เลือกโหมดใหญ่สุดแล้ว
//
// ต่ำกว่า 7pt สระบนล่างของไทยเริ่มติดกัน (TYPE_SCALE.minPt ใน printProfiles)
// จึงไม่มีโหมดไหนที่ tiny ต่ำกว่านั้น
const DENSITY = {
  roomy: {
    id: 'roomy', label: 'ตัวใหญ่',
    base: 11.5, small: 10, tiny: 8.5, title: 16,
    lineHeight: 1.65, rowPadPx: 7, ruleHeightPx: 24, blockGapPx: 12,
  },
  normal: {
    id: 'normal', label: 'มาตรฐาน',
    base: 10.5, small: 9, tiny: 8, title: 15,
    lineHeight: 1.55, rowPadPx: 5, ruleHeightPx: 21, blockGapPx: 9,
  },
  compact: {
    id: 'compact', label: 'กระชับ',
    base: 9.5, small: 8.5, tiny: 7.5, title: 13,
    lineHeight: 1.45, rowPadPx: 3, ruleHeightPx: 17, blockGapPx: 7,
  },
  tight: {
    id: 'tight', label: 'บีบสุด',
    base: 8.5, small: 7.5, tiny: 7, title: 12,
    lineHeight: 1.35, rowPadPx: 2, ruleHeightPx: 14, blockGapPx: 5,
  },
}

export default function FeedbackFormPrint() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.FEEDBACK_FORM)

  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [copies, setCopies] = useState(DEFAULT_COPIES)
  const [startNo, setStartNo] = useState(1)
  const [showQr, setShowQr] = useState(true)
  const [densityId, setDensityId] = useState('normal')

  // วัดความสูงจริงของใบแรกแล้วเทียบกับพื้นที่ A4 — ไม่มีทางเดาถูกจากการอ่านโค้ด
  // เพราะความยาวคำถามกับจำนวนตัวเลือกเปลี่ยนได้ทุกทริป ต้องวัดของจริงเท่านั้น
  const sheetRef = useRef(null)
  const [sheetMm, setSheetMm] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error: err } = await supabase
        .from('v_tour_form_fields')
        .select('id, label, field_type, options, is_required, is_active, sort_order')
        .eq('tour_id', tourId)
        .eq('form_type', 'feedback')
        .order('sort_order')

      if (cancelled) return
      if (err) {
        console.error('[FeedbackFormPrint] load failed', err)
        setError('โหลดคำถามแบบประเมินไม่สำเร็จ')
        setLoading(false)
        return
      }

      setFields((data ?? []).filter((f) => f.is_active !== false))
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  // รวมคำถามให้ดาวที่อยู่ติดกันเป็นตารางเดียว — ถ้าปล่อยให้แต่ละข้อมีแถบ ①–⑤ ของตัวเอง
  // วงกลมจะไม่ตรงคอลัมน์กัน ตาไล่ยาก และกินพื้นที่จนเกิน 1 หน้า
  // เลขข้อ — คนอ่านฟอร์มกระดาษใช้เลขข้อเป็นหมุดนำสายตา ไม่มีเลขแล้วทุกข้อกลืนกันหมด
  // และตอนคีย์กลับ คนคีย์ไล่ "ข้อ 7 ตอบอะไร" ได้เร็วกว่าไล่อ่านชื่อหัวข้อ
  const numberOf = useMemo(() => {
    const map = {}
    fields.forEach((f, i) => {
      map[f.id] = i + 1
    })
    return map
  }, [fields])

  const blocks = useMemo(() => {
    const out = []
    for (const f of fields) {
      const last = out[out.length - 1]
      if (f.field_type === 'rating' && last?.kind === 'ratings') {
        last.items.push(f)
      } else if (f.field_type === 'rating') {
        out.push({ kind: 'ratings', key: f.id, items: [f] })
      } else {
        out.push({ kind: 'single', key: f.id, field: f })
      }
    }
    return out
  }, [fields])

  const prefix = useMemo(() => slipPrefix(ctx.tour?.join_code), [ctx.tour])

  const feedbackUrl = useMemo(() => {
    const code = ctx.tour?.join_code
    if (!code || typeof window === 'undefined') return null
    return `${window.location.origin}/t/${code}/feedback`
  }, [ctx.tour])

  const density = DENSITY[densityId] ?? DENSITY.normal
  const showConsent = ctx.org?.feedback_show_consent !== false

  useLayoutEffect(() => {
    const el = sheetRef.current
    if (!el) return

    const measure = () => setSheetMm(el.getBoundingClientRect().height / PX_PER_MM)
    measure()

    // ฟอนต์ไทยโหลดทีหลัง ความสูงจะขยับหลัง render รอบแรก — ResizeObserver จับได้ทุกกรณี
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [blocks, densityId, showQr, showConsent, loading, ctx.loading])

  const meta = DOC_TITLES.feedback_form

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  const sheets = Array.from({ length: Math.max(1, copies) }, (_, i) => startNo + i)

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_portrait}
      orientationNote={`${copies} ใบ · เลขที่ ${slipNo(prefix, startNo)}–${slipNo(prefix, startNo + copies - 1)}`}
      onPrint={defaultPrint}
      printDisabled={fields.length === 0}
      toolbar={
        <div className="rounded-card bg-white p-4 shadow-card">
          {fields.length === 0 ? (
            <p className="text-sm text-ink-muted">
              ยังไม่มีคำถามในฟอร์ม Feedback — ไปที่ จัดการฟอร์ม → แท็บ “ฟอร์ม Feedback”
              เพื่อสร้างคำถามก่อน แล้วกลับมาพิมพ์
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-ink-muted">
                จำนวนใบ
                <input
                  type="number"
                  min={1}
                  max={MAX_COPIES}
                  value={copies}
                  onChange={(e) =>
                    setCopies(Math.min(MAX_COPIES, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className="mt-1 block w-24 rounded-control border border-gray-200 px-2 py-1.5 text-sm text-ink"
                />
              </label>

              <label className="text-xs text-ink-muted">
                เริ่มที่เลขที่
                <input
                  type="number"
                  min={1}
                  value={startNo}
                  onChange={(e) => setStartNo(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 block w-24 rounded-control border border-gray-200 px-2 py-1.5 text-sm text-ink"
                />
              </label>

              <label className="text-xs text-ink-muted">
                ความหนาแน่น
                <select
                  value={densityId}
                  onChange={(e) => setDensityId(e.target.value)}
                  className="mt-1 block rounded-control border border-gray-200 px-2 py-1.5 text-sm text-ink"
                >
                  {Object.values(DENSITY).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} ({d.base}pt)
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 pb-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={showQr}
                  onChange={(e) => setShowQr(e.target.checked)}
                  className="h-4 w-4"
                />
                แสดง QR ให้สแกนตอบในมือถือ
              </label>

              <PageFitBadge sheetMm={sheetMm} showConsent={showConsent} />

              <p className="w-full text-xs text-ink-muted">
                พิมพ์ต่อรอบสองให้ตั้ง “เริ่มที่เลขที่” ต่อจากชุดเดิม เลขซ้ำจะคีย์กลับไม่ได้
              </p>
            </div>
          )}
        </div>
      }
    >
      {sheets.map((n, i) => (
        <section
          key={n}
          ref={i === 0 ? sheetRef : undefined}
          className={i > 0 ? 'doc-page-break-before' : undefined}
          style={{ fontSize: `${density.base}pt`, lineHeight: density.lineHeight }}
        >
          <FormSheet
            org={ctx.org}
            tour={ctx.tour}
            blocks={blocks}
            slip={slipNo(prefix, n)}
            qrUrl={showQr ? feedbackUrl : null}
            density={density}
            showConsent={showConsent}
            numberOf={numberOf}
          />
          {/* ไม่ใช้ DocumentFooter ที่เอกสารใบอื่นใช้ — ใบนี้ส่งถึงลูกทัวร์ ไม่ใช่แฟ้มภายใน
              เลขที่ใบอยู่มุมขวาบนแล้ว ส่วนวันที่พิมพ์กับโน้ตท้ายกระดาษของบริษัท
              ("เอกสารภายใน — ห้ามเผยแพร่") ไม่ควรไปโผล่บนกระดาษที่แจกลูกค้าอยู่แล้ว */}
        </section>
      ))}
    </DocumentShell>
  )
}

function FormSheet({ org, tour, blocks, slip, qrUrl, density, showConsent, numberOf }) {
  // หัวข้อ "ให้คะแนนรายหัวข้อ" กับคำอธิบายเกณฑ์ ขึ้นครั้งเดียวที่กลุ่มดาวกลุ่มแรกเท่านั้น
  //
  // คำถามชุดจริงมีดาวแยกเป็น 3 กลุ่ม (ภาพรวม → NPS คั่น → 6 หัวข้อ → ... → คะแนนแอป)
  // เดิมทุกกลุ่มพิมพ์แถบหัวข้อกับคำอธิบายของตัวเอง กลายเป็นซ้ำ 3 ชุดโดยไม่ได้ตั้งใจ
  // กินที่ฟรีเกือบ 15mm ซึ่งเป็นสาเหตุหลักที่ฟอร์มล้นไปหน้าสอง
  let firstRatings = true

  return (
    <>
      {/* หัวกระดาษเขียนเองแทน DocumentHeader — ใบนี้ส่งถึงลูกทัวร์ ไม่ใช่คู่ค้า
          จึงไม่ต้องมีเลขทะเบียน/ใบอนุญาต แต่ต้องมีช่องเลขที่กับ QR ซึ่งหัวร่วมไม่มี */}
      <header className="doc-header flex items-start gap-4 border-b-2 border-gray-800 pb-2.5">
        <div className="min-w-0 flex-1">
          <p className="font-medium" style={{ fontSize: `${density.title}pt`, lineHeight: 1.3 }}>
            {feedbackText(org, 'feedback_form_title')}
          </p>
          <p className="mt-0.5 text-gray-600" style={{ fontSize: `${density.small}pt` }}>
            {[tour?.name, org?.name].filter(Boolean).join(' · ')}
          </p>
        </div>

        {qrUrl && (
          <div className="shrink-0 rounded border border-gray-300 px-2 py-1.5 text-center">
            <QRCodeSVG value={qrUrl} size={52} level="M" />
            <p className="mt-1 text-gray-500" style={{ fontSize: `${density.tiny}pt` }}>
              สแกนตอบในมือถือ
            </p>
          </div>
        )}

        <div className="shrink-0 text-right">
          <p className="text-gray-500" style={{ fontSize: `${density.tiny}pt` }}>
            เลขที่
          </p>
          <p className="doc-num font-medium" style={{ fontSize: `${density.title - 2}pt` }}>
            {slip}
          </p>
        </div>
      </header>

      {/* ชื่อกับคำชี้แจงอยู่บรรทัดเดียวกันไม่ได้ — คำชี้แจงยาวจนดันเส้นเขียนชื่อจนสั้นเกินเขียน */}
      <div
        className="flex items-baseline gap-3 text-gray-700"
        style={{ paddingTop: `${density.blockGapPx}px`, fontSize: `${density.small}pt` }}
      >
        <span className="flex-1">
          ชื่อ–นามสกุล{' '}
          <span className="inline-block w-3/5 border-b border-dotted border-gray-400" />
        </span>
      </div>
      {/* ข้อความที่แอดมินลบจนว่างต้องไม่เหลือ <p> เปล่าไว้กินระยะขอบ — บนกระดาษที่พื้นที่
          เหลือไม่ถึง 10mm ช่องว่างลอย ๆ แบบนี้คือตัวที่ดันฟอร์มไปหน้าสอง */}
      {feedbackText(org, 'feedback_form_intro') && (
        <p
          className="text-gray-500"
          style={{
            marginTop: `${Math.round(density.blockGapPx / 2)}px`,
            fontSize: `${density.small}pt`,
          }}
        >
          {feedbackText(org, 'feedback_form_intro')}
        </p>
      )}

      <div style={{ marginTop: `${density.blockGapPx}px` }}>
        {blocks.map((b) => {
          if (b.kind !== 'ratings') {
            return (
              <SingleField
                key={b.key}
                field={b.field}
                density={density}
                no={numberOf[b.field.id]}
              />
            )
          }
          const withHeader = firstRatings
          firstRatings = false
          return (
            <RatingTable
              key={b.key}
              items={b.items}
              density={density}
              numberOf={numberOf}
              heading={withHeader ? feedbackText(org, 'feedback_rating_heading') : null}
              legend={withHeader ? feedbackText(org, 'feedback_rating_legend') : null}
            />
          )
        })}
      </div>

      {/* ความยินยอมเผยแพร่ — ปิดได้ที่ ข้อมูลบริษัท สำหรับบริษัทที่เก็บความยินยอมทางอื่นแล้ว
          แต่ถ้าเปิดไว้ ข้อความจะว่างไม่ได้ — feedbackText() คืนค่าตั้งต้นให้เสมอ */}
      {showConsent && (
        <div
          className="rounded border border-gray-400 px-3 py-1.5"
          style={{ marginTop: `${density.blockGapPx + 2}px`, fontSize: `${density.small}pt` }}
        >
          <p>{feedbackText(org, 'feedback_consent_text')}</p>
          <p className="mt-1 text-gray-500" style={{ fontSize: `${density.tiny}pt` }}>
            {feedbackText(org, 'feedback_pdpa_note')}
          </p>
        </div>
      )}

      {feedbackText(org, 'feedback_thanks_note') && (
        <p
          className="text-center text-gray-600"
          style={{ marginTop: `${density.blockGapPx}px`, fontSize: `${density.small}pt` }}
        >
          {feedbackText(org, 'feedback_thanks_note')}
        </p>
      )}
    </>
  )
}

// ป้ายบอกว่าใบนี้ลง A4 หน้าเดียวได้จริงไหม
//
// มีเพราะพรีวิวบนจอไม่ได้แบ่งหน้าให้เห็น กว่าจะรู้ว่าล้นก็ตอนกระดาษออกมาจากเครื่องแล้ว
// วัดจาก DOM จริงจึงแม่นกว่าการเดา และรองรับกรณีที่หัวหน้าทัวร์เพิ่มคำถามเองทีหลัง
function PageFitBadge({ sheetMm, showConsent }) {
  if (sheetMm == null) return null

  const over = sheetMm - USABLE_HEIGHT_MM
  const fits = over <= 0

  return (
    <div
      className={`w-full rounded-control px-3 py-2 text-xs ${
        fits ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'
      }`}
    >
      {fits ? (
        <>
          ลง A4 หน้าเดียวได้ · ใช้พื้นที่ {Math.round(sheetMm)} จาก {USABLE_HEIGHT_MM} mm
          {over > -12 && ' (เหลือน้อย — ถ้าเพิ่มคำถามอีกจะล้น)'}
        </>
      ) : (
        <>
          เกินหน้า A4 อยู่ ~{Math.round(over)} mm — ลองปรับความหนาแน่นให้แน่นขึ้น
          {showConsent && ' หรือปิดกล่องยินยอมที่ ข้อมูลบริษัท'} หรือลดจำนวนคำถาม
        </>
      )}
    </div>
  )
}

/** ข้อความตัวเลือกอาจเป็นสตริงหรือ { label, value } — จุดเดียวที่แปลงให้ทั้งไฟล์ */
function optionText(o) {
  return typeof o === 'string' ? o : (o?.label ?? o?.value ?? '')
}

/** สเกลตัวเลขแบบ NPS: ตัวเลือกทุกตัวขึ้นต้นด้วยตัวเลข และมีเยอะกว่า 5 ตัว
 *  รูปแบบนี้ถ้าปล่อยให้ไหลเป็นชิป ☐ ต่อกันจะตัดบรรทัดมั่วและอ่านยากที่สุดในฟอร์ม */
function isNumericScale(options) {
  return options.length >= 6 && options.every((o) => /^\s*\d+/.test(optionText(o)))
}

function QuestionLabel({ no, children, density }) {
  return (
    <span>
      {no != null && (
        <span
          className="mr-1.5 font-medium text-gray-500"
          style={{ fontSize: `${density.small}pt` }}
        >
          {no}.
        </span>
      )}
      {children}
    </span>
  )
}

function SectionBar({ children, density }) {
  return (
    <div
      className="bg-gray-100 px-2 py-1 font-medium"
      style={{
        marginTop: `${density.blockGapPx}px`,
        fontSize: `${density.small}pt`,
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
    >
      {children}
    </div>
  )
}

function RatingTable({ items, heading, legend, density, numberOf }) {
  const pad = `${density.rowPadPx}px`

  return (
    <>
      {heading && <SectionBar density={density}>{heading}</SectionBar>}
      <table className="doc-table mt-1 w-full table-fixed border-collapse">
        {heading && (
          <thead>
            <tr className="text-gray-500" style={{ fontSize: `${density.tiny}pt` }}>
              <td className="px-1 py-0.5" />
              <td className="w-[38%] px-1 py-0.5 text-center">น้อย ←→ มาก</td>
            </tr>
          </thead>
        )}
        <tbody>
          {items.map((f, i) => (
            // แถบสลับสีอ่อน ๆ ช่วยให้สายตาไล่จากชื่อหัวข้อไปถึงวงกลมฝั่งขวาได้ไม่หลุดแถว
            // ระยะระหว่างสองฝั่งกว้างเกือบเต็มหน้ากระดาษ ถ้าไม่มีอะไรนำสายตาจะกาผิดแถวง่ายมาก
            <tr
              key={f.id}
              className="border-t border-gray-200"
              style={{
                background: i % 2 === 1 ? '#f4f4f4' : undefined,
                printColorAdjust: 'exact',
                WebkitPrintColorAdjust: 'exact',
              }}
            >
              <td className="px-1.5 align-middle" style={{ paddingTop: pad, paddingBottom: pad }}>
                <QuestionLabel no={numberOf?.[f.id]} density={density}>
                  {f.label}
                </QuestionLabel>
              </td>
              <td
                className="align-middle"
                style={{ paddingTop: pad, paddingBottom: pad }}
              >
                {/* วงกลมกระจายเต็มความกว้างคอลัมน์เท่า ๆ กัน แทนการเรียงชิดขวาด้วย letter-spacing
                    ทำให้แต่ละระดับอยู่ตรงคอลัมน์เดียวกันทุกแถว ไล่สายตาลงมาแล้วตรง */}
                <div className="flex justify-between px-2">
                  {CIRCLED.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {legend && (
        <p className="mt-1 text-gray-500" style={{ fontSize: `${density.tiny}pt` }}>
          {legend}
        </p>
      )}
    </>
  )
}

// ตัวเลือกวางเป็นกริดคอลัมน์ตรงกัน ไม่ใช่ปล่อยไหลต่อกันเป็นชิป
//
// ของเดิมใช้ flex-wrap ผลคือแต่ละบรรทัดมีจำนวนตัวเลือกไม่เท่ากันและช่อง ☐ ไม่ตรงแนวกันเลย
// สายตาต้องไล่หาช่องกาใหม่ทุกบรรทัด — นี่คือสาเหตุหลักที่ฟอร์มอ่านยากทั้งที่ตัวอักษรใหญ่พอแล้ว
function OptionGrid({ options, density }) {
  const longest = options.reduce((n, o) => Math.max(n, optionText(o).length), 0)
  // ความกว้างที่พิมพ์ได้ ~186mm หาร 3 คอลัมน์ = ~62mm ตัวไทยที่ 9pt กว้างราวครึ่ง em
  // จึงพอราว 30 ตัวอักษรต่อคอลัมน์ — ตั้งเกณฑ์ต่ำกว่านั้นไว้กันเหนียว
  // ถ้าข้อความยาวเกินจนตัดบรรทัดในช่อง กริดยังคุมให้ ☐ ตรงแนวกันอยู่ ไม่ใช่ความเสียหายร้ายแรง
  const cols = longest > 32 ? 1 : longest > 24 ? 2 : 3

  return (
    <div
      className="mt-1.5 grid text-gray-800"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        columnGap: '10px',
        rowGap: `${Math.round(density.blockGapPx / 2) + 2}px`,
        fontSize: `${density.small}pt`,
      }}
    >
      {options.map((o, i) => (
        <span key={`${optionText(o)}-${i}`} className="flex items-baseline gap-1.5">
          <span>☐</span>
          <span className="min-w-0 flex-1">
            {optionText(o)}
            {/* ตัวเลือกที่เปิดช่อง "โปรดระบุ" ต้องมีเส้นให้เขียนบนกระดาษด้วย */}
            {o?.hasText && (
              <span className="ml-1 inline-block w-16 border-b border-dotted border-gray-400" />
            )}
          </span>
        </span>
      ))}
    </div>
  )
}

// สเกล 0–10 (NPS) — ช่องสี่เหลี่ยมเรียงเป็นแถวเดียว มีคำกำกับปลายสองข้าง
// อ่านแล้วเข้าใจทันทีว่าเป็นมาตรวัด ต่างจากชิป ☐ 11 อันที่ดูเหมือนตัวเลือกทั่วไป
function NumericScale({ options, density }) {
  const parsed = options.map((o) => {
    const text = optionText(o)
    const num = text.match(/^\s*(\d+)/)?.[1] ?? text
    const anchor = text.match(/\(([^)]*)\)/)?.[1] ?? null
    return { num, anchor }
  })

  const first = parsed[0]
  const last = parsed[parsed.length - 1]

  return (
    <div className="mt-1.5">
      <div className="flex items-stretch gap-1">
        {parsed.map((p) => (
          <div
            key={p.num}
            className="flex-1 border border-gray-400 text-center"
            style={{
              paddingTop: `${density.rowPadPx}px`,
              paddingBottom: `${density.rowPadPx}px`,
              fontSize: `${density.small}pt`,
            }}
          >
            {p.num}
          </div>
        ))}
      </div>
      {(first?.anchor || last?.anchor) && (
        <div
          className="mt-0.5 flex justify-between text-gray-500"
          style={{ fontSize: `${density.tiny}pt` }}
        >
          <span>{first?.anchor}</span>
          <span>{last?.anchor}</span>
        </div>
      )}
    </div>
  )
}

function SingleField({ field, density, no }) {
  const options = Array.isArray(field.options) ? field.options : []
  // ระยะเหนือคำถามต้องมากกว่าระยะระหว่างคำถามกับตัวเลือกของมันเอง
  // ไม่งั้นตัวเลือกจะดูเหมือนเป็นของคำถามถัดไป
  const blockStyle = { marginTop: `${density.blockGapPx + 3}px`, fontSize: `${density.base}pt` }
  const label = (
    <QuestionLabel no={no} density={density}>
      {field.label}
    </QuestionLabel>
  )

  switch (field.field_type) {
    case 'checkbox':
    case 'radio':
    case 'select':
      return (
        <div className="border-t border-gray-200 pt-1.5" style={blockStyle}>
          <p>
            {label}
            <span className="ml-1.5 text-gray-500" style={{ fontSize: `${density.tiny}pt` }}>
              {field.field_type === 'checkbox' ? '(ตอบได้หลายข้อ)' : '(เลือก 1 ข้อ)'}
            </span>
          </p>
          {options.length === 0 ? (
            <div className="mt-2 border-b border-dotted border-gray-400" />
          ) : isNumericScale(options) ? (
            <NumericScale options={options} density={density} />
          ) : (
            <OptionGrid options={options} density={density} />
          )}
        </div>
      )

    case 'textarea':
      return (
        <div className="border-t border-gray-200 pt-1.5" style={blockStyle}>
          <p>{label}</p>
          <div className="mt-1.5">
            {/* 2 บรรทัด — เดิม 3 บรรทัดแต่กินพื้นที่จนฟอร์มล้นหน้า
                คนที่อยากเขียนยาวจริง ๆ เขียนล้นออกนอกเส้นได้อยู่แล้ว ไม่ใช่ข้อจำกัดจริง */}
            {[0, 1].map((i) => (
              <div
                key={i}
                className="border-b border-gray-300"
                style={{ height: `${density.ruleHeightPx}px` }}
              />
            ))}
          </div>
        </div>
      )

    default:
      return (
        <div className="border-t border-gray-200 pt-1.5" style={blockStyle}>
          <p>
            {label}{' '}
            <span className="inline-block w-1/2 border-b border-dotted border-gray-400" />
          </p>
        </div>
      )
  }
}
