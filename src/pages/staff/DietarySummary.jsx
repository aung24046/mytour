import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { genderTextClass } from '../../lib/genderColor'
import Icon from '../../components/common/Icon'

// จุดสีตามเพศ (พื้นทึบ) สำหรับชิปรายชื่อ
function genderDotClass(gender) {
  if (gender === 'ชาย') return 'bg-blue-500'
  if (gender === 'หญิง') return 'bg-pink-500'
  return 'bg-ink-faint'
}

// นับจำนวนคน (ไม่ซ้ำ) ที่มีข้อจำกัดในหมวดนั้น
function distinctPeopleCount(tally) {
  const set = new Set()
  for (const item of tally) for (const p of item.people) if (p?.id) set.add(p.id)
  return set.size
}

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
  const [expandedItems, setExpandedItems] = useState({})

  const toggleItem = (id) =>
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }))

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

  function renderSection(tally, keyPrefix, dotClass, pillClass) {
    if (tally.length === 0) {
      return (
        <div className="rounded-card border border-white/60 bg-surface p-4 text-sm text-ink-faint shadow-card ring-1 ring-black/[0.02]">
          {t('staff.dietarySummary.none')}
        </div>
      )
    }
    return (
      <div className="overflow-hidden rounded-card border border-white/60 bg-surface shadow-card ring-1 ring-black/[0.02]">
        {tally.map((item, idx) => {
          const id = `${keyPrefix}::${item.value}`
          const expanded = !!expandedItems[id]
          const preview = item.people.map((g) => g?.nickname || g?.name || '—').join(', ')
          return (
            <div key={id} className={idx > 0 ? 'border-t border-black/[0.05]' : ''}>
              <button
                type="button"
                onClick={() => toggleItem(id)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2.5 px-3 py-3 text-left"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {item.value}
                  {!expanded && preview && (
                    <span className="font-normal text-ink-faint"> · {preview}</span>
                  )}
                </span>
                <span className={`shrink-0 rounded-pill px-2.5 py-0.5 text-xs font-semibold ${pillClass}`}>
                  {item.count}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {expanded && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-3 pl-[30px]">
                  {item.people.map((g, i) => (
                    <span
                      key={`${g?.id ?? i}`}
                      className="inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-1 ring-1 ring-black/[0.04]"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${genderDotClass(g?.gender)}`} />
                      <span className={`text-xs font-medium ${genderTextClass(g?.gender) || 'text-ink'}`}>
                        {g?.nickname || g?.name || '—'}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const dietaryPeople = distinctPeopleCount(dietaryTally)
  const medicalPeople = distinctPeopleCount(medicalTally)

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink">
          <Icon name="bowl" size={24} color="#0e7490" />
          {t('staff.dietarySummary.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t('staff.dietarySummary.subtitle')}</p>

        {loading && <p className="mt-4 text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-danger">{error}</p>}

        {!loading && !error && (
          <>
            <p className="mb-2 mt-5 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning-text">
              <Icon name="bowl" size={14} />
              {t('staff.dietarySummary.dietary')}
              {dietaryPeople > 0 && (
                <span className="text-ink-faint"> · {t('staff.dietarySummary.peopleCount', { count: dietaryPeople })}</span>
              )}
            </p>
            {renderSection(dietaryTally, 'dietary', 'bg-warning', 'bg-warning-bg text-warning-text')}

            <p className="mb-2 mt-5 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-danger-text">
              <Icon name="heart" size={14} />
              {t('staff.dietarySummary.medical')}
              {medicalPeople > 0 && (
                <span className="text-ink-faint"> · {t('staff.dietarySummary.peopleCount', { count: medicalPeople })}</span>
              )}
            </p>
            {renderSection(medicalTally, 'medical', 'bg-danger', 'bg-danger-bg text-danger-text')}
          </>
        )}
      </div>
    </div>
  )
}
