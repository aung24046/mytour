import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useActiveOrgId } from '../../lib/staffSession'
import Icon from '../../components/common/Icon'
import StaffHeader from '../../components/common/StaffHeader'

// ตั้งค่าข้อความลัดของประกาศด่วน — ข้อความล้วน ไม่มีตัวแปรอะไรให้จำ
//
// เก็บที่ระดับบริษัท (org) ไม่ใช่รายทริป เพราะประโยคพวกนี้เป็นสำนวนของทีม
// ใช้ซ้ำทุกทริป — ถ้าผูกกับทริป ทุกทริปใหม่จะต้องมานั่งพิมพ์ใหม่ทั้งชุด
//
// บันทึกทีเดียวตอนกดปุ่ม ไม่ใช่ทุกตัวอักษร — หน้านี้แก้กันทีละหลายบรรทัด
// การยิง update รายคีย์สโตรกทำให้ลำดับที่เขียนกลับสลับกันเองเมื่อเน็ตช้า
export default function BroadcastShortcuts() {
  const orgId = useActiveOrgId()
  const { t } = useTranslation()

  const [items, setItems] = useState([]) // { id?, text, _localKey }
  const [removedIds, setRemovedIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const dragIndex = useRef(null)

  useEffect(() => {
    async function load() {
      const { data, error: loadError } = await supabase
        .from('announcement_templates')
        .select('id, text, sort_order')
        .eq('org_id', orgId)
        .order('sort_order')

      if (loadError) {
        console.error('[BroadcastShortcuts] load failed', loadError)
        setError(t('common.error'))
      } else {
        setItems((data ?? []).map((r) => ({ ...r, _localKey: r.id })))
      }
      setLoading(false)
    }
    load()
  }, [orgId, t])

  function updateText(localKey, text) {
    setSaved(false)
    setItems((prev) => prev.map((it) => (it._localKey === localKey ? { ...it, text } : it)))
  }

  function addItem() {
    setSaved(false)
    setItems((prev) => [...prev, { text: '', _localKey: `new-${Date.now()}${prev.length}` }])
  }

  function removeItem(localKey) {
    setSaved(false)
    setItems((prev) => {
      const target = prev.find((it) => it._localKey === localKey)
      if (target?.id) setRemovedIds((ids) => [...ids, target.id])
      return prev.filter((it) => it._localKey !== localKey)
    })
  }

  function move(from, to) {
    if (to < 0 || to >= items.length || from === to) return
    setSaved(false)
    setItems((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError(null)

    const kept = items.filter((it) => it.text.trim() !== '')

    try {
      if (removedIds.length > 0) {
        const { error: delError } = await supabase
          .from('announcement_templates')
          .delete()
          .in('id', removedIds)
        if (delError) throw delError
      }

      // แถวเดิม: อัปเดตข้อความ + ลำดับ / แถวใหม่: insert
      const updates = kept.filter((it) => it.id)
      const inserts = kept.filter((it) => !it.id)

      for (let i = 0; i < updates.length; i++) {
        const it = updates[i]
        const { error: updError } = await supabase
          .from('announcement_templates')
          .update({ text: it.text.trim(), sort_order: kept.indexOf(it) })
          .eq('id', it.id)
        if (updError) throw updError
      }

      if (inserts.length > 0) {
        const { error: insError } = await supabase.from('announcement_templates').insert(
          inserts.map((it) => ({
            org_id: orgId,
            text: it.text.trim(),
            sort_order: kept.indexOf(it),
          }))
        )
        if (insError) throw insError
      }

      setRemovedIds([])
      setSaved(true)

      const { data } = await supabase
        .from('announcement_templates')
        .select('id, text, sort_order')
        .eq('org_id', orgId)
        .order('sort_order')
      setItems((data ?? []).map((r) => ({ ...r, _localKey: r.id })))
    } catch (err) {
      console.error('[BroadcastShortcuts] save failed', err)
      setError(err.message ?? t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader
        icon="megaphone"
        title={t('staff.broadcast.shortcutsTitle')}
        subtitle={t('staff.broadcast.shortcutsHint')}
      />
      <div className="mx-auto max-w-md px-4 pb-16 pt-3">

        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}

        {!loading && (
          <>
            <div className="flex flex-col gap-2">
              {items.map((it, i) => (
                <div
                  key={it._localKey}
                  draggable
                  onDragStart={() => {
                    dragIndex.current = i
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    move(dragIndex.current, i)
                    dragIndex.current = null
                  }}
                  className="flex items-center gap-2 rounded-card bg-surface p-2.5"
                >
                  {/* ลากได้บนเดสก์ท็อป ส่วนมือถือใช้ปุ่มขึ้น-ลง เพราะ drag ใน list ที่เลื่อนได้
                      บนทัชสกรีนชนกับการ scroll จนใช้งานไม่ได้จริง */}
                  <span className="cursor-grab text-ink-faint" aria-hidden="true">
                    ⠿
                  </span>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      aria-label="ขึ้น"
                      className="px-1 text-xs leading-none text-ink-faint disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, i + 1)}
                      disabled={i === items.length - 1}
                      aria-label="ลง"
                      className="px-1 text-xs leading-none text-ink-faint disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>

                  <input
                    value={it.text}
                    onChange={(e) => updateText(it._localKey, e.target.value)}
                    placeholder={t('staff.broadcast.shortcutPlaceholder')}
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={() => removeItem(it._localKey)}
                    aria-label={t('staff.broadcast.deleteShortcut')}
                    className="shrink-0 p-1 text-ink-faint hover:text-danger"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addItem}
                className="rounded-card border border-dashed border-line-strong py-3 text-sm font-medium text-ink-muted"
              >
                + {t('staff.broadcast.addShortcut')}
              </button>
            </div>

            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            {saved && !error && (
              <p className="mt-2 text-sm text-success-text">{t('staff.broadcast.shortcutsSaved')}</p>
            )}

            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-4 w-full rounded-card bg-brand-gradient py-3.5 text-base font-semibold text-white shadow-brand transition active:scale-[0.99] disabled:opacity-50"
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
