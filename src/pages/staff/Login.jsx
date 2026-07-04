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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="mx-auto w-full max-w-md">
        <h1 className="mb-4 text-center text-xl font-bold text-gray-900">
          {t('staff.login.title')}
        </h1>

        <Card>
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
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {t('staff.login.pin')}
                  <span className="text-red-500"> *</span>
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
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-center text-2xl tracking-[0.5em] focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
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
