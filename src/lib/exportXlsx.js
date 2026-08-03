// สร้างไฟล์ .xlsx จริง (ไม่ใช่ CSV เปลี่ยนนามสกุล) โดยไม่พึ่ง dependency ภายนอก
//
// ทำไมไม่ใช้ SheetJS: โปรเจกต์นี้เป็น PWA ที่ต้องทำงานออฟไลน์ได้ การเพิ่มไลบรารีใหญ่
// เข้า bundle เพื่อใช้แค่ "เขียนตารางลงชีต" ไม่คุ้ม — ไฟล์ xlsx คือ zip ที่บรรจุ XML
// ไม่กี่ไฟล์ เขียนเองได้ในร้อยกว่าบรรทัดและควบคุมผลลัพธ์ได้เต็มที่
//
// รองรับ: หลายชีต, หัวตารางตัวหนา, ตรึงแถวหัว, ความกว้างคอลัมน์, ข้อความไทย (UTF-8)
// ไม่รองรับ: สูตร, merge cell, รูป — ยังไม่มีเอกสารไหนต้องใช้

// ── ZIP (store mode, ไม่บีบอัด) ────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function utf8(str) {
  return new TextEncoder().encode(str)
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** files: [{ name, data: Uint8Array }] → Blob ของไฟล์ zip */
function makeZip(files) {
  const { time, date } = dosDateTime()
  const chunks = []
  const central = []
  let offset = 0

  for (const file of files) {
    const nameBytes = utf8(file.name)
    const crc = crc32(file.data)
    const size = file.data.length

    // local file header
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // flag: ชื่อไฟล์เป็น UTF-8
    lv.setUint16(8, 0, true) // method: store
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    chunks.push(local, file.data)

    // central directory entry
    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cd.set(nameBytes, 46)
    central.push(cd)

    offset += local.length + size
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...chunks, ...central, eocd], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ── XLSX ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // อักขระควบคุมทำให้ Excel ฟ้องว่าไฟล์เสีย — ตัดทิ้งก่อน
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function colName(n) {
  let s = ''
  n += 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}


function cellXml(value, ref, headerRow) {
  if (value == null || value === '') return `<c r="${ref}"${headerRow ? ' s="1"' : ''}/>`

  const raw = String(value).trim()
  const isPlainNumber =
    !headerRow &&
    /^-?\d+(\.\d+)?$/.test(raw) &&
    raw.length < 10 && // ยาวกว่านี้มักเป็นรหัส ไม่ใช่จำนวน
    !raw.startsWith('0')

  if (isPlainNumber) {
    return `<c r="${ref}"><v>${raw}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"${headerRow ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(raw)}</t></is></c>`
}

function sheetXml(rows, colWidths) {
  const cols = colWidths?.length
    ? `<cols>${colWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''

  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => cellXml(v, `${colName(c)}${r + 1}`, r === 0))
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols}<sheetData>${body}</sheetData></worksheet>`
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1EFE8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`

/**
 * สร้างและดาวน์โหลดไฟล์ .xlsx
 *
 * sheets: [{ name, rows: [[...], ...], colWidths?: number[] }]
 *         rows[0] ถือเป็นแถวหัวตาราง (ตัวหนา พื้นเทา ตรึงไว้)
 */
export function downloadXlsx(filename, sheets) {
  const safeSheets = sheets.map((s, i) => ({
    // ชื่อชีตห้ามเกิน 31 ตัวและห้ามมี : \ / ? * [ ]
    name: (s.name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, '-').slice(0, 31),
    rows: s.rows ?? [],
    colWidths: s.colWidths,
  }))

  const files = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${safeSheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join('')}
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${safeSheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${safeSheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  )
  .join('')}
<Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { name: 'xl/styles.xml', data: utf8(STYLES_XML) },
    ...safeSheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: utf8(sheetXml(s.rows, s.colWidths)),
    })),
  ]

  const blob = makeZip(files)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** แปลง columns + rows ของ DocumentTable เป็นแถวสำหรับ xlsx (ใส่ทุกคอลัมน์ รวม subrow/footnote) */
export function tableToSheetRows(columns, rows) {
  const header = columns.map((c) => c.label ?? c.key)
  const body = rows.map((row) => columns.map((c) => row[c.key] ?? ''))
  return [header, ...body]
}
