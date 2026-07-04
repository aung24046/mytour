import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID, ACTIVE_ORG_ID } from '../../lib/constants'
import { getStaffSession } from '../../lib/staffSession'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import SelectField from '../../components/common/SelectField'

const ROLES = [
  { value: 'lead_guide', label: 'Lead guide' },
  { value: 'staff', label: 'Staff' },
  { value: 'driver', label: 'Driver' },
]

const NEW_STAFF_TEMPLATE = { name: '', role: 'staff', pin: '' }

export default function StaffManager() {
  const { t } = useTranslation()
  const mySession = getStaffSession()

  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showNewForm, setShowNewForm] = useState(false)
  const [newStaff, setNewStaff] = useState(NEW_STAFF_TEMPLATE)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  async function loadStaff() {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('staff')
      .select('id, name, role, phone')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('name')

    if (fetchError) {
      console.error('[StaffManager] load failed', fetchError)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setStaffList(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadStaff()

    const channel = supabase
      .channel(`staff-manager-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadStaff()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreateStaff(e) {
    e.preventDefault()
    if (!newStaff.name.trim()) return

    if (!/^\d{4}$/.test(newStaff.pin)) {
      setCreateError(t('staff.staffManager.pinFormatError'))
      return
    }

    setCreating(true)
    setCreateError(null)

    const { error: insertError } = await supabase.from('staff').insert({
      org_id: ACTIVE_ORG_ID,
      tour_id: ACTIVE_TOUR_ID,
      name: newStaff.name.trim(),
      role: newStaff.role,
      auth_pin: newStaff.pin,
    })

    if (insertError) {
      console.error('[StaffManager] create staff failed', insertError)
      setCreateError(insertError.message ?? t('common.error'))
      setCreating(false)
      return
    }

    setNewStaff(NEW_STAFF_TEMPLATE)
    setShowNewForm(false)
    setCreating(false)
    loadStaff()
  }

  async function deleteStaff(member) {
    if (member.id === mySession?.id) {
      window.alert(t('staff.staffManager.cannotDeleteSelf'))
      return
    }

    const confirmed = window.confirm(
      t('staff.staffManager.confirmDelete', { name: member.name })
    )
    if (!confirmed) return

    const { error: deleteError } = await supabase.from('staff').delete().eq('id', member.id)
    if (deleteError) {
      console.error('[StaffManager] delete staff failed', deleteError)
      return
    }
    setStaffList((prev) => prev.filter((s) => s.id !== member.id))
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.staffManager.title')}</h1>
        <p className="mb-3 text-sm text-gray-500">{t('staff.staffManager.subtitle')}</p>

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="mb-3 w-full rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
            >
              + {t('staff.staffManager.addStaff')}
            </button>

            {showNewForm && (
              <Card className="mb-3">
                <form onSubmit={handleCreateStaff} className="flex flex-col gap-3">
                  <TextField
                    label={t('staff.staffManager.staffName')}
                    required
                    value={newStaff.name}
                    onChange={(e) => setNewStaff((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <SelectField
                    label={t('staff.staffManager.role')}
                    options={ROLES}
                    value={newStaff.role}
                    onChange={(e) => setNewStaff((prev) => ({ ...prev, role: e.target.value }))}
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
                      value={newStaff.pin}
                      onChange={(e) =>
                        setNewStaff((prev) => ({
                          ...prev,
                          pin: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-center text-2xl tracking-[0.5em] focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                      placeholder="••••"
                    />
                  </label>

                  {createError && <p className="text-sm text-red-500">{createError}</p>}

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={creating || !newStaff.name.trim() || newStaff.pin.length !== 4}
                    >
                      {creating ? t('guest.register.submitting') : t('common.save')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setShowNewForm(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            <div className="flex flex-col gap-2">
              {staffList.map((member) => (
                <Card key={member.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      {member.name}
                      {member.id === mySession?.id && (
                        <span className="ml-1.5 text-xs font-normal text-sky-600">
                          {t('staff.staffManager.you')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {ROLES.find((r) => r.value === member.role)?.label ?? member.role}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteStaff(member)}
                    className="shrink-0 text-sm font-medium text-red-500"
                  >
                    {t('staff.formBuilder.delete')}
                  </button>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
