import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextAreaField from '../../components/common/TextAreaField'

export default function Broadcast() {
  const { t } = useTranslation()

  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  async function loadHistory() {
    setLoadingHistory(true)
    const { data, error } = await supabase
      .from('announcements')
      .select('id, message, is_active, created_at')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[Broadcast] load history failed', error)
    } else {
      setHistory(data ?? [])
    }
    setLoadingHistory(false)
  }

  useEffect(() => {
    loadHistory()

    const channel = supabase
      .channel(`broadcast-staff-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'announcements',
          filter: `tour_id=eq.${ACTIVE_TOUR_ID}`,
        },
        (payload) => {
          setHistory((prev) => [payload.new, ...prev])
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function handleSend(e) {
    e.preventDefault()
    if (!message.trim()) return

    setSending(true)
    setSendError(null)

    const { error } = await supabase.from('announcements').insert({
      tour_id: ACTIVE_TOUR_ID,
      message: message.trim(),
      is_active: true,
    })

    if (error) {
      console.error('[Broadcast] send failed', error)
      setSendError(error.message ?? t('common.error'))
    } else {
      setMessage('')
    }
    setSending(false)
  }

  async function deactivate(id) {
    setHistory((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: false } : a)))
    const { error } = await supabase
      .from('announcements')
      .update({ is_active: false })
      .eq('id', id)
    if (error) {
      console.error('[Broadcast] deactivate failed', error)
      loadHistory()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 text-xl font-bold text-gray-900">
          {t('staff.broadcast.title')}
        </h1>

        <Card>
          <form onSubmit={handleSend} className="flex flex-col gap-3">
            <TextAreaField
              label={t('staff.broadcast.message')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {sendError && <p className="text-sm text-red-500">{sendError}</p>}
            <Button type="submit" disabled={sending || !message.trim()}>
              {sending ? t('guest.register.submitting') : t('staff.broadcast.send')}
            </Button>
          </form>
        </Card>

        <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
          {t('staff.broadcast.history')}
        </h2>

        {loadingHistory && <p className="text-gray-500">{t('common.loading')}</p>}

        <div className="flex flex-col gap-2">
          {history.map((a) => (
            <Card key={a.id} className={a.is_active ? '' : 'opacity-50'}>
              <p className="text-gray-900">{a.message}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {new Date(a.created_at).toLocaleString('th-TH')}
                </span>
                {a.is_active && (
                  <button
                    onClick={() => deactivate(a.id)}
                    className="text-sm font-medium text-red-500"
                  >
                    {t('staff.broadcast.deactivate')}
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
