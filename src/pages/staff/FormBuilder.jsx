import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { groupFieldsByCategory, CATEGORY_STYLE } from '../../lib/formFieldGroups'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import SelectField from '../../components/common/SelectField'
import BottomSheet from '../../components/common/BottomSheet'
import DynamicField from '../../components/common/DynamicField'
import Icon from '../../components/common/Icon'

const FIELD_TYPES = [
  { value: 'text', label: 'ข้อความสั้น' },
  { value: 'phone', label: 'เบอร์โทรศัพท์' },
  { value: 'textarea', label: 'ข้อความยาว' },
  { value: 'select', label: 'ตัวเลือกเดียว (dropdown)' },
  { value: 'radio', label: 'ตัวเลือกเดียว (ปุ่มกลม)' },
  { value: 'checkbox', label: 'เลือกได้หลายข้อ' },
  { value: 'date', label: 'วันที่ (wheel เลื่อน)' },
  { value: 'duration', label: 'ระยะเวลา (ชม./นาที)' },
  { value: 'rating', label: 'คะแนนดาว (1-5)' },
]

// สลับระหว่างฟอร์มลงทะเบียน (เดิม) กับฟอร์ม Feedback — ใช้ form_fields ตารางเดียวกัน แยกด้วยคอลัมน์ form_type
const FORM_TYPES = [
  { value: 'registration', label: 'ฟอร์มลงทะเบียน' },
  { value: 'feedback', label: 'ฟอร์ม Feedback' },
]

// หมวดหมู่ ใช้จัดกลุ่มคำถามตอนแสดงผลในฟอร์มลงทะเบียน/หน้าแก้ไขข้อมูลลูกทัวร์
const CATEGORIES = [
  { value: 'personal', label: 'ข้อมูลส่วนตัวพื้นฐาน' },
  { value: 'health', label: 'สุขภาพ ความปลอดภัย และอาหาร' },
  { value: 'emergency', label: 'ผู้ติดต่อฉุกเฉิน' },
  { value: 'other', label: 'อื่นๆ' },
]

// field_purpose ให้ฟีเจอร์อื่น (Dashboard, CheckIn) หา field ที่ต้องการได้โดยไม่ hardcode field_key
const FIELD_PURPOSES = [
  { value: 'generic', label: 'ทั่วไป' },
  { value: 'phone', label: 'เบอร์โทรลูกทัวร์' },
  { value: 'emergency_contact', label: 'ผู้ติดต่อฉุกเฉิน' },
  { value: 'dietary', label: 'ข้อจำกัดด้านอาหาร' },
  { value: 'medical', label: 'ข้อมูลสุขภาพ/โรคประจำตัว' },
]

const EMPTY_DRAFT = {
  id: null,
  is_core: false,
  label: '',
  field_type: 'text',
  field_purpose: 'generic',
  category: 'other',
  is_required: false,
  optionsText: '', // one option per line — ต่อท้ายด้วย * เพื่อเปิดช่อง "โปรดระบุ"
}

// แปลงบรรทัด option → {value, label, hasText?, textPlaceholder?}
// ธรรมเนียม: พิมพ์ * ต่อท้ายบรรทัดไหน จะเปิดช่องกรอกข้อความเพิ่มเมื่อลูกทัวร์เลือกข้อนั้น (เช่น "อื่นๆ โปรดระบุ*")
function parseOptionLine(line) {
  const hasText = line.trim().endsWith('*')
  const clean = hasText ? line.trim().slice(0, -1).trim() : line.trim()
  return hasText
    ? { value: clean, label: clean, hasText: true, textPlaceholder: 'โปรดระบุ' }
    : { value: clean, label: clean }
}

function optionsToText(options) {
  if (!Array.isArray(options)) return ''
  return options.map((o) => `${o.label ?? o.value ?? ''}${o.hasText ? '*' : ''}`).join('\n')
}

const NEEDS_OPTIONS = ['select', 'checkbox', 'radio']

export default function FormBuilder() {
  const { t } = useTranslation()

  const [formType, setFormType] = useState('registration') // 'registration' | 'feedback'
  const [mode, setMode] = useState('edit') // 'edit' | 'preview'
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [previewValues, setPreviewValues] = useState({})

  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState('new') // 'new' | 'edit'
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [savingSheet, setSavingSheet] = useState(false)

  async function loadFields(type) {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('form_fields')
      .select('*')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .eq('form_type', type)
      .order('sort_order', { ascending: true })

    if (fetchError) {
      console.error('[FormBuilder] load failed', fetchError)
      setError(t('staff.formBuilder.loadError'))
    } else {
      setFields(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadFields(formType)
    setPreviewValues({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formType])

  async function updateField(id, patch) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
    const { error: updateError } = await supabase.from('form_fields').update(patch).eq('id', id)
    if (updateError) {
      console.error('[FormBuilder] update failed', updateError)
      loadFields(formType)
    }
  }

  async function moveField(index, direction) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= fields.length) return

    const a = fields[index]
    const b = fields[targetIndex]

    const reordered = [...fields]
    reordered[index] = { ...a, sort_order: b.sort_order }
    reordered[targetIndex] = { ...b, sort_order: a.sort_order }
    reordered.sort((x, y) => x.sort_order - y.sort_order)
    setFields(reordered)

    await Promise.all([
      supabase.from('form_fields').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('form_fields').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
  }

  async function deleteField(field) {
    if (field.is_core) {
      // Core fields power other features (guests columns) — never hard-delete, only hide.
      await updateField(field.id, { is_active: false })
      return
    }
    setFields((prev) => prev.filter((f) => f.id !== field.id))
    const { error: deleteError } = await supabase.from('form_fields').delete().eq('id', field.id)
    if (deleteError) {
      console.error('[FormBuilder] delete failed', deleteError)
      loadFields(formType)
    }
  }

  function openNewSheet() {
    setSheetMode('new')
    setDraft(EMPTY_DRAFT)
    setSheetOpen(true)
  }

  function openEditSheet(field) {
    setSheetMode('edit')
    setDraft({
      id: field.id,
      is_core: field.is_core,
      label: field.label ?? '',
      field_type: field.field_type ?? 'text',
      field_purpose: field.field_purpose ?? 'generic',
      category: field.category ?? 'other',
      is_required: field.is_required ?? false,
      optionsText: optionsToText(field.options),
    })
    setSheetOpen(true)
  }

  async function saveSheet() {
    if (!draft.label.trim()) return
    setSavingSheet(true)

    const options = NEEDS_OPTIONS.includes(draft.field_type)
      ? draft.optionsText.split('\n').map((l) => l.trim()).filter(Boolean).map(parseOptionLine)
      : null

    if (sheetMode === 'new') {
      const maxSort = fields.reduce((max, f) => Math.max(max, f.sort_order), 0)
      const { error: insertError } = await supabase.from('form_fields').insert({
        tour_id: ACTIVE_TOUR_ID,
        form_type: formType,
        field_key: `custom_${Date.now()}`,
        label: draft.label.trim(),
        field_type: draft.field_type,
        field_purpose: formType === 'feedback' ? 'generic' : draft.field_purpose,
        category: formType === 'feedback' ? 'other' : draft.category,
        options,
        is_required: draft.is_required,
        is_core: false,
        is_active: true,
        sort_order: maxSort + 1,
      })
      if (insertError) {
        console.error('[FormBuilder] create failed', insertError)
      } else {
        setSheetOpen(false)
        loadFields(formType)
      }
    } else {
      const patch = {
        label: draft.label.trim(),
        field_type: draft.field_type,
        is_required: draft.is_required,
        options,
        ...(formType === 'registration'
          ? { category: draft.category, field_purpose: draft.field_purpose }
          : {}),
      }
      await updateField(draft.id, patch)
      setSheetOpen(false)
    }
    setSavingSheet(false)
  }

  const activeFields = fields.filter((f) => f.is_active)

  function fieldTypeLabel(type) {
    return FIELD_TYPES.find((ft) => ft.value === type)?.label ?? type
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.formBuilder.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('staff.formBuilder.subtitle')}</p>

        {/* สลับชนิดฟอร์ม */}
        <div className="mt-3 flex gap-2">
          {FORM_TYPES.map((ft) => (
            <button
              key={ft.value}
              onClick={() => setFormType(ft.value)}
              className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
                formType === ft.value ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
              }`}
            >
              {ft.label}
            </button>
          ))}
        </div>

        {/* สลับ แก้ไข / ดูตัวอย่าง */}
        <div className="mt-3 inline-flex rounded-full bg-gray-100 p-1">
          <button
            onClick={() => setMode('edit')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              mode === 'edit' ? 'bg-sky-600 text-white' : 'text-gray-600'
            }`}
          >
            {t('staff.formBuilder.modeEdit')}
          </button>
          <button
            onClick={() => setMode('preview')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              mode === 'preview' ? 'bg-sky-600 text-white' : 'text-gray-600'
            }`}
          >
            {t('staff.formBuilder.modePreview')}
          </button>
        </div>

        {loading && <p className="mt-4 text-gray-500">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-red-500">{error}</p>}

        {/* โหมดแก้ไข */}
        {!loading && !error && mode === 'edit' && (
          <>
            <button
              onClick={openNewSheet}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-accent bg-accent-bg px-4 py-2.5 text-sm font-semibold text-accent-text"
            >
              <span aria-hidden="true">＋</span> {t('staff.formBuilder.addField')}
            </button>

            {fields.length === 0 && (
              <p className="mt-4 text-sm text-gray-400">{t('staff.formBuilder.noFields')}</p>
            )}

            <div className="mt-3 flex flex-col gap-2">
              {fields.map((field, index) => {
                const st = CATEGORY_STYLE[field.category] || CATEGORY_STYLE.other
                return (
                  <div
                    key={field.id}
                    className={`flex items-start gap-2 rounded-xl border border-gray-100 bg-white px-2.5 py-2.5 ${
                      field.is_active ? '' : 'opacity-50'
                    }`}
                  >
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button
                        onClick={() => moveField(index, -1)}
                        disabled={index === 0}
                        className="rounded bg-gray-100 px-1.5 text-xs text-gray-500 disabled:opacity-30"
                        aria-label={t('staff.guideBuilder.moveUp')}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveField(index, 1)}
                        disabled={index === fields.length - 1}
                        className="rounded bg-gray-100 px-1.5 text-xs text-gray-500 disabled:opacity-30"
                        aria-label={t('staff.guideBuilder.moveDown')}
                      >
                        ▼
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {field.label}
                        {field.is_required && <span className="text-red-500"> *</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">
                        {fieldTypeLabel(field.field_type)}
                        {field.is_core && ` · ${t('staff.formBuilder.coreTag')}`}
                        {!field.is_active && ` · ${t('staff.formBuilder.hide')}`}
                      </p>
                    </div>

                    {formType === 'registration' && (
                      <span
                        className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold"
                        style={{ background: st.tint, color: st.text }}
                      >
                        {t(`guest.register.category.${field.category ?? 'other'}`)}
                      </span>
                    )}

                    <button
                      onClick={() => updateField(field.id, { is_active: !field.is_active })}
                      className="shrink-0 text-gray-400"
                      aria-label={field.is_active ? t('staff.formBuilder.hide') : t('staff.formBuilder.show')}
                    >
                      <Icon name={field.is_active ? 'check' : 'lock'} size={16} />
                    </button>
                    <button
                      onClick={() => openEditSheet(field)}
                      className="shrink-0 text-sky-600"
                      aria-label={t('staff.formBuilder.fieldSettings')}
                    >
                      <Icon name="settings" size={16} color="#0891b2" />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* โหมดดูตัวอย่าง — ฟอร์มจริงที่ลูกทัวร์จะเห็น */}
        {!loading && !error && mode === 'preview' && (
          <div className="mt-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs text-gray-500">
              <Icon name="search" size={13} />
              {t('staff.formBuilder.previewHint')}
            </p>
            {activeFields.length === 0 && (
              <p className="text-sm text-gray-400">{t('staff.formBuilder.noFields')}</p>
            )}
            <div className="flex flex-col gap-3.5">
              {groupFieldsByCategory(activeFields).map(({ category, fields: groupFields }) => {
                const st = CATEGORY_STYLE[category] || CATEGORY_STYLE.other
                return (
                  <div key={category} className="overflow-hidden rounded-2xl border border-neutral-bg bg-surface shadow-card">
                    <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: st.tint }}>
                      <Icon name={st.icon} size={18} color={st.iconColor} />
                      <span className="text-sm font-bold" style={{ color: st.text }}>
                        {t(`guest.register.category.${category}`)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-4 p-4">
                      {groupFields.map((f) => (
                        <DynamicField
                          key={f.id}
                          field={f}
                          value={previewValues[f.id]}
                          onChange={(v) => setPreviewValues((prev) => ({ ...prev, [f.id]: v }))}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* แผงตั้งค่าคำถาม (เพิ่ม/แก้) */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetMode === 'new' ? t('staff.formBuilder.addField') : t('staff.formBuilder.fieldSettings')}
      >
        <div className="flex flex-col gap-3">
          <TextField
            label={t('staff.formBuilder.fieldLabel')}
            required
            value={draft.label}
            onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
          />

          <SelectField
            label={t('staff.formBuilder.fieldType')}
            options={FIELD_TYPES}
            value={draft.field_type}
            onChange={(e) => setDraft((prev) => ({ ...prev, field_type: e.target.value }))}
          />

          {formType === 'registration' && (
            <SelectField
              label={t('staff.formBuilder.category')}
              options={CATEGORIES}
              value={draft.category}
              onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
            />
          )}

          {formType === 'registration' && (
            <SelectField
              label={t('staff.formBuilder.purpose')}
              options={FIELD_PURPOSES}
              value={draft.field_purpose}
              onChange={(e) => setDraft((prev) => ({ ...prev, field_purpose: e.target.value }))}
            />
          )}

          {NEEDS_OPTIONS.includes(draft.field_type) && (
            <TextAreaField
              label={t('staff.formBuilder.optionsHelp')}
              rows={4}
              value={draft.optionsText}
              onChange={(e) => setDraft((prev) => ({ ...prev, optionsText: e.target.value }))}
            />
          )}

          <label className="flex items-center gap-2.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={draft.is_required}
              onChange={(e) => setDraft((prev) => ({ ...prev, is_required: e.target.checked }))}
              className="h-5 w-5 rounded border-gray-300 text-sky-600"
            />
            {t('staff.formBuilder.required')}
          </label>

          <Button onClick={saveSheet} disabled={savingSheet || !draft.label.trim()}>
            {savingSheet ? t('common.loading') : t('common.save')}
          </Button>

          {sheetMode === 'edit' && (
            <button
              onClick={() => {
                deleteField({ id: draft.id, is_core: draft.is_core })
                setSheetOpen(false)
              }}
              className="text-sm font-medium text-red-500"
            >
              {draft.is_core ? t('staff.formBuilder.hide') : t('staff.formBuilder.delete')}
            </button>
          )}

          <Button variant="secondary" onClick={() => setSheetOpen(false)} disabled={savingSheet}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
