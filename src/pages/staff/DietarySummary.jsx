import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { genderTextClass } from '../../lib/genderColor'
import Card from '../../components/common/Card'

// ค่าที่แปลว่า "ไม่มีข้อจำกัด/ไม่มีโรค" — ต้องตัดออกจากสรุป เพราะไม่ใช่ข้อจำกัดจริง
// ครอบคลุมทั้งไทยและอังกฤษ เช่น "ไม่มีอาการแพ้อาหาร (No food allergies)", "ไม่มี (None)"
function isNoneValue(raw) {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return true
  if (s.startsWith('ไม่มี')) return true // ครอบ "ไม่มี", "ไม่มี (No)", "ไม่มีอาการแพ้อาหาร...", "ไม่มีข้อจำกัด..."
  if (['no', 'none', 'n/a', '-', 'ไม่แพ้', 'ไม่แพ้อาหาร'].includes(s)) return true
  if (s.includes('no food allerg') || s.includes('no restriction')) return true
  return false
}

// รวมคำตอบ dietary/medical แล้วจัดกลุ่มตามค่า พร้อมเก็บรายชื่อคนที่มีข้อจำกัดนั้นๆ
// checkbox แบบเลือกได้หลายข้อ เก็บเป็น string เดียวคั่นด้วย ", " ต้องแยกก่อนนับ
function tallyWithNames(pairs) {
  const map = new Map() // value -> [{ name, gender }]
  for (const { raw, guest } of pairs) {
    if (!raw) continue
    for (const value of raw.split(', ').map((v) => v.trim()).filter(Boolean)) {
      if (isNoneValue(value)) continue
      if (!map.has(value)) map.set(value, [])
      map.get(value).push(guest)
    }
  }
  return Array.from(map.entries())
    .map(([value, people]) => ({ value, count: people.length, people }))
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
          .select('id, name, nickname, gender, food_allergy, medical_condition')
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
          .select('field_id, value, guest_id')
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

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  function buildPairs(purpose, coreKey) {
    const corePairs = guests.map((g) => ({ raw: g[coreKey], guest: g }))
    const customFieldIds = fields
      .filter((f) => f.field_purpose === purpose && !f.is_core)
      .map((f) => f.id)
    const customPairs = responses
      .filter((r) => customFieldIds.includes(r.field_id))
      .map((r) => ({ raw: r.value, guest: guestById[r.guest_id] }))
      .filter((p) => p.guest)
    return [...corePairs, ...customPairs]
  }

  const dietaryTally = useMemo(
    () => tallyWithNames(buildPairs('dietary', 'food_allergy')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guests, fields, responses, guestById]
  )

  const medicalTally = useMemo(
    () => tallyWithNames(buildPairs('medical', 'medical_condition')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guests, fields, responses, guestById]
  )

  function renderTally(tally, badgeClass) {
    if (tally.length === 0) {
      return <p className="text-sm text-gray-400">{t('staff.dietarySummary.none')}</p>
    }
    return (
      <div className="flex flex-col divide-y divide-gray-100">
        {tally.map((item) => (
          <div key={item.value} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-900">{item.value}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold ${badgeClass}`}>
                {item.count}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
              {item.people.map((g, i) => (
                <span
                  key={`${g?.id ?? i}`}
                  className={`text-sm ${genderTextClass(g?.gender) || 'text-gray-600'}`}
                >
                  {g?.nickname || g?.name || '—'}
                  {i < item.people.length - 1 && <span className="text-gray-300">,</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

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
            <Card>{renderTally(dietaryTally, 'bg-amber-100 text-amber-700')}</Card>

            <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
              {t('staff.dietarySummary.medical')}
            </h2>
            <Card>{renderTally(medicalTally, 'bg-red-100 text-red-700')}</Card>
          </>
        )}
      </div>
    </div>
  )
}
