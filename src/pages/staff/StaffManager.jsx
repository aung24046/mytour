import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID, ACTIVE_ORG_ID } from '../../lib/constants'
import { getStaffSession } from '../../lib/staffSession'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'

// role เดิมเคยเป็น enum ปิดตาย (lead_guide/staff/driver) — ตอนนี้เป็นข้อความอิสระแล้ว
// เก็บ key เดิมไว้แค่สำหรับแปลป้ายชื่อของ role ที่มีอยู่ก่อนแล้วเท่านั้น
const LEGACY_ROLE_KEYS = ['lead_guide', 'staff', 'driver', 'admin']

const NEW_STAFF_TEMPLATE = { role: 'staff', pin: '' }

export default function StaffManager() {
  const { t } = useTranslation()
  const mySession = getStaffSession()

  const [staffList, setStaffList] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showNewForm, setShowNewForm] = useState(false)
  const [guestQuery, setGuestQuery] = useState('')
  const [selectedGuest, setSelectedGuest] = useState(null) // { id, name, nickname, phone }
  const [newStaff, setNewStaff] = useState(NEW_STAFF_TEMPLATE)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editRoleValue, setEditRoleValue] = useState('')
  const [savingRole, setSavingRole] = useState(false)

  const [nameFilter, setNameFilter] = useState('')

  function roleLabel(role) {
    return LEGACY_ROLE_KEYS.includes(role)
      ? t(`staff.staffManager.roleLabel.${role}`, { defaultValue: role })
      : role
  }

  function guestDisplayName(g) {
    return g.nickname ? `${g.name} (${g.nickname})` : g.name
  }

  async function loadStaff() {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('staff')
      .select('id, name, role, phone, guest_id, show_to_guest, is_default')
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

  async function loadGuests() {
    const { data, error: fetchError } = await supabase
      .from('guests')
      .select('id, name, nickname, phone')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('name')

    if (fetchError) {
      console.error('[StaffManager] load guests failed', fetchError)
      return
    }
    setGuests(data ?? [])
  }

  useEffect(() => {
    loadStaff()
    loadGuests()

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

  // ลูกทัวร์ที่ถูกเพิ่มเป็นทีมงานไปแล้ว ไม่ควรให้เลือกซ้ำ
  const staffGuestIds = useMemo(
    () => new Set(staffList.filter((s) => s.guest_id).map((s) => s.guest_id)),
    [staffList]
  )

  const guestSuggestions = useMemo(() => {
    const q = guestQuery.trim().toLowerCase()
    if (!q) return []
    return guests
      .filter((g) => !staffGuestIds.has(g.id))
      .filter(
        (g) =>
          g.name?.toLowerCase().includes(q) ||
          g.nickname?.toLowerCase().includes(q) ||
          g.phone?.includes(q)
      )
      .slice(0, 8)
  }, [guests, guestQuery, staffGuestIds])

  const roleOptions = useMemo(
    () => [...new Set(staffList.map((s) => s.role).filter(Boolean))],
    [staffList]
  )

  // กรองตามชื่อ แล้วจัดกลุ่มตามตำแหน่ง (เรียงกลุ่มตามชื่อป้ายตำแหน่ง)
  const groupedStaff = useMemo(() => {
    const q = nameFilter.trim().toLowerCase()
    const filtered = q
      ? staffList.filter((s) => s.name?.toLowerCase().includes(q))
      : staffList

    const groups = {}
    for (const s of filtered) {
      const key = s.role || ''
      if (!groups[key]) groups[key] = []
      groups[key].push(s)
    }

    return Object.entries(groups)
      .map(([role, members]) => ({ role, members }))
      .sort((a, b) => roleLabel(a.role).localeCompare(roleLabel(b.role), 'th'))
  }, [staffList, nameFilter])

  function resetNewForm() {
    setSelectedGuest(null)
    setGuestQuery('')
    setNewStaff(NEW_STAFF_TEMPLATE)
    setCreateError(null)
  }

  async function handleCreateStaff(e) {
    e.preventDefault()
    if (!selectedGuest) return

    if (!/^\d{4}$/.test(newStaff.pin)) {
      setCreateError(t('staff.staffManager.pinFormatError'))
      return
    }

    setCreating(true)
    setCreateError(null)

    const { error: insertError } = await supabase.from('staff').insert({
      org_id: ACTIVE_ORG_ID,
      tour_id: ACTIVE_TOUR_ID,
      guest_id: selectedGuest.id,
      name: guestDisplayName(selectedGuest),
      phone: selectedGuest.phone,
      role: newStaff.role.trim() || 'staff',
      auth_pin: newStaff.pin,
    })

    if (insertError) {
      console.error('[StaffManager] create staff failed', insertError)
      setCreateError(insertError.message ?? t('common.error'))
      setCreating(false)
      return
    }

    resetNewForm()
    setShowNewForm(false)
    setCreating(false)
    loadStaff()
  }

  async function toggleShowToGuest(member) {
    const next = !member.show_to_guest
    setStaffList((prev) =>
      prev.map((s) => (s.id === member.id ? { ...s, show_to_guest: next } : s))
    )

    const { error } = await supabase
      .from('staff')
      .update({ show_to_guest: next })
      .eq('id', member.id)

    if (error) {
      console.error('[StaffManager] toggle show_to_guest failed', error)
      setStaffList((prev) =>
        prev.map((s) => (s.id === member.id ? { ...s, show_to_guest: !next } : s))
      )
    }
  }

  async function changePin(member) {
    const next = window.prompt(t('staff.staffManager.newPinPrompt'), '')
    if (next === null) return

    if (!/^\d{4}$/.test(next)) {
      window.alert(t('staff.staffManager.pinFormatError'))
      return
    }

    const { error } = await supabase.from('staff').update({ auth_pin: next }).eq('id', member.id)
    if (error) {
      console.error('[StaffManager] change pin failed', error)
      window.alert(t('common.error'))
      return
    }
    window.alert(t('staff.staffManager.pinChanged'))
  }

  function startEditRole(member) {
    setEditingRoleId(member.id)
    setEditRoleValue(member.role ?? '')
  }

  function cancelEditRole() {
    setEditingRoleId(null)
    setEditRoleValue('')
  }

  async function saveRole(member) {
    const next = editRoleValue.trim()
    if (!next) return

    setSavingRole(true)
    const { error } = await supabase.from('staff').update({ role: next }).eq('id', member.id)
    setSavingRole(false)

    if (error) {
      console.error('[StaffManager] update role failed', error)
      window.alert(error.message ?? t('common.error'))
      return
    }

    setStaffList((prev) => prev.map((s) => (s.id === member.id ? { ...s, role: next } : s)))
    setEditingRoleId(null)
    setEditRoleValue('')
  }

  async function deleteStaff(member) {
    if (member.is_default) {
      window.alert(t('staff.staffManager.cannotDeleteDefault'))
      return
    }

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
      window.alert(deleteError.message ?? t('common.error'))
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
              onClick={() => {
                setShowNewForm((v) => !v)
                if (showNewForm) resetNewForm()
              }}
              className="mb-3 w-full rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
            >
              + {t('staff.staffManager.addStaff')}
            </button>

            {showNewForm && (
              <Card className="mb-3">
                <form onSubmit={handleCreateStaff} className="flex flex-col gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
                      {t('staff.staffManager.staffName')}
                      <span className="text-accent"> *</span>
                    </span>

                    {selectedGuest ? (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">
                            {guestDisplayName(selectedGuest)}
                          </p>
                          {selectedGuest.phone && (
                            <p className="text-xs text-gray-500">{selectedGuest.phone}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedGuest(null)}
                          className="shrink-0 text-sm font-medium text-sky-600"
                        >
                          {t('staff.staffManager.changeGuest')}
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          value={guestQuery}
                          onChange={(e) => setGuestQuery(e.target.value)}
                          placeholder={t('staff.staffManager.searchGuestPlaceholder')}
                          className="w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-3 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
                        />
                        {guestQuery.trim() && (
                          <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-md">
                            {guestSuggestions.length === 0 && (
                              <p className="px-3.5 py-2.5 text-sm text-gray-400">
                                {t('staff.staffManager.noGuestMatch')}
                              </p>
                            )}
                            {guestSuggestions.map((g) => (
                              <button
                                key={g.id}
                                type="button"
                                onClick={() => {
                                  setSelectedGuest(g)
                                  setGuestQuery('')
                                }}
                                className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-sky-50"
                              >
                                <span className="truncate font-medium text-gray-900">
                                  {guestDisplayName(g)}
                                </span>
                                {g.phone && <span className="shrink-0 text-xs text-gray-400">{g.phone}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
                      {t('staff.staffManager.role')}
                      <span className="text-accent"> *</span>
                    </span>
                    <input
                      list="staff-role-options"
                      value={newStaff.role}
                      onChange={(e) => setNewStaff((prev) => ({ ...prev, role: e.target.value }))}
                      placeholder={t('staff.staffManager.rolePlaceholder')}
                      className="w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-3 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
                    />
                  </label>

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
                      disabled={creating || !selectedGuest || newStaff.pin.length !== 4}
                    >
                      {creating ? t('guest.register.submitting') : t('common.save')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setShowNewForm(false)
                        resetNewForm()
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            <datalist id="staff-role-options">
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </datalist>

            <p className="mb-2 text-xs text-gray-400">{t('staff.staffManager.showToGuestHint')}</p>

            <input
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder={t('staff.staffManager.filterByNamePlaceholder')}
              className="mb-3 w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-2.5 text-sm text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
            />

            {groupedStaff.length === 0 && (
              <p className="text-sm text-gray-400">{t('staff.staffManager.noStaffMatch')}</p>
            )}

            <div className="flex flex-col gap-4">
              {groupedStaff.map(({ role, members }) => (
                <div key={role || 'unassigned'}>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {roleLabel(role) || t('staff.staffManager.noRole')}
                    <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-gray-500">
                      {members.length}
                    </span>
                  </p>
                  <div className="flex flex-col gap-2">
                    {members.map((member) => (
                      <Card key={member.id} className="flex items-center justify-between p-3 gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">
                            {member.name}
                            {member.id === mySession?.id && (
                              <span className="ml-1.5 text-xs font-normal text-sky-600">
                                {t('staff.staffManager.you')}
                              </span>
                            )}
                            {member.is_default && (
                              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                                {t('staff.staffManager.defaultBadge')}
                              </span>
                            )}
                          </p>
                          {editingRoleId === member.id ? (
                            <div className="mt-1 flex items-center gap-1.5">
                              <input
                                autoFocus
                                list="staff-role-options"
                                value={editRoleValue}
                                onChange={(e) => setEditRoleValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveRole(member)
                                  if (e.key === 'Escape') cancelEditRole()
                                }}
                                className="w-32 rounded-lg border border-sky-300 px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-sky-200"
                              />
                              <button
                                onClick={() => saveRole(member)}
                                disabled={savingRole || !editRoleValue.trim()}
                                className="text-xs font-semibold text-sky-600 disabled:opacity-50"
                              >
                                {t('common.save')}
                              </button>
                              <button onClick={cancelEditRole} className="text-xs font-medium text-gray-400">
                                {t('common.cancel')}
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400">
                              {roleLabel(member.role)}{' '}
                              <button
                                onClick={() => startEditRole(member)}
                                className="font-medium text-sky-600"
                              >
                                {t('staff.staffManager.editRole')}
                              </button>
                            </p>
                          )}
                          {member.phone && <p className="text-xs text-gray-400">{member.phone}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => toggleShowToGuest(member)}
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                member.show_to_guest
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {member.show_to_guest
                                ? t('staff.staffManager.shownToGuest')
                                : t('staff.staffManager.notShownToGuest')}
                            </button>
                            {!member.is_default && (
                              <button
                                onClick={() => deleteStaff(member)}
                                className="text-sm font-medium text-red-500"
                              >
                                {t('staff.formBuilder.delete')}
                              </button>
                            )}
                          </div>
                          <button
                            onClick={() => changePin(member)}
                            className="text-xs font-medium text-sky-600"
                          >
                            {t('staff.staffManager.changePin')}
                          </button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
