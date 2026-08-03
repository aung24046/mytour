import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useActiveOrgId } from '../../lib/staffSession'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import {
  FEEDBACK_TEXT_DEFAULTS,
  FEEDBACK_TEXT_KEYS,
  FEEDBACK_TEXT_LABELS,
} from '../../lib/feedbackFormText'

// ข้อมูลบริษัทสำหรับหัวกระดาษเอกสารทุกใบ (DataSpec §0)
// กรอกครั้งเดียว ใช้กับทุกทริป — ต่างจากข้อมูลทริปที่ดึงจาก tours อัตโนมัติ
//
// สิทธิ์: owner เท่านั้น (ผูกกับตัวตนทางกฎหมายของบริษัท) — gate ที่ route ด้วย RequireRole

const LOGO_BUCKET = 'org-assets'
const MAX_LOGO_BYTES = 2 * 1024 * 1024

const EMPTY_FORM = {
  name: '',
  name_en: '',
  logo_url: '',
  tax_id: '',
  tat_license_no: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  doc_footer_note: '',
  // ข้อความบนแบบประเมินกระดาษ — ปล่อยว่างได้ ระบบจะใช้ค่าตั้งต้นตอนพิมพ์
  ...Object.fromEntries(FEEDBACK_TEXT_KEYS.map((k) => [k, ''])),
  feedback_show_consent: true,
}

export default function CompanyProfile() {
  const orgId = useActiveOrgId()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error: loadError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .maybeSingle()

      if (cancelled) return

      if (loadError) {
        console.error('[CompanyProfile] load failed', loadError)
        // ⚠️ ต้องตั้ง form เป็นค่าว่างเสมอแม้โหลดพัง ไม่งั้น JSX ข้างล่างจะอ่าน form.logo_url
        // จาก null แล้ว throw ทำให้ React ถอดทั้งหน้าทิ้งกลายเป็นจอขาว แทนที่จะเห็นข้อความ error
        setForm(EMPTY_FORM)
        setError(
          // 42P01 = undefined_table — เจอบ่อยสุดคือยังไม่ได้รัน migration
          loadError.code === '42P01' || /relation .* does not exist/i.test(loadError.message ?? '')
            ? 'ยังไม่ได้รัน migration 20260803_export_documents.sql — ตาราง organizations ยังไม่มีคอลัมน์ข้อมูลบริษัท'
            : `โหลดข้อมูลบริษัทไม่สำเร็จ (${loadError.message ?? 'ไม่ทราบสาเหตุ'})`
        )
        setLoading(false)
        return
      }

      setForm({
        name: data?.name ?? '',
        name_en: data?.name_en ?? '',
        logo_url: data?.logo_url ?? '',
        tax_id: data?.tax_id ?? '',
        tat_license_no: data?.tat_license_no ?? '',
        address: data?.address ?? '',
        phone: data?.phone ?? '',
        email: data?.email ?? '',
        website: data?.website ?? '',
        doc_footer_note: data?.doc_footer_note ?? '',
        ...Object.fromEntries(FEEDBACK_TEXT_KEYS.map((k) => [k, data?.[k] ?? ''])),
        feedback_show_consent: data?.feedback_show_consent !== false,
      })
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [orgId])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function handleLogoPick(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // เลือกไฟล์เดิมซ้ำได้
    if (!file) return

    if (file.size > MAX_LOGO_BYTES) {
      setError('ไฟล์โลโก้ใหญ่เกิน 2 MB')
      return
    }

    setUploading(true)
    setError(null)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${orgId}/logo-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true })
      if (upErr) throw upErr

      const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
      set('logo_url', data.publicUrl)
    } catch (err) {
      console.error('[CompanyProfile] logo upload failed', err)
      setError('อัปโหลดโลโก้ไม่สำเร็จ — ตรวจว่ามี bucket "org-assets" แล้วหรือยัง')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError('ต้องกรอกชื่อบริษัท (ไทย)')
      return
    }

    setSaving(true)
    setError(null)

    // upsert เพราะ migration สร้างแถวไว้แล้ว แต่กันกรณี org ใหม่ที่ยังไม่มีแถว
    const { error: saveError } = await supabase.from('organizations').upsert(
      {
        id: orgId,
        ...form,
        name: form.name.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

    setSaving(false)

    if (saveError) {
      console.error('[CompanyProfile] save failed', saveError)
      setError('บันทึกไม่สำเร็จ')
      return
    }
    setSaved(true)
  }

  if (loading || !form) {
    return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  }

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
            <h1 className="text-xl font-bold text-ink">ข้อมูลบริษัท</h1>
            <p className="text-sm text-ink-muted">ใช้เป็นหัวกระดาษของเอกสารทุกใบ</p>
          </div>
        </div>

        {error && (
          <p className="mb-3 rounded-control bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <Card className="mb-3">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex h-22 w-22 shrink-0 flex-col items-center justify-center gap-1 rounded-control border border-dashed border-brand-light bg-surface-sunken text-xs text-ink-muted"
              style={{ height: '88px', width: '88px' }}
            >
              {form.logo_url ? (
                <img src={form.logo_url} alt="โลโก้" className="h-full w-full object-contain p-1" />
              ) : (
                <>
                  <span className="text-lg">+</span>
                  <span>{uploading ? 'กำลังอัปโหลด…' : 'อัปโหลดโลโก้'}</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              onChange={handleLogoPick}
              className="hidden"
            />

            <div className="min-w-0 flex-1 space-y-2">
              <TextField
                label="ชื่อบริษัท (ไทย)"
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="บริษัท มายทัวร์ ทราเวล จำกัด"
              />
              <TextField
                label="ชื่อบริษัท (อังกฤษ)"
                value={form.name_en}
                onChange={(e) => set('name_en', e.target.value)}
                placeholder="MyTour Travel Co., Ltd."
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            PNG พื้นหลังใส ด้านสั้นอย่างน้อย 300px · ไม่เกิน 2 MB
            {form.logo_url && (
              <button
                type="button"
                onClick={() => set('logo_url', '')}
                className="ml-2 font-semibold text-danger"
              >
                ลบโลโก้
              </button>
            )}
          </p>
        </Card>

        <Card className="mb-3 space-y-3">
          <TextField
            label="เลขทะเบียนนิติบุคคล"
            value={form.tax_id}
            onChange={(e) => set('tax_id', e.target.value)}
            placeholder="0105558000000"
            inputMode="numeric"
          />
          <TextField
            label="เลขที่ใบอนุญาต ททท."
            value={form.tat_license_no}
            onChange={(e) => set('tat_license_no', e.target.value)}
            placeholder="11/09999"
          />
          <TextAreaField
            label="ที่อยู่"
            rows={2}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="99/9 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110"
          />
          <TextField
            label="โทรศัพท์"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="02-000-0000"
            inputMode="tel"
          />
          <TextField
            label="อีเมล"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="ops@mytour.co.th"
            inputMode="email"
          />
          <TextField
            label="เว็บไซต์"
            value={form.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="mytour.co.th"
          />
        </Card>

        <Card className="mb-4">
          <TextField
            label="ข้อความท้ายกระดาษ"
            value={form.doc_footer_note}
            onChange={(e) => set('doc_footer_note', e.target.value)}
            placeholder="เอกสารภายใน — ห้ามเผยแพร่"
          />
          <p className="mt-1.5 text-xs text-ink-faint">แสดงท้ายทุกหน้าของเอกสารทุกใบ</p>
        </Card>

        {/* ข้อความบนแบบประเมินฉบับกระดาษ — ตัวคำถามไม่ได้อยู่ตรงนี้ อยู่ที่หน้าจัดการฟอร์ม
            ตรงนี้คือข้อความรอบ ๆ คำถามที่เป็นน้ำเสียงของบริษัท ใช้ร่วมกันทุกทริป */}
        <Card className="mb-4 space-y-3">
          <div>
            <p className="font-semibold text-ink">ข้อความบนแบบประเมิน (ฉบับกระดาษ)</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              เว้นว่างไว้ = ใช้ข้อความมาตรฐาน · ตัวคำถามแก้ที่หน้าจัดการฟอร์ม
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-control bg-surface-sunken px-3 py-2">
            <input
              type="checkbox"
              checked={form.feedback_show_consent}
              onChange={(e) => set('feedback_show_consent', e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="text-sm text-ink">
              แสดงกล่องขอความยินยอมเผยแพร่ + หมายเหตุ PDPA บนฟอร์ม
              <span className="mt-0.5 block text-xs text-ink-muted">
                ปิดได้ถ้าบริษัทเก็บความยินยอมทางอื่นอยู่แล้ว เช่น ในสัญญาตอนจอง
              </span>
            </span>
          </label>

          {FEEDBACK_TEXT_KEYS.map((key) =>
            key === 'feedback_form_title' ? (
              <TextField
                key={key}
                label={FEEDBACK_TEXT_LABELS[key]}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                placeholder={FEEDBACK_TEXT_DEFAULTS[key]}
              />
            ) : (
              <TextAreaField
                key={key}
                label={FEEDBACK_TEXT_LABELS[key]}
                rows={2}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                placeholder={FEEDBACK_TEXT_DEFAULTS[key]}
              />
            )
          )}

          <div className="rounded-control bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {form.feedback_show_consent
              ? 'เมื่อเปิดไว้ ข้อความสองข้อนี้เว้นว่างไม่ได้ — ถ้าเว้น ระบบจะพิมพ์ข้อความมาตรฐานแทน เพราะถ้าไม่มี ความเห็นที่เก็บมาจะนำไปเผยแพร่ไม่ได้ตามกฎหมาย'
              : 'ปิดกล่องยินยอมไว้ — ความเห็นที่เก็บจากฟอร์มนี้จะนำไปใช้ประชาสัมพันธ์ไม่ได้ เว้นแต่มีความยินยอมจากช่องทางอื่นแล้ว'}
          </div>

          <button
            type="button"
            onClick={() => FEEDBACK_TEXT_KEYS.forEach((k) => set(k, ''))}
            className="text-sm font-semibold text-ink-muted underline"
          >
            คืนค่าข้อความมาตรฐานทั้งหมด
          </button>
        </Card>

        <Button onClick={handleSave} disabled={saving || uploading}>
          {saving ? 'กำลังบันทึก…' : saved ? 'บันทึกแล้ว' : 'บันทึก'}
        </Button>
      </div>
    </div>
  )
}
