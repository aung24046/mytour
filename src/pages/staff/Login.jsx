import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { saveStaffSession } from '../../lib/staffSession'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import SelectField from '../../components/common/SelectField'
import TextField from '../../components/common/TextField'

function PinInput({ value, onChange, label }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
        {label}
        <span className="text-accent"> *</span>
      </span>
      <input
        type="password"
        inputMode="numeric"
        maxLength={6}
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        className="w-full rounded-control border border-transparent bg-surface-sunken px-3 py-3.5 text-center text-2xl tracking-[0.5em] shadow-inner transition focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70"
        placeholder="••••"
      />
    </label>
  )
}

export default function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [mode, setMode] = useState('staff') // 'staff' | 'admin'

  // ── โหมดทีมงาน ────────────────────────────────────────────────
  const [tours, setTours] = useState([])
  const [loadingTours, setLoadingTours] = useState(true)
  const [selectedTourId, setSelectedTourId] = useState('')

  const [staffList, setStaffList] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(false)
  const [selectedStaffId, setSelectedStaffId] = useState('')

  // ── โหมดแอดมิน ────────────────────────────────────────────────
  const [staffCode, setStaffCode] = useState('')

  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [loadError, setLoadError] = useState(null)

  // โหลดรายชื่อทริปที่เปิดอยู่
  useEffect(() => {
    let alive = true

    async function loadTours() {
      const { data, error } = await supabase.rpc('list_active_tours')
      if (!alive) return

      if (error) {
        console.error('[Login] โหลดรายชื่อทริปไม่สำเร็จ', error)
        setLoadError(t('common.error'))
        setLoadingTours(false)
        return
      }

      const list = data ?? []
      setTours(list)
      // มีทริปเดียว → เลือกให้เลย ผู้ใช้ไม่ต้องกดเพิ่ม (เหมือนก่อนมี multi-tour)
      if (list.length === 1) setSelectedTourId(list[0].id)
      setLoadingTours(false)
    }

    loadTours()
    return () => {
      alive = false
    }
  }, [t])

  // โหลดทีมงานของทริปที่เลือก
  useEffect(() => {
    if (!selectedTourId) {
      setStaffList([])
      return
    }
    let alive = true
    setLoadingStaff(true)
    setSelectedStaffId('')

    supabase.rpc('list_tour_staff', { p_tour_id: selectedTourId }).then(({ data, error }) => {
      if (!alive) return
      if (error) {
        console.error('[Login] โหลดรายชื่อทีมงานไม่สำเร็จ', error)
        setLoadError(t('common.error'))
      } else {
        setStaffList(data ?? [])
      }
      setLoadingStaff(false)
    })

    return () => {
      alive = false
    }
  }, [selectedTourId, t])

  async function buildAssignments(staffId) {
    const { data, error } = await supabase.rpc('get_staff_assignments', { p_staff_id: staffId })
    if (error) {
      console.error('[Login] โหลดทริปที่ถูกมอบหมายไม่สำเร็จ', error)
      return []
    }
    return (data ?? []).map((a) => ({ tourId: a.tour_id, role: a.role, tourName: a.tour_name }))
  }

  async function handleStaffLogin(e) {
    e.preventDefault()
    setAuthError(null)
    if (!selectedTourId || !selectedStaffId || !pin.trim()) return

    setSubmitting(true)
    const { data, error } = await supabase.rpc('verify_tour_staff_pin', {
      p_tour_id: selectedTourId,
      p_staff_id: selectedStaffId,
      p_pin: pin.trim(),
    })

    if (error) {
      console.error('[Login] verify_tour_staff_pin failed', error)
      setAuthError(t('common.error'))
      setSubmitting(false)
      return
    }

    const match = data?.[0]
    if (!match) {
      setAuthError(t('staff.login.wrongPin'))
      setSubmitting(false)
      return
    }

    const assignments = await buildAssignments(match.staff_id)

    saveStaffSession({
      staff: {
        id: match.staff_id,
        name: match.name,
        phone: match.phone,
        org_id: match.org_id,
      },
      orgRole: match.org_role ?? null,
      activeTourId: match.tour_id,
      tourRole: match.role,
      assignments: assignments.length
        ? assignments
        : [{ tourId: match.tour_id, role: match.role }],
    })

    setSubmitting(false)
    navigate('/staff')
  }

  async function handleAdminLogin(e) {
    e.preventDefault()
    setAuthError(null)
    if (!staffCode.trim() || !pin.trim()) return

    setSubmitting(true)
    const { data, error } = await supabase.rpc('verify_admin_pin', {
      p_staff_code: staffCode.trim(),
      p_pin: pin.trim(),
    })

    if (error) {
      console.error('[Login] verify_admin_pin failed', error)
      setAuthError(t('common.error'))
      setSubmitting(false)
      return
    }

    const match = data?.[0]
    if (!match) {
      setAuthError(t('staff.login.wrongPin'))
      setSubmitting(false)
      return
    }

    const assignments = await buildAssignments(match.staff_id)
    // แอดมินเข้าได้ทุกทริป — ตั้งทริปแรกที่ active เป็นค่าเริ่มต้น
    const defaultTourId = assignments[0]?.tourId ?? tours[0]?.id ?? null

    saveStaffSession({
      staff: {
        id: match.staff_id,
        name: match.name,
        phone: match.phone,
        org_id: match.org_id,
      },
      orgRole: match.org_role,
      activeTourId: defaultTourId,
      tourRole: assignments.find((a) => a.tourId === defaultTourId)?.role ?? null,
      assignments,
    })

    setSubmitting(false)
    navigate('/staff')
  }

  const tourOptions = tours.map((t2) => ({
    value: t2.id,
    label: t2.join_code ? `${t2.name} (${t2.join_code})` : t2.name,
  }))
  const staffOptions = staffList.map((s) => ({ value: s.staff_id, label: s.name }))

  function switchMode(next) {
    setMode(next)
    setPin('')
    setAuthError(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-3xl shadow-brand">
            🧭
          </div>
          <h1 className="text-2xl font-extrabold text-ink">{t('staff.login.title')}</h1>
        </div>

        {/* สลับโหมด */}
        <div className="mb-4 flex rounded-control bg-surface-sunken p-1">
          {[
            { key: 'staff', label: 'ทีมงาน' },
            { key: 'admin', label: 'แอดมิน' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchMode(tab.key)}
              className={`flex-1 rounded-[10px] py-2 text-sm font-semibold transition ${
                mode === tab.key ? 'bg-white text-brand shadow-card' : 'text-ink-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Card className="shadow-card-hover">
          {loadError && <p className="mb-3 text-sm text-red-500">{loadError}</p>}

          {mode === 'staff' ? (
            <form onSubmit={handleStaffLogin} className="flex flex-col gap-4">
              {loadingTours ? (
                <p className="text-gray-500">{t('common.loading')}</p>
              ) : (
                <>
                  {/* มีทริปเดียวก็ไม่ต้องโชว์ช่องเลือก — ลดขั้นตอนหน้างาน */}
                  {tours.length > 1 && (
                    <SelectField
                      label="ทริป"
                      required
                      options={tourOptions}
                      value={selectedTourId}
                      onChange={(e) => {
                        setSelectedTourId(e.target.value)
                        setAuthError(null)
                      }}
                    />
                  )}

                  {tours.length === 0 && (
                    <p className="text-sm text-ink-muted">
                      ยังไม่มีทริปที่เปิดใช้งาน — ให้แอดมินสร้างทริปก่อน
                    </p>
                  )}

                  {selectedTourId &&
                    (loadingStaff ? (
                      <p className="text-gray-500">{t('common.loading')}</p>
                    ) : (
                      <SelectField
                        label={t('staff.login.selectName')}
                        required
                        options={staffOptions}
                        value={selectedStaffId}
                        onChange={(e) => {
                          setSelectedStaffId(e.target.value)
                          setAuthError(null)
                        }}
                      />
                    ))}

                  {selectedStaffId && (
                    <PinInput value={pin} onChange={setPin} label={t('staff.login.pin')} />
                  )}

                  {authError && <p className="text-sm text-red-500">{authError}</p>}

                  <Button
                    type="submit"
                    disabled={submitting || !selectedTourId || !selectedStaffId || !pin}
                  >
                    {submitting ? t('guest.register.submitting') : t('staff.login.submit')}
                  </Button>
                </>
              )}
            </form>
          ) : (
            <form onSubmit={handleAdminLogin} className="flex flex-col gap-4">
              <TextField
                label="รหัสแอดมิน"
                required
                value={staffCode}
                onChange={(e) => {
                  setStaffCode(e.target.value)
                  setAuthError(null)
                }}
                autoCapitalize="characters"
                placeholder="เช่น ADM1"
              />

              <PinInput value={pin} onChange={setPin} label={t('staff.login.pin')} />

              {authError && <p className="text-sm text-red-500">{authError}</p>}

              <Button type="submit" disabled={submitting || !staffCode.trim() || !pin}>
                {submitting ? t('guest.register.submitting') : t('staff.login.submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
