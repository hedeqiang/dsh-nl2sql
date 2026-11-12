/**
 * Dependency-free PowerPoint (.pptx, OOXML PresentationML) writer.
 *
 *   buildPptx({ title, subtitle, lines, slides: [Slide] }) → Buffer
 *   Slide = { title, image?: Buffer (PNG), imageAspect?: number, table?: { columns:[{name,kind}], rows }, kpis?: [{ label, value }],
 *             text?: string, notes?: string, footer?: string }
 *
 * One 16:9 deck: a title slide, then one slide per entry. Parts: one slide master,
 * one blank layout, a theme, a notes master (with its own theme) and one notes
 * slide per slide that has notes. Also exports a tiny zip reader (`unzip`) used by tests.
 */
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'

const EMU = 914400 // per inch
const SLIDE_W = 12192000 // 13.333 in
const SLIDE_H = 6858000 // 7.5 in
const FONT = 'Microsoft YaHei'

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
}
const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
  presProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps',
  viewProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
  tableStyles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles',
}
const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
}
export const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** XML text/attribute escape (drops characters illegal in XML 1.0). */
export function xmlEsc(s) {
  return String(s ?? '').replace(ILLEGAL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const emu = (inches) => Math.round(inches * EMU)

// ------------------------------------------------------------------ zip

function dosDateTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}

/** Zip archive from [{ name, data }]; PNGs are stored, XML deflated. */
export function zip(files) {
  const { time, date } = dosDateTime(new Date())
  const chunks = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8')
    const crc = zlib.crc32(data) >>> 0
    const store = /\.(png|jpe?g)$/i.test(f.name)
    const comp = store ? data : zlib.deflateRawSync(data, { level: 6 })
    const method = store ? 0 : 8
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, comp)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += 30 + name.length + comp.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cdBuf, eocd])
}

/** Read a (non-zip64) archive into Map<name, Buffer>. */
export function unzip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('not a zip archive')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30)
    const comment = buf.readUInt16LE(p + 32)
    const off = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lname = buf.readUInt16LE(off + 26)
    const lextra = buf.readUInt16LE(off + 28)
    const data = buf.subarray(off + 30 + lname + lextra, off + 30 + lname + lextra + csize)
    out.set(name, method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data))
    p += 46 + nameLen + extra + comment
  }
  return out
}

// ------------------------------------------------------------------ static parts

function rels(list) {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"/>`).join('')}</Relationships>`
}

function theme(name) {
  const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  const ln = (w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`
  return `${XML}<a:theme xmlns:a="${NS.a}" name="${name}"><a:themeElements>`
    + `<a:clrScheme name="nl2sql"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${clr('dk2', '1F2329')}${clr('lt2', 'F5F6F7')}${clr('accent1', '3370FF')}${clr('accent2', '34C724')}${clr('accent3', 'FF8800')}${clr('accent4', 'F54A45')}${clr('accent5', '7F3BF5')}${clr('accent6', '14C0FF')}${clr('hlink', '3370FF')}${clr('folHlink', '7F3BF5')}</a:clrScheme>`
    + `<a:fontScheme name="nl2sql"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="nl2sql"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>`
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}

const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const lvl = (size) => `<a:lvl1pPr><a:defRPr sz="${size}"><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr>`

function slideMaster() {
  return `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>`
    + `<p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>`
    + `<p:txStyles><p:titleStyle>${lvl(3200)}</p:titleStyle><p:bodyStyle>${lvl(1800)}</p:bodyStyle><p:otherStyle>${lvl(1400)}</p:otherStyle></p:txStyles></p:sldMaster>`
}

function slideLayout() {
  return `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}

function notesMaster() {
  const ph = (id, name, type, idx, x, y, w, hgt) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${hgt}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${type === 'body' ? '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody>' : ''}</p:sp>`
  return `${XML}<p:notesMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}`
    + ph(2, 'Slide Image Placeholder 1', 'sldImg', 2, 381000, 685800, 6096000, 3429000)
    + ph(3, 'Notes Placeholder 2', 'body', 3, 685800, 4400550, 5486400, 3600450)
    + `</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:notesStyle>${lvl(1200)}</p:notesStyle></p:notesMaster>`
}

function notesSlide(text) {
  const paras = String(text).split(/\r?\n/).map(line => `<a:p><a:r><a:rPr lang="zh-CN" dirty="0"/><a:t>${xmlEsc(line)}</a:t></a:r></a:p>`).join('')
  return `${XML}<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>${GROUP}`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
    + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="zh-CN"/></a:p>'}</p:txBody></p:sp>`
    + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
}

// ------------------------------------------------------------------ shapes

/** A text box. runs: string | [{ text, size, bold, color }] per paragraph. */
function textBox(id, name, { x, y, w, h, paragraphs, align = 'l', anchor = 't', size = 1800, color = '1F2329', bold = false }) {
  const paras = paragraphs.map(p => {
    const runs = (Array.isArray(p) ? p : [{ text: p }]).map(r => `<a:r><a:rPr lang="zh-CN" sz="${r.size ?? size}" b="${(r.bold ?? bold) ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${r.color ?? color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:rPr><a:t>${xmlEsc(r.text)}</a:t></a:r>`).join('')
    return `<a:p><a:pPr algn="${align}"/>${runs}</a:p>`
  }).join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`
}

function rect(id, { x, y, w, h, fill }) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Bar ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`
}

function picture(id, rid, { x, y, w, h }) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
}

function cellText(v, max = 40) {
  if (v === null || v === undefined) return ''
  const s = String(v).replace(/\r\n?|\n/g, ' ')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function fmtNumber(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** A native table (graphicFrame) with ≤ 15 rows × ≤ 8 columns. */
function tableFrame(id, table, { x, y, w, maxRows = 15, maxCols = 8 }) {
  const cols = table.columns.slice(0, maxCols)
  const rows = table.rows.slice(0, maxRows)
  const rowH = rows.length > 10 ? emu(0.3) : emu(0.36)
  const colW = Math.floor(w / Math.max(1, cols.length))
  const size = cols.length > 6 || rows.length > 10 ? 1000 : 1200
  const cell = (text, { header, num, odd }) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${num ? 'r' : 'l'}"/><a:r><a:rPr lang="zh-CN" sz="${size}" b="${header ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${header ? 'FFFFFF' : '1F2329'}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:rPr><a:t>${xmlEsc(text)}</a:t></a:r></a:p></a:txBody>`
    + `<a:tcPr marL="68580" marR="68580" marT="22860" marB="22860" anchor="ctr"><a:lnL w="6350"><a:solidFill><a:srgbClr val="DEE0E3"/></a:solidFill></a:lnL><a:lnR w="6350"><a:solidFill><a:srgbClr val="DEE0E3"/></a:solidFill></a:lnR><a:lnT w="6350"><a:solidFill><a:srgbClr val="DEE0E3"/></a:solidFill></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="DEE0E3"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="${header ? '3370FF' : odd ? 'F5F6F7' : 'FFFFFF'}"/></a:solidFill></a:tcPr></a:tc>`
  const head = `<a:tr h="${rowH}">${cols.map(c => cell(cellText(c.name, 30), { header: true, num: c.kind === 'number' })).join('')}</a:tr>`
  const body = rows.map((r, ri) => `<a:tr h="${rowH}">${cols.map((c, ci) => cell(c.kind === 'number' ? fmtNumber(r[ci]) : r[ci] === null ? 'NULL' : cellText(r[ci]), { num: c.kind === 'number', odd: ri % 2 === 1 })).join('')}</a:tr>`).join('')
  const h = rowH * (rows.length + 1)
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${colW * cols.length}" cy="${h}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${cols.map(() => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${head}${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

function slideXml(shapes) {
  return `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>${GROUP}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

const MARGIN = emu(0.6)
const CONTENT_W = SLIDE_W - 2 * MARGIN

function titleSlideShapes({ title, subtitle, lines = [] }) {
  return [
    rect(2, { x: 0, y: 0, w: SLIDE_W, h: emu(0.16), fill: '3370FF' }),
    textBox(3, 'Title', { x: MARGIN, y: emu(2.3), w: CONTENT_W, h: emu(1.3), paragraphs: [title || 'Untitled'], size: 4000, bold: true, anchor: 'b' }),
    textBox(4, 'Subtitle', { x: MARGIN, y: emu(3.75), w: CONTENT_W, h: emu(1.8), paragraphs: [subtitle, ...lines].filter(Boolean).map(s => String(s)), size: 1800, color: '646A73' }),
  ]
}

function contentSlideShapes(s, index, imageRid) {
  const shapes = [
    rect(2, { x: 0, y: 0, w: SLIDE_W, h: emu(0.08), fill: '3370FF' }),
    textBox(3, 'Title', { x: MARGIN, y: emu(0.3), w: CONTENT_W, h: emu(0.8), paragraphs: [s.title || `#${index}`], size: 2600, bold: true, anchor: 'ctr' }),
  ]
  const top = emu(1.25)
  const bottom = SLIDE_H - emu(0.6)
  const availH = bottom - top
  let id = 4
  if (imageRid) {
    const aspect = s.imageAspect || 2
    let w = CONTENT_W
    let h = Math.round(w / aspect)
    if (h > availH) { h = availH; w = Math.round(h * aspect) }
    shapes.push(picture(id++, imageRid, { x: Math.round((SLIDE_W - w) / 2), y: top, w, h }))
  } else if (s.kpis?.length) {
    const list = s.kpis.slice(0, 6)
    const per = Math.floor(CONTENT_W / list.length)
    list.forEach((k, i) => shapes.push(textBox(id++, `KPI ${i + 1}`, { x: MARGIN + i * per, y: emu(2.3), w: per, h: emu(2.4), align: 'ctr', anchor: 'ctr', paragraphs: [[{ text: k.value, size: list.length > 3 ? 4000 : 5400, bold: true, color: '3370FF' }], [{ text: k.label, size: 1600, color: '646A73' }]] })))
  } else if (s.table?.columns?.length) {
    shapes.push(tableFrame(id++, s.table, { x: MARGIN, y: top, w: CONTENT_W }))
  } else if (s.text) {
    shapes.push(textBox(id++, 'Text', { x: MARGIN, y: top, w: CONTENT_W, h: availH, paragraphs: String(s.text).split(/\r?\n/).slice(0, 20), size: 1600, color: s.error ? 'F54A45' : '1F2329' }))
  }
  if (s.footer) shapes.push(textBox(id++, 'Footer', { x: MARGIN, y: SLIDE_H - emu(0.55), w: CONTENT_W, h: emu(0.4), paragraphs: [s.footer], size: 1000, color: '8F959E' }))
  return shapes
}

/** Build the deck. Returns a Buffer. */
export function buildPptx({ title, subtitle, lines = [], slides = [], author = 'DeepSeek Harness 数据问答' } = {}) {
  const files = []
  const add = (name, data) => files.push({ name, data })
  const deck = [{ kind: 'title' }, ...slides.map(s => ({ kind: 'content', ...s }))]
  const ctOverrides = []
  let image = 0
  let notes = 0
  const slideIds = []
  deck.forEach((s, i) => {
    const n = i + 1
    const sRels = [{ id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' }]
    let imageRid
    if (s.image) {
      image++
      imageRid = `rId${sRels.length + 1}`
      sRels.push({ id: imageRid, type: REL.image, target: `../media/image${image}.png` })
      add(`ppt/media/image${image}.png`, s.image)
    }
    if (s.notes) {
      notes++
      sRels.push({ id: `rId${sRels.length + 1}`, type: REL.notesSlide, target: `../notesSlides/notesSlide${notes}.xml` })
      add(`ppt/notesSlides/notesSlide${notes}.xml`, notesSlide(s.notes))
      add(`ppt/notesSlides/_rels/notesSlide${notes}.xml.rels`, rels([{ id: 'rId1', type: REL.notesMaster, target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: REL.slide, target: `../slides/slide${n}.xml` }]))
      ctOverrides.push([`/ppt/notesSlides/notesSlide${notes}.xml`, CT.notesSlide])
    }
    const shapes = s.kind === 'title' ? titleSlideShapes({ title, subtitle, lines }) : contentSlideShapes(s, i, imageRid)
    add(`ppt/slides/slide${n}.xml`, slideXml(shapes))
    add(`ppt/slides/_rels/slide${n}.xml.rels`, rels(sRels))
    ctOverrides.push([`/ppt/slides/slide${n}.xml`, CT.slide])
    slideIds.push(n)
  })
  // presentation rels: rId1 master, rId2..N+1 slides, then notes master, props, theme.
  const pRels = [{ id: 'rId1', type: REL.slideMaster, target: 'slideMasters/slideMaster1.xml' }]
  for (const n of slideIds) pRels.push({ id: `rId${n + 1}`, type: REL.slide, target: `slides/slide${n}.xml` })
  const k = slideIds.length + 2
  pRels.push({ id: `rId${k}`, type: REL.notesMaster, target: 'notesMasters/notesMaster1.xml' })
  pRels.push({ id: `rId${k + 1}`, type: REL.presProps, target: 'presProps.xml' })
  pRels.push({ id: `rId${k + 2}`, type: REL.viewProps, target: 'viewProps.xml' })
  pRels.push({ id: `rId${k + 3}`, type: REL.theme, target: 'theme/theme1.xml' })
  pRels.push({ id: `rId${k + 4}`, type: REL.tableStyles, target: 'tableStyles.xml' })
  const presentation = `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + `<p:notesMasterIdLst><p:notesMasterId r:id="rId${k}"/></p:notesMasterIdLst>`
    + `<p:sldIdLst>${slideIds.map(n => `<p:sldId id="${255 + n}" r:id="rId${n + 1}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>`
    + `<p:defaultTextStyle>${lvl(1800)}</p:defaultTextStyle></p:presentation>`
  add('ppt/presentation.xml', presentation)
  add('ppt/_rels/presentation.xml.rels', rels(pRels))
  add('ppt/slideMasters/slideMaster1.xml', slideMaster())
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([{ id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: REL.theme, target: '../theme/theme1.xml' }]))
  add('ppt/slideLayouts/slideLayout1.xml', slideLayout())
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: REL.slideMaster, target: '../slideMasters/slideMaster1.xml' }]))
  add('ppt/notesMasters/notesMaster1.xml', notesMaster())
  add('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([{ id: 'rId1', type: REL.theme, target: '../theme/theme2.xml' }]))
  add('ppt/theme/theme1.xml', theme('nl2sql'))
  add('ppt/theme/theme2.xml', theme('nl2sql notes'))
  add('ppt/presProps.xml', `${XML}<p:presentationPr xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"/>`)
  add('ppt/viewProps.xml', `${XML}<p:viewPr xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`)
  add('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  add('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>${xmlEsc(author)}</dc:creator><cp:lastModifiedBy>${xmlEsc(author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  add('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>${xmlEsc(author)}</Application><Slides>${slideIds.length}</Slides><Notes>${notes}</Notes><PresentationFormat>On-screen Show (16:9)</PresentationFormat></Properties>`)
  add('_rels/.rels', rels([{ id: 'rId1', type: REL.officeDocument, target: 'ppt/presentation.xml' }, { id: 'rId2', type: REL.core, target: 'docProps/core.xml' }, { id: 'rId3', type: REL.app, target: 'docProps/app.xml' }]))
  const overrides = [
    ['/ppt/presentation.xml', CT.presentation], ['/ppt/slideMasters/slideMaster1.xml', CT.slideMaster], ['/ppt/slideLayouts/slideLayout1.xml', CT.slideLayout],
    ['/ppt/notesMasters/notesMaster1.xml', CT.notesMaster], ['/ppt/theme/theme1.xml', CT.theme], ['/ppt/theme/theme2.xml', CT.theme],
    ['/ppt/presProps.xml', CT.presProps], ['/ppt/viewProps.xml', CT.viewProps], ['/ppt/tableStyles.xml', CT.tableStyles],
    ['/docProps/core.xml', CT.core], ['/docProps/app.xml', CT.app], ...ctOverrides,
  ]
  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.map(([p, c]) => `<Override PartName="${p}" ContentType="${c}"/>`).join('')}</Types>`
  // [Content_Types].xml first, as Office expects.
  return zip([{ name: '[Content_Types].xml', data: contentTypes }, ...files.sort((a, b) => (a.name === '_rels/.rels' ? -1 : b.name === '_rels/.rels' ? 1 : 0))])
}
