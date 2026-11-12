// xlsx.js: XLSX writer/reader, CSV parsing with encoding/delimiter sniffing, column inference.
// Ported from an earlier standalone script Outputs go to a temp dir; fixtures/openpyxl.xlsx and
// fixtures/gb18030.csv are used when python3+openpyxl / iconv are not available.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { test, skip, summary, assert } from '../lib/assert.mjs';
import { plugin, tempDir, FIXTURES } from '../lib/env.mjs';

const { writeXlsx, readXlsx, parseCsv, inferColumns, normalizeHeader, coerceValue } = await plugin('xlsx.js');
const DIR = tempDir('xlsx');
const have = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const UNZIP = have('/usr/bin/unzip', ['-v']) ? '/usr/bin/unzip' : null;
const needUnzip = () => { if (!UNZIP) skip('unzip unavailable'); };
const PY = (() => { for (const p of ['python3', '/usr/bin/python3']) { try { execFileSync(p, ['-c', 'import openpyxl'], { stdio: 'ignore' }); return p; } catch {} } return null; })();

// ---------------------------------------------------------------- writer
const bigRows = Array.from({ length: 5000 }, (_, i) => [i + 1, `名称${i}`, i % 7 === 0 ? null : (i * 1.25), '2024-01-02 03:04:05']);
const sheets = [
  {
    name: '销售/汇总:2024?', title: '销售报表 <&> "测试"', note: '数据来源：订单库',
    columns: [
      { name: '地区', kind: 'text' }, { name: '金额', kind: 'number' }, { name: '订单ID', kind: 'number' },
      { name: '日期', kind: 'time' }, { name: '备注', kind: 'text' }, { name: '数量', kind: 'number' },
    ],
    rows: [
      ['华东', 1234567, '12345678901234567890', '2024-05-01', 'a & b <c>\nline2', '42'],
      ['华北', 12.5, 9007199254740993n, '2024-05-02', null, '007'],
      ['西南', '3.14159', 123, null, 'ctrl\u0001char\u0007', -0.5],
      [null, null, null, null, null, null],
      ['东北', NaN, '1e3', '2024-05-04', ' 前后空格 ', 1e20],
      ['_x0041_', Infinity, 9007199254740992, '', { a: 1 }, '+5'],
    ],
  },
  { name: 'Big', columns: [{ name: 'id', kind: 'number' }, { name: 'name', kind: 'text' }, { name: 'val', kind: 'number' }, { name: 'ts', kind: 'time' }], rows: bigRows },
  { name: 'big', columns: [{ name: 'x', kind: 'text' }], rows: [['dup name']] },
  { name: '', columns: [], rows: [] },
  { name: 'x'.repeat(40), columns: [{ name: 'a', kind: 'number' }], rows: [[1]] },
];
const xbuf = writeXlsx(sheets, { creator: 'DSH 测试' });
const xfile = path.join(DIR, 'out.xlsx');
fs.writeFileSync(xfile, xbuf);

await test('round-trip: sheet names sanitized and unique', () => {
  const book = readXlsx(xbuf);
  assert.deepEqual(book.map((s) => s.name), ['销售_汇总_2024_', 'Big', 'big (2)', 'Sheet4', 'x'.repeat(31)]);
});

await test('round-trip: title/note/header/values', () => {
  const [s1] = readXlsx(xbuf);
  const r = s1.rows;
  assert.equal(r[0][0], '销售报表 <&> "测试"');
  assert.equal(r[1][0], '数据来源：订单库');
  assert.deepEqual(r[2], []); // blank row between note and header
  assert.deepEqual(r[3], ['地区', '金额', '订单ID', '日期', '备注', '数量']);
  assert.deepEqual(r[4], ['华东', 1234567, '12345678901234567890', '2024-05-01', 'a & b <c>\nline2', 42]);
  assert.deepEqual(r[5], ['华北', 12.5, '9007199254740993', '2024-05-02', null, '007']);
  assert.deepEqual(r[6], ['西南', 3.14159, 123, null, 'ctrlchar', -0.5]);
  assert.deepEqual(r[7], []); // all-null row kept as empty (between data rows)
  assert.deepEqual(r[8], ['东北', 'NaN', 1000, '2024-05-04', ' 前后空格 ', '100000000000000000000']);
  assert.deepEqual(r[9], ['_x0041_', 'Infinity', '9007199254740992', null, '{"a":1}', 5]);
  assert.equal(r.length, 10);
});

await test('round-trip: 5000-row sheet', () => {
  const big = readXlsx(xbuf)[1];
  assert.equal(big.rows.length, 5001);
  assert.deepEqual(big.rows[0], ['id', 'name', 'val', 'ts']);
  for (let i = 0; i < 5000; i++) {
    const exp = bigRows[i].slice();
    if (exp[2] === null) exp[2] = null;
    assert.deepEqual(big.rows[i + 1], exp, `row ${i}`);
  }
});

await test('readXlsx maxRows truncates', () => {
  const big = readXlsx(xbuf, { maxRows: 100 })[1];
  assert.equal(big.rows.length, 100);
  assert.equal(big.truncated, true);
});

await test('sheet XML: freeze pane, autofilter, styles, number formats', () => {
  needUnzip();
  const x = execFileSync(UNZIP, ['-p', xfile, 'xl/worksheets/sheet1.xml']).toString();
  assert.match(x, /<pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(x, /<autoFilter ref="A4:F10"\/>/);
  assert.match(x, /<c r="B5" s="4"><v>1234567<\/v><\/c>/);
  assert.match(x, /<c r="B6" s="5"><v>12.5<\/v><\/c>/);
  assert.match(x, /<col min="1" max="1" width="\d+"/);
  const widths = [...x.matchAll(/width="(\d+)"/g)].map((m) => +m[1]);
  assert.ok(widths.every((w) => w >= 8 && w <= 60));
  const st = execFileSync(UNZIP, ['-p', xfile, 'xl/styles.xml']).toString();
  assert.match(st, /formatCode="#,##0"/);
  assert.match(st, /formatCode="#,##0.00"/);
  const x2 = execFileSync(UNZIP, ['-p', xfile, 'xl/worksheets/sheet2.xml']).toString();
  assert.match(x2, /<pane ySplit="1" topLeftCell="A2"/);
});

await test('zip valid: unzip -t', () => {
  needUnzip();
  const out = execFileSync(UNZIP, ['-t', xfile]).toString();
  assert.match(out, /No errors detected/);
});

await test('every XML part is well-formed (python minidom)', () => {
  needUnzip(); if (!have('python3', ['-c', 'import xml.dom.minidom'])) skip('python3 unavailable');
  const ex = path.join(DIR, 'extract');
  fs.rmSync(ex, { recursive: true, force: true });
  execFileSync(UNZIP, ['-q', '-o', xfile, '-d', ex]);
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(ex);
  for (const need of ['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']) {
    assert.ok(files.includes(path.join(ex, need)), need);
  }
  for (const f of files) execFileSync('python3', ['-c', 'import xml.dom.minidom,sys; xml.dom.minidom.parse(sys.argv[1])', f]);
  assert.equal(files.length, 13);
});

await test('openpyxl loads our file', () => {
  if (!PY) skip('openpyxl unavailable');
  const out = execFileSync(PY, ['-c', `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1])
s = wb.worksheets[0]
print(json.dumps({"names": wb.sheetnames, "a1": s["A1"].value, "b5": s["B5"].value, "b5fmt": s["B5"].number_format,
  "c5": s["C5"].value, "freeze": s.freeze_panes, "filter": s.auto_filter.ref, "bold": s["A4"].font.b,
  "rows2": wb.worksheets[1].max_row, "d5001": wb.worksheets[1]["B5001"].value}, ensure_ascii=False))
`, xfile]).toString();
  const j = JSON.parse(out);
  assert.deepEqual(j.names, ['销售_汇总_2024_', 'Big', 'big (2)', 'Sheet4', 'x'.repeat(31)]);
  assert.equal(j.a1, '销售报表 <&> "测试"');
  assert.equal(j.b5, 1234567);
  assert.equal(j.b5fmt, '#,##0');
  assert.equal(j.c5, '12345678901234567890');
  assert.equal(j.freeze, 'A5');
  assert.equal(j.filter, 'A4:F10');
  assert.equal(j.bold, true);
  assert.equal(j.rows2, 5001);
  assert.equal(j.d5001, '名称4999');
});

await test('readXlsx on openpyxl-produced file (dates, shared strings, sparse, 1900)', () => {
  let f = path.join(DIR, 'openpyxl.xlsx');
  if (!PY) f = path.join(FIXTURES, 'openpyxl.xlsx');
  else execFileSync(PY, ['-c', `
import openpyxl, datetime, sys
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
wb = openpyxl.Workbook()
ws = wb.active; ws.title = "数据 A&B"
ws.append(["名称", "日期", "时间戳", "数", "布尔", "公式"])
ws.append(["苹果", datetime.date(2024, 3, 15), datetime.datetime(2024, 3, 15, 13, 45, 30), 3.5, True, "=1/0"])
ws["A3"] = CellRichText(["富", TextBlock(InlineFont(b=True), "文本")])
ws["D3"] = 7
c = ws["E3"]; c.value = 45000; c.number_format = 'yyyy"年"m"月"d"日"'
ws["F3"] = 45000; ws["F3"].number_format = '[Red]0.00'
ws["C6"] = "稀疏 &amp; <x>"
ws2 = wb.create_sheet("Empty")
wb.save(sys.argv[1])
`, f]);
  const book = readXlsx(fs.readFileSync(f));
  assert.deepEqual(book.map((s) => s.name), ['数据 A&B', 'Empty']);
  const r = book[0].rows;
  assert.deepEqual(r[0], ['名称', '日期', '时间戳', '数', '布尔', '公式']);
  assert.equal(r[1][0], '苹果');
  assert.equal(r[1][1], '2024-03-15');
  assert.equal(r[1][2], '2024-03-15 13:45:30');
  assert.equal(r[1][3], 3.5);
  assert.equal(r[1][4], true);
  assert.equal(r[2][0], '富文本');
  assert.equal(r[2][3], 7);
  assert.equal(r[2][4], '2023-03-15');
  assert.equal(r[2][5], 45000);
  assert.deepEqual(r[3], []);
  assert.deepEqual(r[4], []);
  assert.deepEqual(r[5], [null, null, '稀疏 &amp; <x>']);
  assert.equal(r.length, 6);
  assert.deepEqual(book[1].rows, []);
});

await test('readXlsx: 1904 date system + inlineStr + t=str + t=e + stored entries', () => {
  // hand-build a minimal workbook with stored (method 0) entries
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="S&amp;1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/s.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="200" formatCode="&quot;d&quot;0"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="22"/><xf numFmtId="200"/></cellXfs></styleSheet>',
    'xl/worksheets/s.xml': '<worksheet><sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>&#x4E2D;&#25991;&lt;</t></is></c><c r="C2" t="str"><f>A1</f><v>calc</v></c><c r="D2" t="e"><v>#DIV/0!</v></c><c r="E2" s="1"><v>0.5</v></c><c r="F2" s="2"><v>12</v></c></row><row r="3"/><row r="4"><c r="A4"><v>1</v></c></row><row r="9"><c r="A9" t="inlineStr"><is><t></t></is></c></row></sheetData></worksheet>',
  };
  const parts = [], cds = [];
  let off = 0;
  for (const [name, txt] of Object.entries(files)) {
    const n = Buffer.from(name), d = Buffer.from(txt), crc = zlib.crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(10, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(d.length, 20); cd.writeUInt32LE(d.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(off, 42);
    parts.push(lh, n, d); cds.push(cd, n); off += 30 + n.length + d.length;
  }
  const cdb = Buffer.concat(cds), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(5, 8); e.writeUInt16LE(5, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
  const book = readXlsx(Buffer.concat([...parts, cdb, e]));
  assert.equal(book[0].name, 'S&1');
  assert.deepEqual(book[0].rows, [[null, '中文<', 'calc', null, '1904-01-01 12:00:00', 12], [], [1]]);
});

await test('readXlsx: .xls / junk / encrypted errors', () => {
  const xls = Buffer.alloc(512); Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(xls);
  assert.throws(() => readXlsx(xls), { message: '暂不支持旧版 .xls，请另存为 .xlsx 或 CSV' });
  const enc = Buffer.concat([xls, Buffer.from('EncryptionInfo', 'utf16le')]);
  assert.throws(() => readXlsx(enc), /不支持的 Excel 文件：.*加密/);
  assert.throws(() => readXlsx(Buffer.from('hello world, this is not a zip file')), /不支持的 Excel 文件/);
  // flag bit 0 (encrypted entry) in a real zip
  const b = Buffer.from(xbuf);
  let p = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  p = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (p >= 0) { b.writeUInt16LE(b.readUInt16LE(p + 8) | 1, p + 8); p = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), p + 4); }
  assert.throws(() => readXlsx(b), /不支持的 Excel 文件：.*加密/);
});

await test('writeXlsx: no sheets / weird input still valid', () => {
  const b = writeXlsx([]);
  const f = path.join(DIR, 'empty.xlsx'); fs.writeFileSync(f, b);
  if (UNZIP) assert.match(execFileSync(UNZIP, ['-t', f]).toString(), /No errors/);
  assert.deepEqual(readXlsx(b), [{ name: 'Sheet1', rows: [], truncated: false }]);
});

// ---------------------------------------------------------------- CSV
await test('parseCsv: quotes, escaped quotes, newlines, CRLF, BOM', () => {
  const s = '\uFEFFa,b,c\r\n1,"he said ""hi""","multi\nline"\r\n2,,"x,y"\r\n\r\n\r\n';
  const r = parseCsv(Buffer.from(s));
  assert.equal(r.delimiter, ',');
  assert.equal(r.encoding, 'utf-8');
  assert.deepEqual(r.rows, [['a', 'b', 'c'], ['1', 'he said "hi"', 'multi\nline'], ['2', '', 'x,y']]);
});

await test('parseCsv: CR-only line endings and no trailing newline', () => {
  assert.deepEqual(parseCsv(Buffer.from('a,b\r1,2\r3,4')).rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

await test('parseCsv: semicolon / tab / pipe sniffing', () => {
  const semi = parseCsv(Buffer.from('name;amount;note\nA;1,5;"x;y"\nB;2,0;z\n'));
  assert.equal(semi.delimiter, ';');
  assert.deepEqual(semi.rows[1], ['A', '1,5', 'x;y']);
  const tab = parseCsv(Buffer.from('a\tb\tc\n1,000\t2\t"q\tq"\n'));
  assert.equal(tab.delimiter, '\t');
  assert.deepEqual(tab.rows[1], ['1,000', '2', 'q\tq']);
  const pipe = parseCsv(Buffer.from('a|b\n1|2\n3|4\n'));
  assert.equal(pipe.delimiter, '|');
  assert.deepEqual(parseCsv(Buffer.from('single\nvalue\n')).rows, [['single'], ['value']]);
});

await test('parseCsv: GB18030 (via iconv) and UTF-16 LE/BE', () => {
  const src = path.join(DIR, 'gbk-src.csv'), dst = path.join(DIR, 'gbk.csv');
  fs.writeFileSync(src, '姓名,城市,金额\n张三,北京,"1,234"\n李四,上海,56\n');
  let buf;
  try { execSync(`iconv -f UTF-8 -t GB18030 "${src}" > "${dst}"`, { stdio: 'ignore' }); buf = fs.readFileSync(dst); }
  catch { buf = fs.readFileSync(path.join(FIXTURES, 'gb18030.csv')); }
  const r = parseCsv(buf);
  assert.equal(r.encoding, 'gb18030');
  assert.deepEqual(r.rows, [['姓名', '城市', '金额'], ['张三', '北京', '1,234'], ['李四', '上海', '56']]);
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('列1\t列2\n甲\t乙\n', 'utf16le')]);
  const rl = parseCsv(le);
  assert.equal(rl.encoding, 'utf-16le');
  assert.deepEqual(rl.rows, [['列1', '列2'], ['甲', '乙']]);
  const beBody = Buffer.from('x,y\n1,2\n', 'utf16le').swap16();
  const rb = parseCsv(Buffer.concat([Buffer.from([0xfe, 0xff]), beBody]));
  assert.equal(rb.encoding, 'utf-16be');
  assert.deepEqual(rb.rows, [['x', 'y'], ['1', '2']]);
});

await test('parseCsv: maxRows', () => {
  const s = 'a\n' + Array.from({ length: 50 }, (_, i) => i).join('\n');
  const r = parseCsv(Buffer.from(s), { maxRows: 10 });
  assert.equal(r.rows.length, 10);
  assert.equal(r.truncated, true);
});

// ---------------------------------------------------------------- inference
await test('normalizeHeader', () => {
  assert.deepEqual(normalizeHeader([' 名称 ', '', 'Name', 'name', 'a  b\tc', null, 'NAME', 'x'.repeat(80)]),
    ['名称', 'column_2', 'Name', 'name_2', 'a_b_c', 'column_6', 'NAME_3', 'x'.repeat(64)]);
  assert.deepEqual(normalizeHeader(['a', 'a', 'a_2']), ['a', 'a_2', 'a_2_2']);
});

await test('inferColumns', () => {
  const header = ['int', 'real', 'code', 'pct', 'date', 'dt', 'mixed', 'empty', 'bigid', 'nums', 'mixdate'];
  const rows = [
    ['1', '1,234.5', '007', '12.5%', '2024-01-02', '2024-01-02 03:04:05', 'a', '', '1234567890123456', 3, '2024-01-02'],
    ['-20', '3', '0', '1%', '2024/1/2', '2024/1/2 3:04', '1', null, '1', 4.5, '2024-01-02T10:00:00'],
    ['', '', '12', '', '', '', '', '', '', null, ''],
    ['+0', '-.5', '1', '', '2024-12-31', '2024-01-02T03:04:05Z', '2', '  ', '2', 1, ''],
  ];
  const cols = inferColumns(header, rows);
  assert.deepEqual(cols.map((c) => c.type), ['INTEGER', 'REAL', 'TEXT', 'TEXT', 'DATE', 'DATETIME', 'TEXT', 'TEXT', 'TEXT', 'REAL', 'DATETIME']);
  assert.deepEqual(cols.map((c) => c.kind), ['number', 'number', 'text', 'text', 'time', 'time', 'text', 'text', 'text', 'number', 'time']);
  assert.equal(inferColumns(['d'], [['2024-02-30']])[0].type, 'TEXT');
  assert.equal(inferColumns(['n'], [['1e5'], ['2']])[0].type, 'REAL');
  assert.equal(inferColumns(['n'], [['1,23']])[0].type, 'TEXT');
  assert.equal(inferColumns([''], [])[0].name, 'column_1');
});

await test('coerceValue', () => {
  assert.equal(coerceValue('', 'INTEGER'), null);
  assert.equal(coerceValue('  ', 'TEXT'), null);
  assert.equal(coerceValue(undefined, 'TEXT'), null);
  assert.equal(coerceValue('1,234', 'INTEGER'), 1234);
  assert.equal(coerceValue('1,234.50', 'REAL'), 1234.5);
  assert.equal(coerceValue('+7', 'INTEGER'), 7);
  assert.equal(coerceValue(3.5, 'REAL'), 3.5);
  assert.equal(coerceValue('abc', 'REAL'), 'abc');
  assert.equal(coerceValue('2024/1/2', 'DATE'), '2024-01-02');
  assert.equal(coerceValue('2024年3月5日', 'DATE'), '2024-03-05');
  assert.equal(coerceValue('2024/1/2 3:04', 'DATETIME'), '2024-01-02 03:04:00');
  assert.equal(coerceValue('2024-01-02T03:04:05.123Z', 'DATETIME'), '2024-01-02 03:04:05');
  assert.equal(coerceValue('2024-01-02', 'DATETIME'), '2024-01-02 00:00:00');
  assert.equal(coerceValue(' 007 ', 'TEXT'), ' 007 ');
  assert.equal(coerceValue(12, 'TEXT'), '12');
});

test('sheet names: at most 31 UTF-16 units, surrogate pairs never split', () => {
  const cols = [{ name: 'a', kind: 'text' }];
  const names = ['😀'.repeat(31), 'a' + '😀'.repeat(20), '😀'.repeat(31), 'X'.repeat(40)];
  const out = readXlsx(writeXlsx(names.map(name => ({ name, columns: cols, rows: [['1']] })))).map(s => s.name);
  for (const n of out) {
    assert.ok(n.length <= 31, `${n} has ${n.length} UTF-16 units`);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(n), `lone surrogate in ${n}`);
  }
  assert.equal(out[0], '😀'.repeat(15));
  assert.equal(out[1], 'a' + '😀'.repeat(15));
  assert.equal(out[2], '😀'.repeat(13) + ' (2)');
  assert.equal(new Set(out.map(n => n.toLowerCase())).size, out.length);
});

summary('xlsx');
