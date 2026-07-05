import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { saveStaffSession } from '../../lib/staffSession'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import SelectField from '../../components/common/SelectField'

export default function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [staffList, setStaffList] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function loadStaff() {
      setLoadingStaff(true)
      const { data, error } = await supabase
        .from('staff')
        .select('id, name, role')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('name')

      if (!isMounted) return

      if (error) {
        console.error('[Login] load staff failed', error)
        setLoadError(t('common.error'))
      } else {
        setStaffList(data ?? [])
      }
      setLoadingStaff(false)
    }

    loadStaff()
    return () => {
      isMounted = false
    }
  }, [t])

  async function handleSubmit(e) {
    e.preventDefault()
    setAuthError(null)

    if (!selectedStaffId || pin.trim().length === 0) return

    setSubmitting(true)
    const { data, error } = await supabase.rpc('verify_staff_pin', {
      p_staff_id: selectedStaffId,
      p_pin: pin.trim(),
    })

    if (error) {
      console.error('[Login] verify_staff_pin failed', error)
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

    saveStaffSession(match)
    setSubmitting(false)
    navigate('/staff')
  }

  const staffOptions = staffList.map((s) => ({ value: s.id, label: s.name }))

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-3xl shadow-brand">
            🧭
          </div>
          <h1 className="text-2xl font-extrabold text-ink">
            {t('staff.login.title')}
          </h1>
        </div>

        <Card className="shadow-card-hover">
          {loadingStaff && <p className="text-gray-500">{t('common.loading')}</p>}
          {loadError && <p className="text-red-500">{loadError}</p>}

          {!loadingStaff && !loadError && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
                  {t('staff.login.pin')}
                  <span className="text-accent"> *</span>
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]*"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ''))
                    setAuthError(null)
                  }}
                  className="w-full rounded-control border border-transparent bg-surface-sunken px-3 py-3.5 text-center text-2xl tracking-[0.5em] shadow-inner focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
                  placeholder="••••"
                />
              </label>

              {authError && <p className="text-sm text-red-500">{authError}</p>}

              <Button
                type="submit"
                disabled={submitting || !selectedStaffId || pin.length === 0}
              >
                {submitting ? t('guest.register.submitting') : t('staff.login.submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
