// Self-contained XLSX writer/reader, CSV parser and column type inference.
// No npm dependencies: only node:zlib and node:buffer.

import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const MAX_SHEET_ROWS = 1048576; // Excel hard limit (rows incl. header/title)
const MAX_CELL_CHARS = 32767;
const ILLEGAL_XML_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const WIDE_CHAR_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

/** Remove characters that are illegal in XML 1.0 (keeps \t \n \r). */
function stripIllegal(s) {
  return s.replace(ILLEGAL_XML_RE, '');
}

/** Escape text for XML element/attribute content. */
function esc(s) {
  return stripIllegal(String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a cell string: XML escape plus OOXML `_xHHHH_` literal protection. */
function escCellText(s) {
  return esc(s).replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_');
}

/** Decode XML entities (named + numeric) and OOXML `_xHHHH_` escapes. */
function decodeXml(s, ooxml = false) {
  if (!s) return '';
  let out = s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    switch (e) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(cp); } catch { return ''; }
      }
    }
  });
  if (ooxml && out.indexOf('_x') >= 0) {
    out = out.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return out;
}

/** Parse XML attributes into a plain object (keys keep their prefixes). */
function parseAttrs(s) {
  const out = {};
  if (!s) return out;
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decodeXml(m[2] ?? m[3]);
  return out;
}

/** 0-based column index → letters (0 → A). */
function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** Letters → 0-based column index (A → 0). */
function colIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) & 0x1f);
  return n - 1;
}

/** Display width estimate: CJK / full-width characters count double. */
function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += WIDE_CHAR_RE.test(ch) ? 2 : 1;
  return w;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Format a Date (UTC parts) as `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD`. */
function fmtDate(d, withTime) {
  const s = `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return withTime ? `${s} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}` : s;
}

/* ------------------------------------------------------------------ */
/* ZIP writer                                                          */
/* ------------------------------------------------------------------ */

/** DOS date/time words for a JS Date (local time). */
function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Build a deflate-compressed zip archive.
 * @param {{name: string, data: Buffer}[]} files
 * @returns {Buffer}
 */
function buildZip(files) {
  const { time, date } = dosDateTime(new Date());
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = zlib.crc32(data) >>> 0;
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    // extra len, comment len, disk start, internal attrs = 0
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

/* ------------------------------------------------------------------ */
/* XLSX writer                                                         */
/* ------------------------------------------------------------------ */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// cellXfs indices
const S_TITLE = 1, S_NOTE = 2, S_HEADER = 3, S_INT = 4, S_DEC = 5;

const STYLES_XML = XML_HEAD +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>' +
  '<fonts count="4">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  '<font><i/><sz val="10"/><color rgb="FF808080"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  '<font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  '</fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFA0A0A0"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
  '</styleSheet>';

const SHEET_NAME_BAD_RE = /[\[\]:*?/\\]/g;

/** First `max` UTF-16 units of `s` (Excel's sheet-name limit), never splitting a surrogate pair. */
function utf16Prefix(s, max) {
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** Make Excel-safe, unique (case-insensitive), non-empty sheet names. */
function sanitizeSheetNames(names) {
  const used = new Set(['history']); // "History" is reserved by Excel
  return names.map((raw, i) => {
    let base = stripIllegal(String(raw ?? '')).replace(SHEET_NAME_BAD_RE, '_').replace(/[\r\n\t]/g, ' ').trim();
    base = base.replace(/^'+|'+$/g, '').trim();
    if (!base) base = `Sheet${i + 1}`;
    base = utf16Prefix(base, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = utf16Prefix(base, 31 - suffix.length).trimEnd() + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

const NUM_STR_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Decide whether a value in a 'number' column can be written as a numeric cell.
 * @returns {number|null} the number, or null when it must stay text
 */
function asNumber(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (Number.isInteger(v) && !Number.isSafeInteger(v)) return null;
    return v;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || !NUM_STR_RE.test(s)) return null;
  const digits = s.replace(/[eE].*$/, '').replace(/\D/g, '');
  if (digits.length >= 16) return null; // IDs / precision loss
  if (/^[-+]?0\d/.test(s)) return null; // leading-zero codes
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return null;
  return n;
}

/** Convert any non-number value to the cell's display string. */
function toText(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : fmtDate(v, true);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  if (typeof v === 'object') {
    try { return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)); } catch { return String(v); }
  }
  return String(v);
}

/** Write string chunks into Buffers periodically to avoid giant JS strings. */
class XmlSink {
  constructor() { this.parts = []; this.bufs = []; this.len = 0; }
  push(s) {
    this.parts.push(s);
    this.len += s.length;
    if (this.len > 4_000_000) this.flush();
  }
  flush() {
    if (this.parts.length) this.bufs.push(Buffer.from(this.parts.join(''), 'utf8'));
    this.parts = [];
    this.len = 0;
  }
  toBuffer() { this.flush(); return Buffer.concat(this.bufs); }
}

/**
 * Write sheets to an .xlsx workbook.
 * @param {{name: string, columns: {name: string, kind?: 'number'|'time'|'text'}[], rows: any[][], title?: string, note?: string}[]} sheets
 * @param {{creator?: string}} [opts]
 * @returns {Buffer}
 */
export function writeXlsx(sheets, { creator } = {}) {
  if (!Array.isArray(sheets) || sheets.length === 0) sheets = [{ name: 'Sheet1', columns: [], rows: [] }];
  const names = sanitizeSheetNames(sheets.map((s) => s?.name));
  const sst = new Map();
  let sstCount = 0;
  const strIndex = (s) => {
    sstCount++;
    let i = sst.get(s);
    if (i === undefined) { i = sst.size; sst.set(s, i); }
    return i;
  };
  const filterNames = [];

  const sheetBufs = sheets.map((sheet, si) => {
    const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
    let rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    let title = sheet?.title != null && sheet.title !== '' ? String(sheet.title) : '';
    let note = sheet?.note != null && sheet.note !== '' ? String(sheet.note) : '';
    const ncol = Math.max(columns.length, 1);

    // Layout: [title][note][blank] header data...
    let headerRow = title || note ? (title ? 1 : 0) + (note ? 1 : 0) + 2 : 1;
    if (rows.length > MAX_SHEET_ROWS - headerRow) {
      // Ensure title + note rows exist: title, note, blank, header.
      if (!title) title = names[si];
      headerRow = 4;
      const keep = MAX_SHEET_ROWS - headerRow;
      const msg = `数据已截断：仅保留前 ${keep} 行（共 ${rows.length} 行）`;
      note = note ? `${note}；${msg}` : msg;
      rows = rows.slice(0, keep);
    }

    const kinds = columns.map((c) => c?.kind || 'text');
    const out = new XmlSink();
    const lastRow = headerRow + rows.length;
    const lastCol = colName(ncol - 1);
    out.push(XML_HEAD + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`);
    out.push(`<dimension ref="A1:${lastCol}${Math.max(lastRow, 1)}"/>`);
    out.push(`<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}>`);
    if (columns.length) {
      out.push(`<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`);
    }
    out.push('</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>');

    // Column widths from header + first 200 values.
    if (columns.length) {
      out.push('<cols>');
      columns.forEach((c, j) => {
        let w = displayWidth(String(c?.name ?? ''));
        const n = Math.min(rows.length, 200);
        for (let r = 0; r < n; r++) {
          const v = rows[r]?.[j];
          if (v == null) continue;
          const num = kinds[j] === 'number' ? asNumber(v) : null;
          const s = num !== null ? num.toLocaleString('en-US', { maximumFractionDigits: 2 }) : toText(v);
          const firstLine = s.length > 200 ? s.slice(0, 200) : s;
          w = Math.max(w, displayWidth(firstLine.split('\n')[0]));
        }
        const width = Math.min(60, Math.max(8, w + 2));
        out.push(`<col min="${j + 1}" max="${j + 1}" width="${width}" customWidth="1"/>`);
      });
      out.push('</cols>');
    }

    out.push('<sheetData>');
    const strCell = (ref, s, style) => {
      s = stripIllegal(s);
      if (s.length > MAX_CELL_CHARS) s = s.slice(0, MAX_CELL_CHARS);
      return `<c r="${ref}" t="s"${style ? ` s="${style}"` : ''}><v>${strIndex(s)}</v></c>`;
    };
    let rowNo = 1;
    if (title) out.push(`<row r="${rowNo}">${strCell(`A${rowNo}`, title, S_TITLE)}</row>`), rowNo++;
    if (note) out.push(`<row r="${rowNo}">${strCell(`A${rowNo}`, note, S_NOTE)}</row>`), rowNo++;
    if (columns.length) {
      let h = `<row r="${headerRow}">`;
      columns.forEach((c, j) => { h += strCell(colName(j) + headerRow, String(c?.name ?? ''), S_HEADER); });
      out.push(h + '</row>');
    }
    const colRefs = columns.map((_, j) => colName(j));
    for (let i = 0; i < rows.length; i++) {
      const r = headerRow + 1 + i;
      const row = rows[i];
      let x = `<row r="${r}">`;
      if (Array.isArray(row)) {
        const n = Math.max(columns.length, 0) || row.length;
        for (let j = 0; j < n && j < row.length; j++) {
          const v = row[j];
          if (v == null || v === '') continue;
          const ref = (colRefs[j] ?? colName(j)) + r;
          const num = kinds[j] === 'number' ? asNumber(v) : null;
          if (num !== null) {
            x += `<c r="${ref}" s="${Number.isInteger(num) ? S_INT : S_DEC}"><v>${num}</v></c>`;
          } else {
            x += strCell(ref, toText(v), 0);
          }
        }
      }
      out.push(x + '</row>');
    }
    out.push('</sheetData>');
    if (columns.length) {
      const ref = `A${headerRow}:${lastCol}${lastRow}`;
      out.push(`<autoFilter ref="${ref}"/>`);
      filterNames.push({ si, ref: `'${names[si].replace(/'/g, "''")}'!$A$${headerRow}:$${lastCol}$${lastRow}` });
    }
    out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
    return out.toBuffer();
  });

  // Shared strings
  const ss = new XmlSink();
  ss.push(XML_HEAD + `<sst xmlns="${NS_MAIN}" count="${sstCount}" uniqueCount="${sst.size}">`);
  for (const s of sst.keys()) {
    const preserve = /^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : '';
    ss.push(`<si><t${preserve}>${escCellText(s)}</t></si>`);
  }
  ss.push('</sst>');

  const n = sheets.length;
  const sheetIdx = Array.from({ length: n }, (_, i) => i + 1);
  const contentTypes = XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheetIdx.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';
  const rootRels = XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>';
  const app = XML_HEAD +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Application>${esc(creator || 'Microsoft Excel')}</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>` +
    `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${n}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${n}" baseType="lpstr">${names.map((s) => `<vt:lpstr>${esc(s)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>` +
    '<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>' +
    '</Properties>';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    (creator ? `<dc:creator>${esc(creator)}</dc:creator><cp:lastModifiedBy>${esc(creator)}</cp:lastModifiedBy>` : '') +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    '</cp:coreProperties>';
  const workbook = XML_HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    '<workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews><sheets>' +
    names.map((s, i) => `<sheet name="${esc(s)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
    (filterNames.length ? '<definedNames>' + filterNames.map((f) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${f.si}" hidden="1">${esc(f.ref)}</definedName>`).join('') + '</definedNames>' : '') +
    '<calcPr calcId="191029"/></workbook>';
  const wbRels = XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">` +
    sheetIdx.map((i) => `<Relationship Id="rId${i}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('') +
    `<Relationship Id="rId${n + 1}" Type="${NS_R}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>';

  const b = (s) => Buffer.from(s, 'utf8');
  return buildZip([
    { name: '[Content_Types].xml', data: b(contentTypes) },
    { name: '_rels/.rels', data: b(rootRels) },
    { name: 'docProps/app.xml', data: b(app) },
    { name: 'docProps/core.xml', data: b(core) },
    { name: 'xl/workbook.xml', data: b(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: b(wbRels) },
    { name: 'xl/styles.xml', data: b(STYLES_XML) },
    ...sheetBufs.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
    { name: 'xl/sharedStrings.xml', data: ss.toBuffer() },
  ]);
}

/* ------------------------------------------------------------------ */
/* ZIP reader                                                          */
/* ------------------------------------------------------------------ */

const unsupported = (why) => new Error(`不支持的 Excel 文件：${why}`);

/**
 * Parse a zip central directory.
 * @returns {Map<string, {name, method, flags, csize, usize, offset}>}
 */
function readZipEntries(buf) {
  if (buf.length < 22) throw unsupported('文件过小或已损坏');
  const sig = buf.readUInt32LE(0);
  if (sig === 0xe011cfd0) {
    if (buf.includes(Buffer.from('EncryptionInfo', 'utf16le'))) throw unsupported('文件已加密（受密码保护），请取消密码后重新导出');
    throw new Error('暂不支持旧版 .xls，请另存为 .xlsx 或 CSV');
  }
  if (sig !== 0x04034b50 && sig !== 0x06054b50) throw unsupported('不是有效的 .xlsx（zip）文件');
  let eocd = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 65535); i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw unsupported('找不到 zip 目录，文件可能已损坏');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw unsupported('不支持 zip64 格式');
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw unsupported('zip 目录已损坏');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/').replace(/^\//, '');
    entries.set(name, { name, flags, method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extract one zip entry as a Buffer. */
function extractEntry(buf, e) {
  if (e.flags & 1) throw unsupported('文件已加密（受密码保护），请取消密码后重新导出');
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw unsupported(`zip 条目已损坏（${e.name}）`);
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method === 8) {
    // Cap decompressed size (zip bombs): 512 MB per part.
    try { return zlib.inflateRawSync(raw, { maxOutputLength: 512 * 1024 * 1024 }); } catch (err) { throw unsupported(`解压失败（${e.name}）：${err.code === 'ERR_BUFFER_TOO_LARGE' ? '解压后超过 512 MB' : err.message}`); }
  }
  throw unsupported(`不支持的压缩方式 ${e.method}（${e.name}）`);
}

/* ------------------------------------------------------------------ */
/* XLSX reader                                                         */
/* ------------------------------------------------------------------ */

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** True when a custom number format code renders a date/time. */
function isDateFormat(code) {
  if (!code || /^general$/i.test(code)) return false;
  const s = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '');
  return /[ymdhs]/i.test(s);
}

/** Resolve a relationship target against the source part's directory. */
function resolvePart(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'));
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  return out.join('/');
}

/** Parse a .rels part into Map<Id, {target, type}>. */
function parseRels(xml, baseDir) {
  const out = new Map();
  if (!xml) return out;
  const re = /<(?:\w+:)?Relationship\b([^>]*)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = parseAttrs(m[1]);
    if (a.TargetMode === 'External' || !a.Target) continue;
    out.set(a.Id, { target: resolvePart(baseDir, a.Target), type: a.Type || '' });
  }
  return out;
}

/** Collect the text of all `<t>` elements in an `<si>` / `<is>` block (ignoring phonetic runs). */
function collectText(xml) {
  const body = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let s = '';
  const re = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  let m;
  while ((m = re.exec(body))) if (m[1]) s += m[1];
  return decodeXml(s, true);
}

/** Excel serial number → ISO-like string. */
function serialToIso(serial, date1904) {
  if (!Number.isFinite(serial)) return null;
  if (!date1904 && serial >= 60 && serial < 61) return '1900-02-29';
  const secs = Math.round(serial * 86400);
  const days = Math.floor(secs / 86400);
  const rem = secs - days * 86400;
  if (days === 0 && rem > 0 && !date1904) {
    return `${pad2(Math.floor(rem / 3600))}:${pad2(Math.floor(rem / 60) % 60)}:${pad2(rem % 60)}`;
  }
  let base;
  if (date1904) base = Date.UTC(1904, 0, 1);
  else base = serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(base + secs * 1000);
  return fmtDate(d, rem !== 0);
}

/** Read a zip part as UTF-8 text (or null when missing). */
function makePartReader(buf, entries) {
  const lower = new Map([...entries.keys()].map((k) => [k.toLowerCase(), k]));
  return (name) => {
    const e = entries.get(name) || entries.get(lower.get(name.toLowerCase()));
    if (!e) return null;
    const data = extractEntry(buf, e);
    if (data.length > 0x1fffffe8 / 2) throw unsupported(`工作表过大（${name}），请拆分后再导入`);
    let s = data.toString('utf8');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return s;
  };
}

/**
 * Parse one worksheet XML into rows.
 * @returns {{rows: any[][], truncated: boolean}}
 */
function parseSheet(xml, ctx, maxRows) {
  const rows = [];
  let truncated = false;
  const sdStart = xml.search(/<(?:\w+:)?sheetData\b/);
  if (sdStart < 0) return { rows, truncated };
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  rowRe.lastIndex = sdStart;
  let firstRow = -1;
  let prevRow = 0;
  let lastNonEmpty = -1;
  let m;
  while ((m = rowRe.exec(xml))) {
    const ra = /\br="(\d+)"/.exec(m[1]);
    const rowNo = ra ? parseInt(ra[1], 10) : prevRow + 1;
    prevRow = rowNo;
    if (!m[2]) continue;
    const vals = [];
    let any = false;
    let prevCol = -1;
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(m[2]))) {
      const attrs = c[1];
      const refM = /\br="([A-Za-z]+)\d*"/.exec(attrs);
      const col = refM ? colIndex(refM[1].toUpperCase()) : prevCol + 1;
      prevCol = col;
      const inner = c[2];
      if (!inner) continue;
      const t = (/\bt="(\w+)"/.exec(attrs) || [])[1] || 'n';
      let v = null;
      if (t === 'inlineStr') {
        const is = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(inner);
        v = is ? collectText(is[1]) : null;
      } else {
        const vm = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
        if (vm) {
          const raw = vm[1];
          if (t === 's') v = ctx.sst[parseInt(raw, 10)] ?? null;
          else if (t === 'str') v = decodeXml(raw, true);
          else if (t === 'b') v = raw.trim() === '1' || raw.trim() === 'true';
          else if (t === 'e') v = null;
          else if (t === 'd') v = decodeXml(raw).replace('T', ' ').replace(/(\.\d+)?Z?$/, '').replace(/ 00:00:00$/, '');
          else {
            const n = Number(raw);
            if (raw.trim() === '' || !Number.isFinite(n)) v = null;
            else {
              const sm = /\bs="(\d+)"/.exec(attrs);
              v = sm && ctx.dateStyles.has(parseInt(sm[1], 10)) ? serialToIso(n, ctx.date1904) : n;
            }
          }
        }
      }
      if (v === null || v === undefined) continue;
      vals[col] = v;
      if (v !== '') any = true;
    }
    if (!any) continue;
    for (let i = 0; i < vals.length; i++) if (vals[i] === undefined) vals[i] = null;
    if (firstRow < 0) firstRow = rowNo;
    const idx = rowNo - firstRow;
    if (idx >= maxRows) { truncated = true; break; }
    rows[idx] = vals;
    lastNonEmpty = Math.max(lastNonEmpty, idx);
  }
  rows.length = lastNonEmpty + 1;
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return { rows, truncated };
}

/**
 * Read an .xlsx workbook.
 * @param {Buffer|Uint8Array} buffer
 * @param {{maxRows?: number}} [opts]
 * @returns {{name: string, rows: any[][], truncated: boolean}[]}
 */
export function readXlsx(buffer, { maxRows = 200000 } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const entries = readZipEntries(buf);
  const read = makePartReader(buf, entries);

  const rootRels = parseRels(read('_rels/.rels'), '');
  let wbPath = 'xl/workbook.xml';
  for (const r of rootRels.values()) if (/\/officeDocument$/.test(r.type)) wbPath = r.target;
  const wbXml = read(wbPath);
  if (!wbXml) throw unsupported('缺少 workbook.xml，可能不是 Excel 工作簿');
  const wbDir = wbPath.includes('/') ? wbPath.slice(0, wbPath.lastIndexOf('/')) : '';
  const relsPath = (wbDir ? wbDir + '/' : '') + '_rels/' + wbPath.slice(wbPath.lastIndexOf('/') + 1) + '.rels';
  const rels = parseRels(read(relsPath), wbDir);

  const wbPr = /<(?:\w+:)?workbookPr\b([^>]*)>/.exec(wbXml);
  const date1904 = wbPr ? /\bdate1904="(1|true)"/.test(wbPr[1]) : false;

  let sstPath = null, stylesPath = null;
  for (const r of rels.values()) {
    if (/\/sharedStrings$/.test(r.type)) sstPath = r.target;
    else if (/\/styles$/.test(r.type)) stylesPath = r.target;
  }
  const sstXml = read(sstPath || (wbDir ? wbDir + '/' : '') + 'sharedStrings.xml');
  const sst = [];
  if (sstXml) {
    const re = /<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g;
    let m;
    while ((m = re.exec(sstXml))) sst.push(m[1] ? collectText(m[1]) : '');
  }

  const dateStyles = new Set();
  const stXml = read(stylesPath || (wbDir ? wbDir + '/' : '') + 'styles.xml');
  if (stXml) {
    const custom = new Map();
    const nf = /<(?:\w+:)?numFmt\b([^>]*)>/g;
    let m;
    while ((m = nf.exec(stXml))) {
      const a = parseAttrs(m[1]);
      custom.set(parseInt(a.numFmtId, 10), a.formatCode || '');
    }
    const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stXml);
    if (xfs) {
      const xre = /<(?:\w+:)?xf\b([^>]*)>/g;
      let i = 0;
      while ((m = xre.exec(xfs[1]))) {
        const id = parseInt(parseAttrs(m[1]).numFmtId || '0', 10);
        if (custom.has(id) ? isDateFormat(custom.get(id)) : BUILTIN_DATE_FMTS.has(id)) dateStyles.add(i);
        i++;
      }
    }
  }

  const ctx = { sst, dateStyles, date1904 };
  const out = [];
  const sheetRe = /<(?:\w+:)?sheet\b([^>]*)>/g;
  let m;
  while ((m = sheetRe.exec(wbXml))) {
    const a = parseAttrs(m[1]);
    const ridKey = Object.keys(a).find((k) => k === 'r:id' || /:id$/.test(k));
    const rel = ridKey ? rels.get(a[ridKey]) : null;
    const name = a.name ?? `Sheet${out.length + 1}`;
    if (!rel || (rel.type && !/\/worksheet$/.test(rel.type))) { out.push({ name, rows: [], truncated: false }); continue; }
    const xml = read(rel.target);
    const res = xml ? parseSheet(xml, ctx, maxRows) : { rows: [], truncated: false };
    out.push({ name, rows: res.rows, truncated: res.truncated });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Decode a CSV buffer, detecting BOMs, UTF-8 and GB18030. */
function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' };
  const body = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('gb18030').decode(body), encoding: 'gb18030' };
    } catch {
      return { text: body.toString('latin1'), encoding: 'latin1' };
    }
  }
}

/** Pick the delimiter with the most consistent per-line count in the sample. */
function sniffDelimiter(text) {
  const sample = text.slice(0, 65536);
  const cands = [',', '\t', ';', '|'];
  const counts = cands.map(() => []);
  let cur = cands.map(() => 0);
  let inQ = false;
  let lines = 0;
  for (let i = 0; i < sample.length && lines < 20; i++) {
    const ch = sample[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (inQ) continue;
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && sample[i + 1] === '\n') i++;
      cands.forEach((_, k) => counts[k].push(cur[k]));
      lines++;
      cur = cands.map(() => 0);
      continue;
    }
    const k = cands.indexOf(ch);
    if (k >= 0) cur[k]++;
  }
  if (lines < 20 && cur.some((x) => x > 0)) cands.forEach((_, k) => counts[k].push(cur[k]));
  let best = ',', bestScore = -1;
  cands.forEach((d, k) => {
    const arr = counts[k];
    if (!arr.length) return;
    const freq = new Map();
    for (const x of arr) if (x > 0) freq.set(x, (freq.get(x) || 0) + 1);
    let mode = 0, f = 0;
    for (const [x, c] of freq) if (c > f || (c === f && x > mode)) { mode = x; f = c; }
    if (!mode) return;
    const score = (f / arr.length) * 1000 + Math.min(mode, 999);
    if (score > bestScore) { bestScore = score; best = d; }
  });
  return best;
}

/**
 * Parse CSV/TSV bytes (RFC 4180, lenient). Values stay strings.
 * @param {Buffer|Uint8Array} input
 * @param {{maxRows?: number}} [opts]
 * @returns {{rows: string[][], delimiter: string, encoding: string, truncated: boolean}}
 */
export function parseCsv(input, { maxRows = 200000 } = {}) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let { text, encoding } = decodeText(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = sniffDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let quotedField = false;
  let truncated = false;
  const n = text.length;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    quotedField = false;
  };
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '' && !quotedField) { inQ = true; quotedField = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; quotedField = false; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      if (rows.length > maxRows) { truncated = true; break; }
      continue;
    }
    field += ch;
  }
  if (!truncated && (field !== '' || row.length || quotedField)) endRow();
  if (rows.length > maxRows) { rows.length = maxRows; truncated = true; }
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop();
  return { rows, delimiter, encoding, truncated };
}

/* ------------------------------------------------------------------ */
/* Header normalization and type inference                             */
/* ------------------------------------------------------------------ */

/**
 * Clean header names: trim, whitespace → `_`, empty → `column_N`, ≤64 chars, unique (case-insensitive).
 * @param {any[]} header
 * @returns {string[]}
 */
export function normalizeHeader(header) {
  const used = new Set();
  return (header || []).map((h, i) => {
    let s = stripIllegal(String(h ?? '')).trim().replace(/\s+/g, '_');
    if (!s) s = `column_${i + 1}`;
    s = Array.from(s).slice(0, 64).join('');
    let name = s;
    for (let k = 2; used.has(name.toLowerCase()); k++) {
      const suf = `_${k}`;
      name = Array.from(s).slice(0, 64 - suf.length).join('') + suf;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

const INT_RE = /^[-+]?(?:0|[1-9]\d{0,14})$/;
const REAL_RE = /^[-+]?(?:(?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d+)?|\.\d+|0\.\d+)(?:[eE][-+]?\d+)?$/;
const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$|^(\d{4})年(\d{1,2})月(\d{1,2})日$/;
const DATETIME_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]+|日\s*)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/;

function validYmd(y, m, d) {
  y = +y; m = +m; d = +d;
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

/** Parse a date string → `YYYY-MM-DD` or null. */
function parseDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
  return validYmd(y, mo, d) ? `${y}-${pad2(+mo)}-${pad2(+d)}` : null;
}

/** Parse a datetime string → `YYYY-MM-DD HH:MM:SS` or null. */
function parseDateTime(s) {
  const m = DATETIME_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  if (!validYmd(y, mo, d) || +h > 23 || +mi > 59 || (se && +se > 59)) return null;
  return `${y}-${pad2(+mo)}-${pad2(+d)} ${pad2(+h)}:${mi}:${se || '00'}`;
}

/** Classify a numeric string; long digit strings (IDs) are not numeric. */
function numericClass(s) {
  if (INT_RE.test(s)) return 'int';
  if (!REAL_RE.test(s)) return null;
  const mant = s.replace(/[eE].*$/, '');
  if (mant.replace(/\D/g, '').length > 15) return null;
  return 'real';
}

/**
 * Infer SQL-ish column types from string/number cell values.
 * @param {any[]} header
 * @param {any[][]} rows
 * @returns {{name: string, type: 'INTEGER'|'REAL'|'TEXT'|'DATE'|'DATETIME', kind: 'number'|'time'|'text'}[]}
 */
export function inferColumns(header, rows) {
  const names = normalizeHeader(header);
  return names.map((name, j) => {
    let seen = 0, allInt = true, allNum = true, allDate = true, allTime = true;
    for (let r = 0; r < rows.length && seen < 2000; r++) {
      const v = rows[r]?.[j];
      if (v == null) continue;
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) { allInt = allNum = allDate = allTime = false; }
        else {
          if (!(Number.isSafeInteger(v) && Math.abs(v) < 1e15)) allInt = false;
          allDate = allTime = false;
        }
        seen++;
      } else {
        const s = typeof v === 'string' ? v.trim() : typeof v === 'bigint' ? v.toString() : null;
        if (s === '') continue;
        seen++;
        if (s === null) { allInt = allNum = allDate = allTime = false; break; }
        const nc = numericClass(s);
        if (nc !== 'int') allInt = false;
        if (!nc) allNum = false;
        const isD = parseDate(s) !== null;
        if (!isD) allDate = false;
        if (!isD && parseDateTime(s) === null) allTime = false;
      }
      if (!allInt && !allNum && !allDate && !allTime) break;
    }
    let type = 'TEXT';
    if (seen === 0) type = 'TEXT';
    else if (allInt) type = 'INTEGER';
    else if (allNum) type = 'REAL';
    else if (allDate) type = 'DATE';
    else if (allTime) type = 'DATETIME';
    const kind = type === 'INTEGER' || type === 'REAL' ? 'number' : type === 'TEXT' ? 'text' : 'time';
    return { name, type, kind };
  });
}

/**
 * Convert a raw cell value to the stored value for a column type.
 * Unparseable values are returned unchanged (as strings).
 * @param {any} value
 * @param {'INTEGER'|'REAL'|'TEXT'|'DATE'|'DATETIME'} type
 * @returns {string|number|null}
 */
export function coerceValue(value, type) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  switch (type) {
    case 'INTEGER':
    case 'REAL': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      const s = String(value).trim();
      if (!numericClass(s)) return s;
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : s;
    }
    case 'DATE': {
      const s = String(value).trim();
      return parseDate(s) ?? parseDateTime(s)?.slice(0, 10) ?? s;
    }
    case 'DATETIME': {
      const s = String(value).trim();
      const dt = parseDateTime(s);
      if (dt) return dt;
      const d = parseDate(s);
      return d ? `${d} 00:00:00` : s;
    }
    default:
      return typeof value === 'string' ? value : toText(value);
  }
}
