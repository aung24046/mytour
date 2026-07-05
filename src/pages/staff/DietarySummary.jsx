import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'

// รวมคำตอบ dietary/medical ทั้งจาก core field เดิม (guests.food_allergy, guests.medical_condition)
// และ custom field (checkbox/radio ใหม่) ที่ admin แท็ก field_purpose ไว้ แล้วนับจำนวนต่อค่า
// checkbox แบบเลือกได้หลายข้อ เก็บเป็น string เดียวคั่นด้วย ", " (เช่น "อาหารทะเล, ไข่")
// ต้องแยกก่อนนับ ไม่งั้นแต่ละคนจะกลายเป็นคนละ entry กันหมด นับจำนวนคนที่แพ้แต่ละอย่างไม่ได้จริง
function tallyByValue(entries) {
  const counts = new Map()
  for (const raw of entries) {
    if (!raw) continue
    const parts = raw
      .split(', ')
      .map((v) => v.trim())
      .filter(Boolean)
    for (const value of parts) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}

export default function DietarySummary() {
  const { t } = useTranslation()

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function load() {
      setLoading(true)
      setError(null)

      const [guestsRes, fieldsRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, food_allergy, medical_condition')
          .eq('tour_id', ACTIVE_TOUR_ID),
        supabase
          .from('form_fields')
          .select('id, field_purpose, is_core')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .in('field_purpose', ['dietary', 'medical']),
      ])

      if (!isMounted) return

      if (guestsRes.error || fieldsRes.error) {
        console.error('[DietarySummary] load failed', guestsRes.error, fieldsRes.error)
        setError(t('common.error'))
        setLoading(false)
        return
      }

      setGuests(guestsRes.data ?? [])
      setFields(fieldsRes.data ?? [])

      const customFieldIds = (fieldsRes.data ?? []).filter((f) => !f.is_core).map((f) => f.id)
      if (customFieldIds.length > 0) {
        const { data: responsesData, error: responsesError } = await supabase
          .from('guest_form_responses')
          .select('field_id, value')
          .in('field_id', customFieldIds)

        if (!responsesError && isMounted) setResponses(responsesData ?? [])
      }

      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
  }, [t])

  const dietaryTally = useMemo(() => {
    const coreValues = guests.map((g) => g.food_allergy)
    const customFieldIds = fields
      .filter((f) => f.field_purpose === 'dietary' && !f.is_core)
      .map((f) => f.id)
    const customValues = responses
      .filter((r) => customFieldIds.includes(r.field_id))
      .map((r) => r.value)
    return tallyByValue([...coreValues, ...customValues])
  }, [guests, fields, responses])

  const medicalTally = useMemo(() => {
    const coreValues = guests.map((g) => g.medical_condition)
    const customFieldIds = fields
      .filter((f) => f.field_purpose === 'medical' && !f.is_core)
      .map((f) => f.id)
    const customValues = responses
      .filter((r) => customFieldIds.includes(r.field_id))
      .map((r) => r.value)
    return tallyByValue([...coreValues, ...customValues])
  }, [guests, fields, responses])

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.dietarySummary.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('staff.dietarySummary.subtitle')}</p>

        {loading && <p className="mt-4 text-gray-500">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
              {t('staff.dietarySummary.dietary')}
            </h2>
            <Card>
              {dietaryTally.length === 0 ? (
                <p className="text-sm text-gray-400">{t('staff.dietarySummary.none')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {dietaryTally.map((item) => (
                    <div key={item.value} className="flex items-center justify-between">
                      <span className="text-gray-900">{item.value}</span>
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold text-amber-700">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
              {t('staff.dietarySummary.medical')}
            </h2>
            <Card>
              {medicalTally.length === 0 ? (
                <p className="text-sm text-gray-400">{t('staff.dietarySummary.none')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {medicalTally.map((item) => (
                    <div key={item.value} className="flex items-center justify-between">
                      <span className="text-gray-900">{item.value}</span>
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
