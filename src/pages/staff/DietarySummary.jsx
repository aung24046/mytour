import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAll'
import { useActiveTourId } from '../../lib/staffSession'
import { genderTextClass } from '../../lib/genderColor'
import { buildSummary } from '../../lib/dietarySummary'
import Icon from '../../components/common/Icon'
import StaffHeader from '../../components/common/StaffHeader'

// จุดสีตามเพศ (พื้นทึบ) สำหรับชิปรายชื่อ
function genderDotClass(gender) {
  if (gender === 'ชาย') return 'bg-blue-600'
  if (gender === 'หญิง') return 'bg-pink-600'
  return 'bg-ink-faint'
}
function avatarClass(gender) {
  if (gender === 'ชาย') return 'bg-blue-600'
  if (gender === 'หญิง') return 'bg-pink-600'
  return 'bg-ink-faint'
}

// หน้าตาแต่ละกอง — เรียงตามความเร่งด่วน ไม่ใช่ตามจำนวนคน
// "แพ้กุ้ง 3 คน" ต้องมาก่อน "ไม่ทานเนื้อวัว 20 คน" เสมอ
const TIER_STYLE = {
  allergy: { icon: 'alert', head: 'bg-danger-bg/50', chip: 'bg-danger-bg text-danger-text', dot: 'bg-danger', badge: 'bg-danger' },
  condition: { icon: 'heart', head: 'bg-warning-bg/50', chip: 'bg-warning-bg text-warning-text', dot: 'bg-warning', badge: 'bg-warning' },
  preference: { icon: 'cutlery', head: 'bg-brand-lighter', chip: 'bg-brand-light text-brand-hover', dot: 'bg-brand', badge: 'bg-brand' },
  info: { icon: 'alertCircle', head: 'bg-surface-muted', chip: 'bg-surface-sunken text-ink-muted', dot: 'bg-ink-faint', badge: 'bg-ink-faint' },
}

function NameChip({ guest }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-1 ring-1 ring-line-subtle">
      <span className={`h-1.5 w-1.5 rounded-full ${genderDotClass(guest?.gender)}`} />
      <span className={`text-xs font-medium ${genderTextClass(guest?.gender) || 'text-ink'}`}>
        {guest?.nickname || guest?.name || '—'}
      </span>
    </span>
  )
}

export default function DietarySummary() {
  const tourId = useActiveTourId()
  const { t } = useTranslation()

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [view, setView] = useState('tier') // 'tier' = ตามข้อจำกัด | 'person' = รายคน
  const [expandedItems, setExpandedItems] = useState({})
  const [showConflicts, setShowConflicts] = useState(false)

  const toggleItem = (id) => setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }))

  useEffect(() => {
    let isMounted = true

    async function load() {
      setLoading(true)
      setError(null)

      const [guestsRes, fieldsRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, gender, phone, food_allergy, medical_condition')
          .eq('tour_id', tourId),
        supabase
          // ต้องดึง options มาด้วย — ใช้ตัดสตริงคำตอบตามตัวเลือกจริง (ดู dietarySummary.splitEntries)
          .from('v_tour_form_fields')
          .select('id, label, field_key, field_type, field_purpose, is_core, options')
          .eq('tour_id', tourId)
          .eq('form_type', 'registration')
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
        // แบ่งหน้าเสมอ — คำตอบของทริปใหญ่เกิน 1000 แถวได้ (ดู lib/fetchAll.js)
        const { data: responsesData, error: responsesError } = await fetchAllRows(
          () =>
            supabase
              .from('guest_form_responses')
              .select('field_id, value, guest_id')
              .in('field_id', customFieldIds),
          { orderBy: 'id' }
        )

        if (!responsesError && isMounted) setResponses(responsesData ?? [])
      }

      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
  }, [tourId, t])

  const summary = useMemo(
    () => buildSummary({ guests, fields, responses }),
    [guests, fields, responses]
  )

  const tierOf = (name) => summary.tiers.find((x) => x.tier === name)
  const visibleTiers = summary.tiers.filter((x) => x.items.length > 0)

  function renderTierBlock(group) {
    const style = TIER_STYLE[group.tier] ?? TIER_STYLE.info
    const isInfo = group.tier === 'info'

    return (
      <div key={group.tier} className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div className={`flex items-center gap-2 border-b border-line-subtle px-3 py-2.5 ${style.head}`}>
          <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-lg text-white ${style.badge}`}>
            <Icon name={style.icon} size={14} className="text-white" filled />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-extrabold leading-tight text-ink">
              {t(`staff.dietarySummary.tier.${group.tier}`)}
            </span>
            {group.fieldLabels.length > 0 && (
              <span className="block truncate text-[10.5px] text-ink-faint">
                {group.fieldLabels.join(' · ')}
              </span>
            )}
          </span>
          {!isInfo && (
            <span className={`ml-auto flex-none rounded-pill px-2.5 py-0.5 text-[11px] font-extrabold ${style.chip}`}>
              {group.peopleCount} / {summary.totals.guests}
            </span>
          )}
        </div>

        {group.items.map((item) => {
          const id = `${group.tier}::${item.key}`
          const expanded = !!expandedItems[id]
          const preview = item.people.map((g) => g?.nickname || g?.name || '—').join(' · ')

          return (
            <div key={id} className="border-b border-line-subtle last:border-b-0">
              <button
                type="button"
                onClick={() => toggleItem(id)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <span
                  className={`flex h-6 w-6 flex-none items-center justify-center rounded-pill text-[11px] font-extrabold ${style.chip}`}
                >
                  {item.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold leading-tight text-ink">
                    {item.label}
                    {item.isSelfWritten && (
                      <span className="ml-1.5 rounded-pill bg-surface-sunken px-1.5 py-0.5 align-middle text-[9px] font-extrabold text-ink-faint">
                        {t('staff.dietarySummary.selfWritten')}
                      </span>
                    )}
                    {item.variants.length > 1 && (
                      <span className="ml-1 rounded-pill bg-surface-sunken px-1.5 py-0.5 align-middle text-[9px] font-extrabold text-ink-faint">
                        {t('staff.dietarySummary.merged', { count: item.variants.length })}
                      </span>
                    )}
                  </span>
                  {!expanded && preview && (
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">{preview}</span>
                  )}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 flex-none text-ink-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
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
                <div className="px-3 pb-3 pl-[42px]">
                  <div className="flex flex-wrap gap-1.5">
                    {item.people.map((g, i) => (
                      <NameChip key={g?.id ?? i} guest={g} />
                    ))}
                  </div>
                  {item.variants.length > 1 && (
                    <p className="mt-2 text-[11px] text-ink-faint">
                      {t('staff.dietarySummary.mergedFrom')}: {item.variants.join(' · ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function renderPersonCard(person) {
    const g = person.guest
    const rows = [
      ['allergy', person.allergy],
      ['condition', person.condition],
      ['preference', person.preference],
      ['info', person.info],
    ].filter(([, list]) => list.length > 0)

    const sevTier = person.allergy.length ? 'allergy' : person.condition.length ? 'condition' : 'preference'
    const sevStyle = TIER_STYLE[sevTier]

    return (
      <div
        key={g.id}
        className={`overflow-hidden rounded-card border bg-surface shadow-card ${
          person.allergy.length ? 'border-danger/40' : 'border-line'
        }`}
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <span
            className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-extrabold text-white ${avatarClass(g.gender)}`}
          >
            {(g.nickname || g.name || '—').slice(0, 2)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold text-ink">
              {g.nickname ? `${g.nickname} (${g.name})` : g.name}
            </span>
            {g.phone && <span className="block truncate text-[11px] tabular-nums text-ink-muted">{g.phone}</span>}
          </span>
          <span className={`flex-none rounded-pill px-2 py-1 text-[9.5px] font-extrabold ${sevStyle.chip}`}>
            {t(`staff.dietarySummary.tier.${sevTier}`)}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 px-3 pb-3">
          {rows.map(([tier, list]) => {
            const style = TIER_STYLE[tier]
            return (
              <div key={tier} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-md text-white ${style.badge}`}
                >
                  <Icon name={style.icon} size={11} className="text-white" filled />
                </span>
                <span className="text-[12.5px] leading-snug text-ink">
                  <span className="font-bold">{t(`staff.dietarySummary.tier.${tier}`)}: </span>
                  {list.join(', ')}
                </span>
              </div>
            )
          })}
        </div>

        {g.phone && (
          <a
            href={`tel:${g.phone}`}
            className="flex items-center justify-center gap-1.5 border-t border-line-subtle bg-surface-muted py-2 text-xs font-bold text-brand"
          >
            <Icon name="phone" size={13} />
            {t('staff.sosMonitor.callGuest')}
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <StaffHeader
        icon="bowl"
        title={t('staff.dietarySummary.title')}
        subtitle={t('staff.dietarySummary.subtitle')}
      />
      <div className="mx-auto max-w-md p-4">
        {loading && <p className="mt-4 text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-danger">{error}</p>}

        {!loading && !error && (
          <>
            {/* สลับมุมมอง — ข้อมูลชุดเดียวกัน คนละมุม
                "ตามข้อจำกัด" ใช้ตอนวางแผน/สั่งอาหาร · "รายคน" ใช้ตอนหน้างาน */}
            <div className="mt-4 flex gap-1.5 rounded-control bg-surface-sunken p-1">
              {['tier', 'person'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  className={`flex-1 rounded-[10px] py-2 text-[12.5px] font-bold transition ${
                    view === mode ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'
                  }`}
                >
                  {t(`staff.dietarySummary.view.${mode}`)}
                  {mode === 'person' && summary.byPerson.length > 0 && ` (${summary.byPerson.length})`}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {['allergy', 'condition', 'preference'].map((tier) => {
                const style = TIER_STYLE[tier]
                return (
                  <div key={tier} className="rounded-control border border-line bg-surface px-2 py-2.5 text-center">
                    <p className={`text-xl font-extrabold tabular-nums ${
                      tier === 'allergy' ? 'text-danger-text' : tier === 'condition' ? 'text-warning-text' : 'text-brand'
                    }`}>
                      {tierOf(tier)?.peopleCount ?? 0}
                    </p>
                    <p className="mt-0.5 text-[10.5px] font-semibold leading-tight text-ink-muted">
                      {t(`staff.dietarySummary.tier.${tier}`)}
                    </p>
                    <span className={`sr-only ${style.dot}`} />
                  </div>
                )
              })}
            </div>

            {summary.conflicts.length > 0 && (
              <div className="mt-3 rounded-control border border-warning/40 bg-warning-bg px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setShowConflicts((v) => !v)}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <Icon name="alert" size={16} className="mt-0.5 text-warning-text" filled />
                  <span className="flex-1 text-[12px] leading-relaxed text-warning-ink">
                    <b className="font-extrabold">
                      {t('staff.dietarySummary.conflictTitle', { count: summary.conflicts.length })}
                    </b>{' '}
                    {t('staff.dietarySummary.conflictBody')}
                  </span>
                </button>
                {showConflicts && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                    {summary.conflicts.map((c) => (
                      <NameChip key={c.guest.id} guest={c.guest} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {view === 'tier' && (
              <div className="mt-3 flex flex-col gap-3">
                {visibleTiers.length === 0 && (
                  <div className="rounded-card border border-line bg-surface p-4 text-sm text-ink-faint shadow-card">
                    {t('staff.dietarySummary.none')}
                  </div>
                )}
                {visibleTiers.map(renderTierBlock)}
              </div>
            )}

            {view === 'person' && (
              <div className="mt-3 flex flex-col gap-2.5">
                {summary.byPerson.length === 0 && (
                  <div className="rounded-card border border-line bg-surface p-4 text-sm text-ink-faint shadow-card">
                    {t('staff.dietarySummary.none')}
                  </div>
                )}
                {summary.byPerson.map(renderPersonCard)}
              </div>
            )}

            {summary.totals.none > 0 && (
              <p className="mt-3 flex items-center gap-2 rounded-control bg-success-bg px-3 py-2.5 text-xs font-semibold text-success-text">
                <Icon name="check" size={15} filled />
                {t('staff.dietarySummary.noneCount', { count: summary.totals.none })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
