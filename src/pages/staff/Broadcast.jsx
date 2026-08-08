import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId } from '../../lib/staffSession'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextAreaField from '../../components/common/TextAreaField'

export default function Broadcast() {
  const tourId = useActiveTourId()
  const { t } = useTranslation()

  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  // silent = รีเฟรชเบื้องหลัง ไม่ต้องโชว์ "กำลังโหลด" ให้จอกระพริบ
  async function loadHistory({ silent = false } = {}) {
    if (!silent) setLoadingHistory(true)
    const { data, error } = await supabase
      .from('announcements')
      .select('id, message, is_active, created_at')
      .eq('tour_id', tourId)
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

    // เหตุผลเดียวกับฝั่งลูกทัวร์: websocket หลุดตอนสลับแอป/เน็ตหาย แล้ว event ที่พลาดไม่ถูกส่งย้อนหลัง
    // ทีมงานมักเปิดหน้านี้ค้างไว้ทั้งวัน ถ้าไม่ดึงใหม่ประวัติจะไม่ตรงกับที่คนอื่นส่ง
    const channel = supabase
      .channel(`broadcast-staff-${tourId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements',
          filter: `tour_id=eq.${tourId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // กันซ้ำ เผื่อ refetch มาถึงก่อน event
            setHistory((prev) =>
              prev.some((a) => a.id === payload.new.id) ? prev : [payload.new, ...prev]
            )
          } else if (payload.eventType === 'UPDATE') {
            setHistory((prev) =>
              prev.map((a) => (a.id === payload.new.id ? { ...a, ...payload.new } : a))
            )
          } else {
            loadHistory({ silent: true })
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') loadHistory({ silent: true })
      })

    function handleVisibility() {
      if (document.visibilityState === 'visible') loadHistory({ silent: true })
    }
    function handleOnline() {
      loadHistory({ silent: true })
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSend(e) {
    e.preventDefault()
    if (!message.trim()) return

    setSending(true)
    setSendError(null)

    const { error } = await supabase.from('announcements').insert({
      tour_id: tourId,
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
    <div className="min-h-screen bg-surface-muted p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 text-xl font-bold text-ink">
          {t('staff.broadcast.title')}
        </h1>

        <Card>
          <form onSubmit={handleSend} className="flex flex-col gap-3">
            <TextAreaField
              label={t('staff.broadcast.message')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {sendError && <p className="text-sm text-danger">{sendError}</p>}
            <Button type="submit" disabled={sending || !message.trim()}>
              {sending ? t('guest.register.submitting') : t('staff.broadcast.send')}
            </Button>
          </form>
        </Card>

        <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('staff.broadcast.history')}
        </h2>

        {loadingHistory && <p className="text-ink-muted">{t('common.loading')}</p>}

        <div className="flex flex-col gap-2">
          {history.map((a) => (
            <Card key={a.id} className={a.is_active ? '' : 'opacity-50'}>
              <p className="text-ink">{a.message}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-ink-faint">
                  {new Date(a.created_at).toLocaleString('th-TH')}
                </span>
                {a.is_active && (
                  <button
                    onClick={() => deactivate(a.id)}
                    className="text-sm font-medium text-danger"
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
