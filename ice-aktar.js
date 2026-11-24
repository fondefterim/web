// Excel (.xlsx), CSV ve PDF ekstre okuma: hesaplama sayfası (hesapla.js) ile web defterinin (defter/) ortak kodu.
// Kurallar iPhone uygulamasındakilerle aynı (FonKit: XLSXReader, GenericImporter, ExcelImporter).
// Dosyalar yalnızca bu tarayıcıda okunur; hiçbir yere gönderilmez.
window.FonIceAktar = (function () {
  'use strict';
  const MAX_FILE = 15 * 1024 * 1024;     // yüklenecek dosya
  const MAX_PART = 60 * 1024 * 1024;     // açılmış tek bir parça (sıkıştırma bombasına karşı)
  const MAX_ROWS = 20000;

  // ---------- Metin ve sayı yardımcıları ----------
  // GenericImporter.normalize: küçük harf (Türkçe), ı→i, aksanlar atılır.
  const norm = s => String(s == null ? '' : s).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  // Serbest sayı okuyucu (hesaplama sayfası ve PDF ekstreleri).
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).replace(/\s|TL|₺/gi, '');
    if (!s) return null;
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    s = s.replace(/[()\-+]/g, '');
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc >= 0) s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  // XLSXWorkbook.parseNumber (uygulamadaki hücre okuma kuralı).
  function parseNumber(raw) {
    let s = String(raw == null ? '' : raw).trim();
    for (const junk of ['TL', 'TRY', '₺', ' ', ' ', '+']) s = s.split(junk).join('');
    let negative = false;
    if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
    if (!s) return null;
    const hasComma = s.includes(','), hasDot = s.includes('.');
    if (hasComma && hasDot) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(/,/g, '.') : s.replace(/,/g, '');
    else if (hasComma) s = s.replace(/,/g, '.');
    else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^[-]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
    const v = parseFloat(s);
    return isFinite(v) ? (negative ? -v : v) : null;
  }
  // Hücre: sayı ya da metin. Cell.stringValue / Cell.numericValue
  const cellString = v => v == null ? null : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v).trim();
  const cellNumber = v => v == null ? null : typeof v === 'number' ? v : (String(v).trim() ? parseNumber(String(v).trim()) : null);

  // Excel seri numarası → "yyyy-mm-dd" (FonDate.fromExcelSerial: aşağı yuvarlanır).
  function serialDay(n) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const pad = n => String(n).padStart(2, '0');
  const AYLAR = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
  function validDay(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  // ExcelImporter.parseDate → "yyyy-mm-dd" ya da null
  function cellDay(v) {
    if (typeof v === 'number') return v > 20000 && v < 80000 ? serialDay(v) : null;
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
    if (m) return validDay(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
    if (m) return validDay(+m[1], +m[2], +m[3]);
    m = norm(s).match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
    if (m && AYLAR.includes(m[2])) return validDay(+m[3], AYLAR.indexOf(m[2]) + 1, +m[1]);
    return null;
  }
  // Tarihi yyyymmdd sayısına çevirir (hesaplama sayfası karşılaştırmaları için).
  // Hesaplama sayfası için daha hoşgörülü: tarihten sonra gelen saat ya da gün adı yok sayılır.
  function dateKey(v) {
    if (typeof v === 'number') { const d = v > 20000 && v < 80000 ? serialDay(v) : null; return d ? +d.replace(/-/g, '') : null; }
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
    const d = cellDay(s);
    return d ? +d.replace(/-/g, '') : null;
  }
  const showDate = k => k ? `${String(k % 100).padStart(2, '0')}.${String(Math.floor(k / 100) % 100).padStart(2, '0')}.${Math.floor(k / 10000)}` : '';
  const keyDay = k => k ? `${Math.floor(k / 10000)}-${pad(Math.floor(k / 100) % 100)}-${pad(k % 100)}` : null;

  // ExcelImporter.parseSide → 'buy' | 'sell' | null
  function side(v) {
    const s = norm(v).toUpperCase();
    if (!s) return null;
    if (s === 'A' || s === 'B' || s.includes('BUY') || s.includes('SATIN AL')) return 'buy';
    if (s === 'S' || s.includes('SELL') || s.includes('SAT') || s.includes('IADE') || s.includes('GERI ALIM')) return 'sell';
    if (s.includes('AL') || s.includes('GIRIS')) return 'buy';
    return null;
  }

  // Hesaplama sayfasının fon kodu okuyucusu (listesiz).
  function fundCode(v) {
    const up = String(v == null ? '' : v).toLocaleUpperCase('tr-TR').trim();
    if (!up) return null;
    if (/^[A-Z0-9]{2,5}$/.test(up)) return up;
    const tokens = up.split(/[^A-Z0-9ÇĞİÖŞÜ]+/).filter(Boolean);
    return tokens.find(t => /^[A-Z0-9]{3}$/.test(t)) || null;
  }
  // GenericImporter.resolveFundCode: "TLY", "TLY - Tera Portföy…", "Tera Portföy (TLY)" → "TLY"
  function resolveFundCode(raw, catalog) {
    const up = String(raw == null ? '' : raw).toLocaleUpperCase('tr-TR').trim();
    if (!up) return null;
    if (catalog.has(up)) return up;
    const tokens = up.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const hit = tokens.find(t => catalog.has(t));
    if (hit) return hit;
    if ([...up].length <= 4 && /^[\p{L}\p{N}]+$/u.test(up)) return up;
    if (tokens.length > 1 && [...tokens[0]].length === 3) return tokens[0];
    return null;
  }

  // ---------- ZIP (xlsx) okuma ----------
  async function inflate(bytes) {
    if (!('DecompressionStream' in window)) throw new Error('Bu tarayıcı Excel dosyasını açamıyor. Güncel bir tarayıcı dene ya da dosyayı CSV olarak kaydet.');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PART) { reader.cancel(); throw new Error('Dosyanın içi beklenenden çok büyük; açılmadı.'); }
      parts.push(value);
    }
    const all = new Uint8Array(total); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    return new TextDecoder().decode(all);
  }

  async function unzip(buf, wanted) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Bu bir Excel (.xlsx) dosyası gibi görünmüyor.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let k = 0; k < count; k++) {
      if (p + 46 > buf.byteLength || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Excel dosyası okunamadı.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (!wanted(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = u8.subarray(start, start + csize);
      if (method === 0) out[name] = dec.decode(data);
      else if (method === 8) out[name] = await inflate(data);
    }
    return out;
  }

  const xml = s => new DOMParser().parseFromString(s || '<x/>', 'application/xml');
  const colIndex = ref => { let n = 0; for (const ch of String(ref).replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  // Sayfalar: [{ name, rows: [[değer]], formulas: Set("satır,sütun") }]
  async function readXLSX(buf) {
    const files = await unzip(buf, n => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
    const wb = xml(files['xl/workbook.xml']);
    const rels = {};
    for (const r of xml(files['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
    const strings = [];
    if (files['xl/sharedStrings.xml']) {
      for (const si of xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')) {
        strings.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
      }
    }
    const sheets = [];
    for (const s of wb.getElementsByTagName('sheet')) {
      const rid = s.getAttribute('r:id') || [...s.attributes].find(a => a.localName === 'id')?.value;
      const target = String(rels[rid] || '').replace(/^\//, '').replace(/^xl\//, '');
      const doc = files['xl/' + target];
      if (!doc) continue;
      sheets.push(Object.assign({ name: s.getAttribute('name') || 'Sayfa' }, sheetRows(xml(doc), strings)));
    }
    return sheets;
  }

  function sheetRows(doc, strings) {
    const rows = [], formulas = new Set();
    let n = 0;
    for (const r of doc.getElementsByTagName('row')) {
      if (++n > MAX_ROWS) break;
      const ri = (parseInt(r.getAttribute('r'), 10) || n) - 1;
      const row = [];
      for (const c of r.getElementsByTagName('c')) {
        const ci = colIndex(c.getAttribute('r') || '');
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = null;
        if (t === 's') val = v ? (strings[parseInt(v.textContent, 10)] ?? '') : '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (t === 'str' || t === 'e') val = v ? v.textContent : '';
        else if (v) { const x = parseFloat(v.textContent); val = isFinite(x) ? x : v.textContent; }
        if (ci >= 0 && ci < 200) {
          row[ci] = val;
          if (c.getElementsByTagName('f').length) formulas.add(ri + ',' + ci);
        }
      }
      rows[ri] = row;
    }
    return { rows: Array.from(rows, r => r || []), formulas };
  }

  function readCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const first = text.split(/\r?\n/, 1)[0];
    const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field.trim()); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field.trim()); field = '';
        if (row.some(x => x !== '')) rows.push(row);
        row = [];
        if (rows.length > MAX_ROWS) break;
      } else field += c;
    }
    row.push(field.trim());
    if (row.some(x => x !== '')) rows.push(row);
    return [{ name: 'CSV', rows: rows.map(r => r.map(x => x === '' ? null : x)), formulas: new Set() }];
  }

  // Dosya türünü bulur: { kind: 'pdf' } ya da { kind: 'sheets', sheets }.
  async function readFile(file) {
    if (file.size > MAX_FILE) throw new Error('Dosya çok büyük (en fazla 15 MB).');
    const buf = await file.arrayBuffer();
    const isZip = buf.byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50;
    if (/\.xls$/i.test(file.name) && !isZip) throw new Error('Eski Excel biçimi (.xls) okunamıyor. Dosyayı Excel\'de "Farklı Kaydet → .xlsx" ya da CSV olarak kaydet.');
    const isPDF = buf.byteLength > 4 && new TextDecoder().decode(new Uint8Array(buf, 0, 5)) === '%PDF-';
    if (isPDF || /\.pdf$/i.test(file.name)) return { kind: 'pdf', buf };
    const sheets = (isZip ? await readXLSX(buf) : readCSV(new TextDecoder().decode(buf))).filter(s => s.rows.length);
    if (!sheets.length) throw new Error('Dosyada okunabilir bir tablo bulunamadı.');
    return { kind: 'sheets', sheets };
  }

  // ---------- Sütun tahmini (GenericImporter) ----------
  const FIELDS = {
    trades: ['date', 'code', 'side', 'units', 'price', 'amount', 'broker', 'note'],
    payments: ['date', 'code', 'amount', 'kind', 'broker', 'note'],
  };
  const LABELS = { date: 'Tarih', code: 'Fon kodu', side: 'İşlem (Alış/Satış)', units: 'Adet', price: 'Birim fiyat', amount: 'Tutar', kind: 'Ödeme türü', note: 'Not / açıklama', broker: 'Aracı kurum' };
  const KEYS = {
    date: ['tarih', 'islem tarihi', 'valor', 'date'],
    code: ['fon kodu', 'kod', 'fon', 'menkul', 'enstruman', 'kiymet', 'varlik', 'urun', 'fund'],
    side: ['islem', 'islem turu', 'islem tipi', 'islem yonu', 'yon', 'alis/satis', 'alis satis', 'hareket', 'tur', 'tip', 'side', 'type'],
    units: ['adet', 'miktar', 'pay adedi', 'pay', 'nominal', 'units', 'quantity'],
    price: ['birim fiyat', 'fiyat', 'price'],
    amount: ['tutar', 'islem tutari', 'net tutar', 'toplam', 'brut tutar', 'amount'],
    kind: ['odeme turu', 'tur', 'aciklama turu'],
    note: ['not', 'aciklama', 'dekont', 'note'],
    broker: ['araci kurum', 'araci', 'kurum', 'broker'],
  };
  const cellAt = (rows, r, c) => c == null || r < 0 || r >= rows.length ? null : (rows[r] || [])[c] ?? null;
  const colCount = rows => rows.reduce((m, r) => Math.max(m, (r || []).length), 0);

  // GenericImporter.detectHeaderRow
  function headerRow(rows) {
    let best = { r: 0, s: 0 };
    for (let r = 0; r < Math.min(30, rows.length); r++) {
      const texts = (rows[r] || []).filter(c => typeof c === 'string').map(norm);
      const s = texts.filter(t => Object.values(KEYS).some(ks => ks.some(k => t.includes(k)))).length;
      if (s > best.s) best = { r, s };
    }
    if (best.s === 0) { const i = rows.findIndex(r => (r || []).some(c => c != null)); return i < 0 ? 0 : i; }
    return best.r;
  }

  function colValues(rows, col, h) {
    const out = [];
    for (let r = h + 1; r < rows.length; r++) { const s = (cellString(cellAt(rows, r, col)) || '').trim(); if (s) out.push(s); }
    return out;
  }
  function sideRatio(rows, col, h) {
    const vals = colValues(rows, col, h);
    if (!vals.length) return 0;
    return vals.filter(v => parseNumber(v) == null && side(v) != null).length / vals.length;
  }

  // GenericImporter.guessMapping → { date: 0, code: 1, … }
  function guess(rows, h, kind = 'trades') {
    const n = colCount(rows);
    const heads = Array.from({ length: n }, (_, c) => norm(cellString(cellAt(rows, h, c)) || ''));
    const used = new Set(), m = {};
    const score = (hd, k) => hd === k ? 3 : hd.startsWith(k) ? 2 : hd.includes(k) ? 1 : 0;
    for (const f of ['date', 'price', 'amount', 'units', 'broker', 'code', 'kind', 'side', 'note']) {
      if (!FIELDS[kind].includes(f)) continue;
      let best = null;
      heads.forEach((hd, col) => {
        if (used.has(col) || !hd) return;
        const s = Math.max(0, ...KEYS[f].map(k => { const sc = score(hd, k); return sc > 0 ? sc * 100 + k.length : 0; }));
        if (s > 0 && s > (best ? best.s : 0)) best = { col, s };
      });
      if (best) { m[f] = best.col; used.add(best.col); }
    }
    if (kind === 'trades') {
      if (m.side != null && sideRatio(rows, m.side, h) < 0.8) { used.delete(m.side); delete m.side; }
      if (m.side == null) {
        for (let c = 0; c < n; c++) {
          if (used.has(c)) continue;
          const vals = colValues(rows, c, h).map(norm);
          if (new Set(vals).size <= 6 && vals.every(v => v.length <= 15) && sideRatio(rows, c, h) >= 0.95) { m.side = c; used.add(c); break; }
        }
      }
    }
    return m;
  }

  // ColumnMapping.missing
  function missing(m, kind) {
    const out = [];
    if (m.date == null) out.push('date');
    if (m.code == null) out.push('code');
    if (kind === 'trades') {
      const count = ['units', 'price', 'amount'].filter(f => m[f] != null).length;
      if (m.amount == null && count < 2) ['units', 'price', 'amount'].filter(f => m[f] == null).forEach(f => out.push(f));
    } else if (m.amount == null) out.push('amount');
    return out;
  }

  // Genel portföy şablonları (hisse, kripto, döviz de içerir): varlık türü ve para birimi sütunu.
  function filterCols(rows, h, map) {
    const used = new Set(Object.values(map));
    const heads = Array.from({ length: colCount(rows) }, (_, c) => norm(String(cellString(cellAt(rows, h, c)) || '').replace(/_/g, ' ')));
    const find = keys => { const i = heads.findIndex((t, col) => !used.has(col) && keys.some(k => t === k || t.startsWith(k))); return i < 0 ? null : i; };
    return {
      asset: find(['varlik tipi', 'varlik turu', 'varlik sinifi', 'urun tipi', 'urun turu', 'enstruman tipi', 'enstruman turu', 'menkul tipi', 'menkul turu', 'kiymet turu', 'asset type', 'asset class']),
      cur: find(['para birimi', 'doviz cinsi', 'doviz', 'pb', 'currency']),
    };
  }
  const isFundType = v => { const n = norm(v); return !n || n.includes('fon') || n.includes('fund'); };
  const isTL = v => { const n = norm(v).replace(/\s/g, ''); return !n || ['tl', 'try', '₺', 'turklirasi', 'trl'].includes(n); };

  // GenericImporter.parse → { trades, payments, skipped: [[satır, neden]], unknownCodes }
  // Kayıtlar uygulamanın biçimindedir; tarih "yyyy-mm-dd" (day) olarak döner.
  function parseRecords(rows, h, m, kind, catalogCodes) {
    const r = { trades: [], payments: [], skipped: [], unknownCodes: new Set() };
    const fc = filterCols(rows, h, m);
    const str = (row, c) => cellString(cellAt(rows, row, c));
    const nm = (row, c) => cellNumber(cellAt(rows, row, c));
    for (let row = h + 1; row < rows.length; row++) {
      const excelRow = row + 1;
      const rawCode = str(row, m.code) || '';
      const dateCell = cellAt(rows, row, m.date);
      if (!rawCode && (dateCell == null || dateCell === '')) continue;
      if (fc.asset != null) { const v = str(row, fc.asset); if (v != null && !isFundType(v)) { r.skipped.push([excelRow, `fon değil (${v.trim()})`]); continue; } }
      if (fc.cur != null) { const v = str(row, fc.cur); if (v != null && !isTL(v)) { r.skipped.push([excelRow, `TL dışı (${v.trim()})`]); continue; } }
      const day = cellDay(dateCell);
      if (!day) { r.skipped.push([excelRow, 'tarih okunamadı']); continue; }
      const code = resolveFundCode(rawCode, catalogCodes);
      if (!code) { r.skipped.push([excelRow, 'fon kodu bulunamadı']); continue; }
      if (!catalogCodes.has(code)) r.unknownCodes.add(code);
      const note = str(row, m.note), broker = str(row, m.broker);
      if (kind === 'trades') {
        let units = nm(row, m.units), price = nm(row, m.price);
        const amount = nm(row, m.amount);
        let s = side(str(row, m.side));
        if (s == null && m.side == null) s = ((units ?? amount ?? 0) < 0) ? 'sell' : 'buy';
        if (!s) { r.skipped.push([excelRow, 'Alış/Satış anlaşılamadı']); continue; }
        units = units == null ? null : Math.abs(units);
        price = price == null ? null : Math.abs(price);
        const amt = amount == null ? null : Math.abs(amount);
        if (price == null && units != null && amt != null && units > 0) price = amt / units;
        if (units == null && price != null && amt != null && price > 0) units = amt / price;
        if (units != null && price != null && units > 0 && price > 0) r.trades.push({ day, code, side: s, units, price, note, broker });
        else if (units == null && price == null && amt != null && amt > 0) r.trades.push({ day, code, side: s, amount: amt, note, broker });
        else { r.skipped.push([excelRow, 'adet ya da fiyat okunamadı']); continue; }
      } else {
        const a = nm(row, m.amount);
        if (a == null || a === 0) { r.skipped.push([excelRow, 'tutar okunamadı']); continue; }
        r.payments.push({ day, code, kind: str(row, m.kind), amount: Math.abs(a), note, broker });
      }
    }
    return r;
  }

  // ---------- Fon Mağduru Hesap Defteri (v1.x) Excel'i (ExcelImporter) ----------
  // Sonuç null ise dosya bu biçimde değil.
  function v13(sheets, catalogCodes, defaults) {
    const byName = n => sheets.find(s => s.name === n);
    const t = byName('İşlemler'), p = byName('Ödemeler');
    if (!t || !p) return null;
    const r = { trades: [], payments: [], overrides: {}, customFunds: [], parameters: null, skippedSampleRows: 0, warnings: [] };
    const isSample = note => note != null && note.toLocaleUpperCase('tr-TR').includes('ÖRNEK');
    const C = (sheet, col, row) => cellAt(sheet.rows, row - 1, colIndex(col));
    const S = (sheet, col, row) => cellString(C(sheet, col, row));
    const N = (sheet, col, row) => cellNumber(C(sheet, col, row));
    const up = s => s == null ? null : s.toUpperCase();
    const ov = code => (r.overrides[code] = r.overrides[code] || {});

    for (let row = 5; row <= t.rows.length; row++) {
      const code = up(S(t, 'B', row)); if (!code) continue;
      const note = S(t, 'G', row);
      if (isSample(note)) { r.skippedSampleRows++; continue; }
      const day = cellDay(C(t, 'A', row)), units = N(t, 'D', row), price = N(t, 'E', row);
      if (!day || units == null || price == null) { r.warnings.push(`İşlemler satır ${row}: tarih, adet ya da fiyat okunamadı, atlandı.`); continue; }
      const s = side(S(t, 'C', row));
      if (!s) { r.warnings.push(`İşlemler satır ${row}: işlem türü Alış/Satış değil, atlandı.`); continue; }
      r.trades.push({ day, code, side: s, units, price, note });
    }
    for (let row = 5; row <= p.rows.length; row++) {
      const code = up(S(p, 'B', row)); if (!code) continue;
      const note = S(p, 'E', row);
      if (isSample(note)) { r.skippedSampleRows++; continue; }
      const day = cellDay(C(p, 'A', row)), amount = N(p, 'D', row);
      if (!day || amount == null) { r.warnings.push(`Ödemeler satır ${row}: tarih ya da tutar okunamadı, atlandı.`); continue; }
      r.payments.push({ day, code, kind: S(p, 'C', row), amount, note });
    }
    const f = byName('Fonlar');
    if (f) for (let row = 5; row <= f.rows.length; row++) {
      const code = up(S(f, 'A', row)); if (!code) continue;
      const price = N(f, 'H', row);
      if (price != null) ov(code).userPrice = price;
      if (!catalogCodes.has(code)) {
        const fund = { code, name: S(f, 'B', row), manager: S(f, 'C', row), status: S(f, 'D', row), lastPrice: N(f, 'E', row), note: S(f, 'J', row) };
        Object.keys(fund).forEach(k => fund[k] == null && delete fund[k]);
        r.customFunds.push(fund);
      }
    }
    const net = byName('Net Yatırım');
    if (net) for (let row = 10; row <= net.rows.length; row++) {
      const code = up(S(net, 'A', row)); if (!code) continue;
      const m = C(net, 'M', row);
      if (m == null || net.formulas.has((row - 1) + ',' + colIndex('M'))) continue;
      const v = cellNumber(m);
      if (v != null && v !== 0) ov(code).expectedPayment = v;
    }
    const ps = byName('Parametreler');
    if (ps && defaults) r.parameters = parseParameters(ps, defaults);
    return r;
  }

  // ExcelImporter.parseParameters: okunamayan alan varsayılanda kalır.
  function parseParameters(s, defaults) {
    const p = JSON.parse(JSON.stringify(defaults));
    const ref = a => { const m = a.match(/^([A-Z]+)(\d+)$/); return [+m[2] - 1, colIndex(m[1])]; };
    const raw = a => { const [r, c] = ref(a); return cellAt(s.rows, r, c); };
    const isF = a => { const [r, c] = ref(a); return s.formulas.has(r + ',' + c); };
    const n = a => raw(a) == null || isF(a) ? null : cellNumber(raw(a));
    const t = a => cellString(raw(a));
    const dayOf = v => window.FonHesap.dayISO(serialDay(v));
    let v;
    if ((v = n('B5')) != null) p.referenceDate = dayOf(v);
    if ((v = n('B6')) != null) p.usdTryBuying1609 = v;
    if ((v = n('B7')) != null) p.usdTrySelling1609 = v;
    if ((v = t('B8')) != null && ['Alış', 'Satış'].includes(v)) p.fxChoice = v;
    if ((v = n('B10')) != null) p.usdTryToday = v;
    if ((v = t('B22')) != null && ['Yasal faiz', 'Avans faizi'].includes(v)) p.interestType = v;
    if ((v = n('B23')) != null) p.legalInterest2026 = v;
    if ((v = n('B24')) != null) p.advanceInterest = v;
    if ((v = n('B25')) != null) p.interestStartDate = dayOf(v);
    const scen = p.scenarios;
    [['B', 'İyimser'], ['C', 'Baz'], ['D', 'Kötümser']].forEach(([col, name]) => {
      let i = scen.indexOf(name);
      if (i < 0) { scen.push(name, {}); i = scen.length - 2; }
      const a = scen[i + 1];
      if ((v = n(col + '30')) != null) a.inflation = v;
      if ((v = n(col + '31')) != null) a.fxDepreciation = v;
      if ((v = n(col + '32')) != null) a.usInflation = v;
      if ((v = n(col + '33')) != null) a.legalInterest = v;
    });
    if ((v = t('B35')) != null && ['İyimser', 'Baz', 'Kötümser'].includes(v)) p.projectionScenario = v;
    if ((v = t('B38')) != null && ['16.09.2026 değeri', 'Net yatırım'].includes(v)) p.claimBasis = v;
    const durs = ['B39', 'C39', 'D39'].map(n).filter(x => x != null).map(x => Math.trunc(x));
    if (durs.length === 3) p.durations = durs;
    if ((v = n('B40')) != null) p.courtFeeRate = v;
    if ((v = n('B41')) != null) p.courtFeeUpfrontShare = v;
    if ((v = n('B42')) != null) p.expenseAdvance = v;
    if ((v = n('B43')) != null) p.lawyerFixedFee = v;
    if ((v = n('B44')) != null) p.lawyerSuccessRate = v;
    if ((v = t('B45')) != null) p.costsRecoveredIfWon = v.toLocaleLowerCase('tr-TR').startsWith('e');
    if ((v = n('B46')) != null) p.opposingAttorneyFee = v; else delete p.opposingAttorneyFee;
    if ((v = n('B47')) != null) p.interimPaymentCap = v;
    if ((v = n('B48')) != null) p.appealCostIfLost = v;
    return p;
  }

  // ---------- PDF ekstreler (pdf-ekstre.js) ----------
  // list: [{ name, buf }]; funds: [{c, n, p}] → { trades: [{day, code, side, units, price, amount, broker}], pages, brokers, others, unread, dup }
  async function readPDFs(list, funds, progress) {
    if (!window.FonPDF) throw new Error('PDF okuyucu yüklenemedi. Sayfayı yenileyip tekrar dene.');
    const out = { trades: [], pages: 0, brokers: new Set(), others: new Set(), unread: 0, dup: 0 };
    const seen = new Set();
    for (let k = 0; k < list.length; k++) {
      const { name, buf } = list[k];
      if (progress) progress(k, name);
      let res;
      try { res = await window.FonPDF.readLines(buf); }
      catch (e) { throw new Error(`${name}: ${e.message || 'okunamadı'}`); }
      out.pages += res.pages;
      const r = window.FonPDF.scan(res.lines, funds, num);
      if (r.broker) out.brokers.add(r.broker);
      r.others.forEach(o => out.others.add(o));
      out.unread += r.unread.length;
      for (const c of r.candidates) {
        const key = [c.date, c.code, c.side, Math.round(c.units * 1e4), Math.round(c.amount * 100), r.broker || ''].join('|');
        if (seen.has(key)) { out.dup++; continue; }
        seen.add(key);
        out.trades.push({ day: keyDay(c.date), dateKey: c.date, code: c.code, side: c.side, units: c.units, price: c.price, amount: c.amount, broker: r.broker || null });
      }
    }
    return out;
  }

  return {
    MAX_FILE, norm, num, parseNumber, cellString, cellNumber, cellDay, serialDay, dateKey, showDate, keyDay, side,
    fundCode, resolveFundCode, readXLSX, readCSV, readFile, headerRow, guess, missing, FIELDS, LABELS,
    filterCols, isFundType, isTL, parseRecords, v13, parseParameters, readPDFs, colIndex,
  };
})();
