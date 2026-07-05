import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import SelectField from '../../components/common/SelectField'

const FIELD_TYPES = [
  { value: 'text', label: 'ข้อความสั้น' },
  { value: 'phone', label: 'เบอร์โทรศัพท์' },
  { value: 'textarea', label: 'ข้อความยาว' },
  { value: 'select', label: 'ตัวเลือกเดียว (dropdown)' },
  { value: 'radio', label: 'ตัวเลือกเดียว (ปุ่มกลม)' },
  { value: 'checkbox', label: 'เลือกได้หลายข้อ' },
  { value: 'date', label: 'วันที่ (wheel เลื่อน)' },
  { value: 'duration', label: 'ระยะเวลา (ชม./นาที)' },
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

const NEW_FIELD_TEMPLATE = {
  label: '',
  field_type: 'text',
  field_purpose: 'generic',
  category: 'other',
  is_required: false,
  optionsText: '', // one option per line, converted to jsonb on save — ต่อท้ายด้วย * เพื่อเปิดช่อง "โปรดระบุ" เพิ่ม
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

export default function FormBuilder() {
  const { t } = useTranslation()

  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)

  const [newField, setNewField] = useState(NEW_FIELD_TEMPLATE)
  const [creating, setCreating] = useState(false)

  async function loadFields() {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('form_fields')
      .select('*')
      .eq('tour_id', ACTIVE_TOUR_ID)
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
    loadFields()
  }, [])

  async function updateField(id, patch) {
    setSavingId(id)
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))

    const { error: updateError } = await supabase
      .from('form_fields')
      .update(patch)
      .eq('id', id)

    if (updateError) {
      console.error('[FormBuilder] update failed', updateError)
      loadFields() // revert to server state on failure
    }
    setSavingId(null)
  }

  async function moveField(index, direction) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= fields.length) return

    const a = fields[index]
    const b = fields[targetIndex]

    // Swap sort_order values
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
      loadFields()
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newField.label.trim()) return

    setCreating(true)
    const maxSort = fields.reduce((max, f) => Math.max(max, f.sort_order), 0)

    const needsOptions = ['select', 'checkbox', 'radio'].includes(newField.field_type)
    const options = needsOptions
      ? newField.optionsText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map(parseOptionLine)
      : null

    // field_key must be unique-ish and URL/DB-safe; slugify from label + timestamp for custom fields
    const fieldKey = `custom_${Date.now()}`

    const { error: insertError } = await supabase.from('form_fields').insert({
      tour_id: ACTIVE_TOUR_ID,
      field_key: fieldKey,
      label: newField.label.trim(),
      field_type: newField.field_type,
      field_purpose: newField.field_purpose,
      category: newField.category,
      options,
      is_required: newField.is_required,
      is_core: false,
      is_active: true,
      sort_order: maxSort + 1,
    })

    if (insertError) {
      console.error('[FormBuilder] create failed', insertError)
    } else {
      setNewField(NEW_FIELD_TEMPLATE)
      loadFields()
    }
    setCreating(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.formBuilder.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('staff.formBuilder.subtitle')}</p>

        {loading && <p className="mt-4 text-gray-500">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-red-500">{error}</p>}

        <div className="mt-4 flex flex-col gap-2">
          {fields.map((field, index) => (
            <Card key={field.id} className={field.is_active ? '' : 'opacity-50'}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => {
                      const label = e.target.value
                      setFields((prev) =>
                        prev.map((f) => (f.id === field.id ? { ...f, label } : f))
                      )
                    }}
                    onBlur={(e) => updateField(field.id, { label: e.target.value })}
                    className="w-full rounded-lg border border-transparent px-1 py-0.5 text-base font-medium text-gray-900 hover:border-gray-200 focus:border-sky-400 focus:outline-none"
                  />
                  <p className="mt-0.5 text-xs text-gray-400">
                    {FIELD_TYPES.find((ft) => ft.value === field.field_type)?.label ?? field.field_type}
                    {field.is_core && ` · ${t('staff.formBuilder.coreTag')}`}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex gap-1">
                    <button
                      onClick={() => moveField(index, -1)}
                      disabled={index === 0}
                      className="rounded-lg bg-gray-100 px-2 py-1 text-sm disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveField(index, 1)}
                      disabled={index === fields.length - 1}
                      className="rounded-lg bg-gray-100 px-2 py-1 text-sm disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </div>

              <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                <span className="shrink-0">{t('staff.formBuilder.category')}</span>
                <select
                  value={field.category ?? 'other'}
                  onChange={(e) => updateField(field.id, { category: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                <span className="shrink-0">{t('staff.formBuilder.purpose')}</span>
                <select
                  value={field.field_purpose ?? 'generic'}
                  onChange={(e) => updateField(field.id, { field_purpose: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                >
                  {FIELD_PURPOSES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={field.is_required}
                    onChange={(e) => updateField(field.id, { is_required: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-sky-600"
                  />
                  {t('staff.formBuilder.required')}
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={() => updateField(field.id, { is_active: !field.is_active })}
                    className="text-sm font-medium text-sky-600"
                  >
                    {field.is_active
                      ? t('staff.formBuilder.hide')
                      : t('staff.formBuilder.show')}
                  </button>
                  {!field.is_core && (
                    <button
                      onClick={() => deleteField(field)}
                      className="text-sm font-medium text-red-500"
                    >
                      {t('staff.formBuilder.delete')}
                    </button>
                  )}
                </div>
              </div>

              {savingId === field.id && (
                <p className="mt-1 text-xs text-gray-400">{t('common.loading')}</p>
              )}
            </Card>
          ))}
        </div>

        <Card className="mt-6">
          <h2 className="mb-3 font-semibold text-gray-900">
            {t('staff.formBuilder.addField')}
          </h2>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <TextField
              label={t('staff.formBuilder.fieldLabel')}
              required
              value={newField.label}
              onChange={(e) => setNewField((prev) => ({ ...prev, label: e.target.value }))}
            />

            <SelectField
              label={t('staff.formBuilder.fieldType')}
              options={FIELD_TYPES}
              value={newField.field_type}
              onChange={(e) =>
                setNewField((prev) => ({ ...prev, field_type: e.target.value }))
              }
            />

            <SelectField
              label={t('staff.formBuilder.category')}
              options={CATEGORIES}
              value={newField.category}
              onChange={(e) =>
                setNewField((prev) => ({ ...prev, category: e.target.value }))
              }
            />

            <SelectField
              label={t('staff.formBuilder.purpose')}
              options={FIELD_PURPOSES}
              value={newField.field_purpose}
              onChange={(e) =>
                setNewField((prev) => ({ ...prev, field_purpose: e.target.value }))
              }
            />

            {['select', 'checkbox', 'radio'].includes(newField.field_type) && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {t('staff.formBuilder.optionsHelp')}
                </span>
                <textarea
                  rows={3}
                  value={newField.optionsText}
                  onChange={(e) =>
                    setNewField((prev) => ({ ...prev, optionsText: e.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </label>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={newField.is_required}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, is_required: e.target.checked }))
                }
                className="h-4 w-4 rounded border-gray-300 text-sky-600"
              />
              {t('staff.formBuilder.required')}
            </label>

            <Button type="submit" disabled={creating || !newField.label.trim()}>
              {creating ? t('guest.register.submitting') : t('staff.formBuilder.addField')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
