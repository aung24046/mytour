import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'

const PRINT_MODES = ['luggage', 'wristband']

// ขนาด label ที่รองรับ (มม.) — 50x30 เป็น default ตามที่ระบุ, 60x40 เป็นตัวเลือกเสริม
const LABEL_SIZES = [
  { id: '50x30', widthMm: 50, heightMm: 30 },
  { id: '60x40', widthMm: 60, heightMm: 40 },
]

function csvEscape(value) {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function PrintExport() {
  const { t } = useTranslation()

  const [mode, setMode] = useState('luggage')
  const [sizeId, setSizeId] = useState('50x30')

  const [luggage, setLuggage] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedIds, setSelectedIds] = useState(new Set())

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [luggageRes, guestsRes] = await Promise.all([
      supabase
        .from('luggage')
        .select('id, tag_code, guest_id, status')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('created_at', { ascending: true }),
      supabase
        .from('guests')
        .select('id, name, nickname, qr_token')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('name'),
    ])

    if (luggageRes.error || guestsRes.error) {
      console.error('[PrintExport] load failed', luggageRes.error, guestsRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setLuggage(luggageRes.data ?? [])
    setGuests(guestsRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0]

  // สร้างรายการ label ที่จะพิมพ์ ตามโหมดที่เลือก
  const labels = useMemo(() => {
    if (mode === 'luggage') {
      return luggage.map((l) => {
        const guest = guestById[l.guest_id]
        return {
          id: l.id,
          qrValue: `${window.location.origin}/bag/${l.tag_code}`,
          topText: l.tag_code,
          bottomText: guest ? guest.nickname || guest.name : t('staff.printExport.unassigned'),
        }
      })
    }
    // wristband: ใช้ qr_token เดิมของ guests ตรงๆ (ตัวเดียวกับหน้า MyQR / ที่ CheckIn สแกนเทียบ)
    return guests.map((g) => ({
      id: g.id,
      qrValue: g.qr_token,
      topText: g.nickname || g.name,
      bottomText: '',
    }))
  }, [mode, luggage, guests, guestById, t])

  useEffect(() => {
    // สลับโหมด/ขนาด แล้วเคลียร์การเลือกไว้ก่อน กันเลือกผิดชุด
    setSelectedIds(new Set())
  }, [mode])

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(labels.map((l) => l.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  const labelsToPrint = selectedIds.size > 0 ? labels.filter((l) => selectedIds.has(l.id)) : labels

  function handlePrint() {
    window.print()
  }

  function handleExportCsv() {
    const rows = [[t('staff.printExport.csvNameHeader'), t('staff.printExport.csvUrlHeader')]]
    for (const l of labelsToPrint) {
      rows.push([l.bottomText || l.topText, l.qrValue])
    }
    downloadCsv(`${mode}-labels-${sizeId}.csv`, rows)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 print:bg-white print:p-0">
      {/* ตัวควบคุม — ซ่อนตอนพิมพ์ */}
      <div className="mx-auto max-w-md print:hidden">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.printExport.title')}</h1>
        <p className="mb-3 text-sm text-gray-500">{t('staff.printExport.subtitle')}</p>

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            <p className="mb-1 text-xs font-medium text-gray-400">{t('staff.printExport.modeLabel')}</p>
            <div className="mb-3 flex gap-2">
              {PRINT_MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
                    mode === m ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {t(`staff.printExport.mode.${m}`)}
                </button>
              ))}
            </div>

            <p className="mb-1 text-xs font-medium text-gray-400">{t('staff.printExport.sizeLabel')}</p>
            <div className="mb-3 flex gap-2">
              {LABEL_SIZES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSizeId(s.id)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
                    sizeId === s.id ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {s.widthMm}×{s.heightMm}mm
                  {s.id === '50x30' && (
                    <span className="ml-1 text-xs opacity-75">
                      ({t('staff.printExport.defaultSize')})
                    </span>
                  )}
                </button>
              ))}
            </div>

            <Card className="mb-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  {t('staff.printExport.selectedCount', {
                    selected: selectedIds.size > 0 ? selectedIds.size : labels.length,
                    total: labels.length,
                  })}
                </span>
                <div className="flex gap-3">
                  <button onClick={selectAll} className="font-semibold text-sky-600">
                    {t('staff.printExport.selectAll')}
                  </button>
                  {selectedIds.size > 0 && (
                    <button onClick={clearSelection} className="font-semibold text-gray-500">
                      {t('staff.printExport.clearSelection')}
                    </button>
                  )}
                </div>
              </div>
            </Card>

            {labels.length === 0 && (
              <p className="mb-3 text-sm text-gray-400">{t('staff.printExport.noLabels')}</p>
            )}

            <div className="mb-3 flex flex-col gap-2">
              {labels.map((l) => (
                <button
                  key={l.id}
                  onClick={() => toggleSelect(l.id)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                    selectedIds.has(l.id) || selectedIds.size === 0
                      ? 'border-sky-200 bg-sky-50'
                      : 'border-gray-200 bg-white opacity-50'
                  }`}
                >
                  <span className="font-mono">{l.topText}</span>
                  <span className="text-gray-500">{l.bottomText}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={handlePrint} disabled={labels.length === 0}>
                {t('staff.printExport.printButton', { count: labelsToPrint.length })}
              </Button>
              <Button variant="secondary" onClick={handleExportCsv} disabled={labels.length === 0}>
                {t('staff.printExport.exportCsvButton')}
              </Button>
            </div>

            <p className="mt-3 text-xs text-gray-400">{t('staff.printExport.sizeLockHint')}</p>
          </>
        )}
      </div>

      {/* พื้นที่พิมพ์จริง — ซ่อนตอนดูปกติ โชว์เฉพาะตอนพิมพ์ */}
      <div className="hidden print:block">
        {labelsToPrint.map((l) => (
          <div
            key={l.id}
            className="label-page flex flex-col items-center justify-center"
            style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm` }}
          >
            <QRCodeSVG value={l.qrValue} size={size.heightMm * 2.2} />
            <p className="label-text">{l.topText}</p>
            {l.bottomText && <p className="label-subtext">{l.bottomText}</p>}
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          @page {
            size: ${size.widthMm}mm ${size.heightMm}mm;
            margin: 0;
          }
          .label-page {
            page-break-after: always;
            box-sizing: border-box;
            padding: 1mm;
          }
          .label-text {
            font-size: 2.2mm;
            font-weight: 700;
            margin-top: 0.5mm;
            text-align: center;
          }
          .label-subtext {
            font-size: 1.8mm;
            color: #333;
            text-align: center;
          }
        }
      `}</style>
    </div>
  )
}
