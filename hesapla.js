// Hızlı net yatırım hesabı. Dosya yalnızca bu tarayıcıda okunur; sayfanın güvenlik kuralı (CSP)
// tarayıcının internete herhangi bir veri göndermesini zaten engeller. Dış kütüphane kullanılmaz.
(function () {
  'use strict';
  const MAX_FILE = 15 * 1024 * 1024;     // yüklenecek dosya
  const MAX_PART = 60 * 1024 * 1024;     // açılmış tek bir parça (sıkıştırma bombasına karşı)
  const MAX_ROWS = 20000;
  const CUTOFF = 20260916;                // 16.09.2026

  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tl = v => money.format(Math.round(v * 100) / 100) + ' TL';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Metin ve sayı yardımcıları ----------
  const norm = s => String(s == null ? '' : s).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

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

  // Tarihi yyyymmdd sayısına çevirir (karşılaştırma için).
  function dateKey(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    }
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
    return null;
  }
  const showDate = k => k ? `${String(k % 100).padStart(2, '0')}.${String(Math.floor(k / 100) % 100).padStart(2, '0')}.${Math.floor(k / 10000)}` : '';

  function side(v) {
    const s = norm(v).toUpperCase();
    if (!s) return null;
    if (s === 'A' || s === 'B' || s.includes('BUY') || s.includes('SATIN AL')) return 'buy';
    if (s === 'S' || s.includes('SELL') || s.includes('SAT') || s.includes('IADE') || s.includes('GERI ALIM')) return 'sell';
    if (s.includes('AL') || s.includes('GIRIS')) return 'buy';
    return null;
  }

  function fundCode(v) {
    const up = String(v == null ? '' : v).toLocaleUpperCase('tr-TR').trim();
    if (!up) return null;
    if (/^[A-Z0-9]{2,5}$/.test(up)) return up;
    const tokens = up.split(/[^A-Z0-9ÇĞİÖŞÜ]+/).filter(Boolean);
    return tokens.find(t => /^[A-Z0-9]{3}$/.test(t)) || null;
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
      sheets.push({ name: s.getAttribute('name') || 'Sayfa', rows: sheetRows(xml(doc), strings) });
    }
    return sheets;
  }

  function sheetRows(doc, strings) {
    const rows = [];
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
        if (ci >= 0 && ci < 200) row[ci] = val;
      }
      rows[ri] = row;
    }
    return Array.from(rows, r => r || []);
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
    return [{ name: 'CSV', rows }];
  }

  // ---------- Sütun tahmini (uygulamadaki kurallarla aynı) ----------
  const FIELDS = [
    ['date', 'Tarih', true], ['code', 'Fon kodu', true], ['side', 'İşlem (Alış/Satış)', false],
    ['units', 'Adet', false], ['price', 'Birim fiyat', false], ['amount', 'Tutar', false], ['broker', 'Aracı kurum', false],
  ];
  const KEYS = {
    date: ['tarih', 'islem tarihi', 'valor', 'date'],
    code: ['fon kodu', 'kod', 'fon', 'menkul', 'enstruman', 'kiymet', 'varlik', 'urun', 'fund'],
    side: ['islem', 'islem turu', 'islem tipi', 'islem yonu', 'yon', 'alis/satis', 'alis satis', 'hareket', 'tur', 'tip', 'side', 'type'],
    units: ['adet', 'miktar', 'pay adedi', 'pay', 'nominal', 'units', 'quantity'],
    price: ['birim fiyat', 'fiyat', 'price'],
    amount: ['tutar', 'islem tutari', 'net tutar', 'toplam', 'brut tutar', 'amount'],
    broker: ['araci kurum', 'araci', 'kurum', 'broker'],
  };

  function headerRow(rows) {
    let best = { r: 0, s: 0 };
    for (let r = 0; r < Math.min(30, rows.length); r++) {
      const s = (rows[r] || []).filter(c => c != null && Object.values(KEYS).some(ks => ks.some(k => norm(c).includes(k)))).length;
      if (s > best.s) best = { r, s };
    }
    return best.r;
  }

  function guess(rows, h) {
    const heads = (rows[h] || []).map(norm);
    const used = new Set(), m = {};
    for (const f of ['date', 'price', 'amount', 'units', 'broker', 'code', 'side']) {
      let best = null;
      heads.forEach((txt, col) => {
        if (!txt || used.has(col)) return;
        const sc = Math.max(0, ...KEYS[f].map(k => txt === k ? 300 + k.length : txt.startsWith(k) ? 200 + k.length : txt.includes(k) ? 100 + k.length : 0));
        if (sc > 0 && (!best || sc > best.s)) best = { col, s: sc };
      });
      if (best) { m[f] = best.col; used.add(best.col); }
    }
    return m;
  }

  // Fon Mağduru Hesap Defteri (v1.3) biçimi: "İşlemler" sayfası 5. satırdan, A tarih B kod C tür D adet E fiyat G not.
  function v13(sheets) {
    const t = sheets.find(s => s.name === 'İşlemler'), p = sheets.find(s => s.name === 'Ödemeler');
    if (!t || !p) return null;
    const isSample = note => norm(note).includes('ornek');
    const trades = [], payments = [], skipped = [];
    t.rows.forEach((r, i) => {
      if (i < 4 || !r[1]) return;
      if (isSample(r[6])) return;
      trades.push({ row: i + 1, date: r[0], code: r[1], side: r[2], units: r[3], price: r[4], amount: null, broker: null });
    });
    p.rows.forEach((r, i) => {
      if (i < 4 || !r[1] || isSample(r[4])) return;
      const a = num(r[3]); const c = fundCode(r[1]);
      if (a && c) payments.push({ code: c, amount: Math.abs(a) }); else skipped.push(i + 1);
    });
    return { trades, payments };
  }

  // ---------- Durum ----------
  let sheets = [], sheetIdx = 0, hRow = 0, map = {}, fixed = null, fileName = '';
  const paidByFund = {};

  function rowsToTrades() {
    if (fixed) return fixed.trades;
    const rows = sheets[sheetIdx].rows, out = [];
    for (let r = hRow + 1; r < rows.length; r++) {
      const x = rows[r] || [];
      const get = f => map[f] != null ? x[map[f]] : null;
      if (x.every(c => c == null || c === '')) continue;
      out.push({ row: r + 1, date: get('date'), code: get('code'), side: get('side'), units: get('units'), price: get('price'), amount: get('amount'), broker: get('broker') });
    }
    return out;
  }

  function compute() {
    const raw = rowsToTrades();
    const funds = new Map(); const skipped = []; let after = 0, used = 0;
    for (const t of raw) {
      const d = dateKey(t.date), c = fundCode(t.code);
      if (!d || !c) { skipped.push([t.row, !d ? 'tarih okunamadı' : 'fon kodu okunamadı']); continue; }
      let units = num(t.units), price = num(t.price), amount = num(t.amount);
      let s = side(t.side);
      if (!s && map.side == null && !fixed) s = ((units ?? amount ?? 0) < 0) ? 'sell' : 'buy';
      if (!s) { skipped.push([t.row, 'Alış/Satış anlaşılamadı']); continue; }
      const amt = amount != null ? Math.abs(amount) : (units != null && price != null ? Math.abs(units * price) : null);
      if (!amt) { skipped.push([t.row, 'tutar ya da adet × fiyat okunamadı']); continue; }
      if (d > CUTOFF) { after++; continue; }
      used++;
      const bName = String(t.broker == null ? '' : t.broker).trim();
      const bKey = norm(bName);
      if (!funds.has(c)) funds.set(c, new Map());
      const fb = funds.get(c);
      if (!fb.has(bKey)) fb.set(bKey, { name: bName, buy: 0, sell: 0 });
      fb.get(bKey)[s] += amt;
    }
    if (fixed) for (const p of fixed.payments) if (paidByFund[p.code] == null) paidByFund[p.code] = 0;
    if (fixed && !compute.prefilled) {
      for (const p of fixed.payments) paidByFund[p.code] = (paidByFund[p.code] || 0) + p.amount;
      compute.prefilled = true;
    }
    render(funds, skipped, after, used);
  }

  function render(funds, skipped, after, used) {
    const res = $('result');
    if (!funds.size) {
      res.hidden = false;
      $('resultBody').innerHTML = '<p class="muted">Hesaplanacak işlem bulunamadı. Sütun eşleştirmesini kontrol et ya da <a href="sablon/islemler-sablonu.csv" download>şablonu</a> kullan.</p>';
      $('resultTotals').innerHTML = ''; $('resultNotes').innerHTML = notes(skipped, after, used);
      return;
    }
    let html = '<div class="table-scroll"><table class="result"><thead><tr><th>Fon</th><th>Aracı kurum</th><th class="n">Alışlar</th><th class="n">Satışlar</th><th class="n">Net yatırım</th><th class="n">Gelen ödeme</th><th class="n">Kalan</th></tr></thead><tbody>';
    let tCounted = 0, tNetted = 0, tPaid = 0, tRemain = 0;
    [...funds.keys()].sort().forEach(code => {
      const parts = [...funds.get(code).values()];
      let counted = 0, netted = 0;
      parts.forEach((b, i) => {
        const net = b.buy - b.sell; counted += Math.max(0, net); netted += net;
        const span = parts.length + (parts.length > 1 ? 1 : 0);
        html += `<tr class="${i === 0 ? 'first' : 'more'}"><td class="fund">${i === 0 ? `<b>${esc(code)}</b>` : `<span class="m-only"><b>${esc(code)}</b></span>`}</td><td class="broker">${esc(b.name || (parts.length > 1 ? 'belirtilmemiş' : '–'))}</td>
          <td class="n" data-label="Alışlar">${tl(b.buy)}</td><td class="n" data-label="Satışlar">${tl(b.sell)}</td>
          <td class="n" data-label="Net yatırım">${tl(net)}${net < 0 ? ' <span class="chip warn">0 sayılır</span>' : ''}</td>
          ${i === 0 ? `<td class="n fundcol" data-label="Gelen ödeme (${esc(code)})" rowspan="${span}"><input class="paid" data-code="${esc(code)}" inputmode="decimal" placeholder="0" value="${paidByFund[code] ? esc(String(paidByFund[code]).replace('.', ',')) : ''}" aria-label="${esc(code)} için gelen ödeme"></td>
          <td class="n remain fundcol" data-label="Kalan (${esc(code)})" data-code="${esc(code)}" rowspan="${span}"></td>` : ''}</tr>`;
      });
      if (parts.length > 1) html += `<tr class="sub"><td class="fund"></td><td class="broker">${esc(code)} toplamı</td><td class="empty"></td><td class="empty"></td><td class="n" data-label="${esc(code)} net yatırım"><b>${tl(counted)}</b></td></tr>`;
      const pv = paidByFund[code] ? esc(String(paidByFund[code]).replace('.', ',')) : '';
      html += `<tr class="m-fund"><td class="n" data-label="${esc(code)} için gelen ödeme"><input class="paid" data-code="${esc(code)}" inputmode="decimal" placeholder="0" value="${pv}" aria-label="${esc(code)} için gelen ödeme"></td><td class="n remain" data-label="${esc(code)} kalan alacak" data-code="${esc(code)}"></td></tr>`;
      const paid = paidByFund[code] || 0;
      const remain = Math.max(0, counted - paid);
      tCounted += counted; tNetted += netted; tPaid += paid; tRemain += remain;
      funds.get(code).counted = counted;
    });
    html += '</tbody></table></div>';
    res.hidden = false;
    $('resultBody').innerHTML = html;
    const fill = () => {
      let sumPaid = 0, sumRemain = 0;
      for (const [code, fb] of funds) {
        const paid = paidByFund[code] || 0, r = Math.max(0, fb.counted - paid);
        sumPaid += paid; sumRemain += r;
      }
      res.querySelectorAll('td.remain').forEach(td => {
        const code = td.dataset.code;
        td.textContent = tl(Math.max(0, funds.get(code).counted - (paidByFund[code] || 0)));
      });
      $('resultTotals').innerHTML = `
        <div class="big"><span>Toplam net yatırım</span><span>${tl(tCounted)}</span></div>
        ${Math.abs(tCounted - tNetted) > 0.005 ? `<div class="muted"><span>Çaprazlama yapılırsa</span><span>${tl(tNetted)}</span></div>` : ''}
        <div><span>Toplam gelen ödeme</span><span>${tl(sumPaid)}</span></div>
        <div class="big"><span>Net yatırıma göre kalan alacak</span><span>${tl(sumRemain)}</span></div>`;
    };
    res.querySelectorAll('input.paid').forEach(inp => inp.addEventListener('input', () => {
      paidByFund[inp.dataset.code] = num(inp.value) || 0;
      res.querySelectorAll('input.paid').forEach(o => { if (o !== inp && o.dataset.code === inp.dataset.code) o.value = inp.value; });
      fill();
    }));
    fill();
    $('resultNotes').innerHTML = notes(skipped, after, used);
    $('download').hidden = false;
    lastTrades = rowsToTrades();
  }

  function notes(skipped, after, used) {
    let h = `<p>${used} işlem hesaba katıldı.</p>`;
    if (after) h += `<p class="warnline">16.09.2026'dan sonra tarihli ${after} işlem hesaba katılmadı (tasfiye ödemeleri işlem değildir).</p>`;
    if (skipped.length) h += `<details><summary>Okunamayan satır: ${skipped.length}</summary><ul>${skipped.slice(0, 50).map(([r, why]) => `<li>Satır ${r}: ${esc(why)}</li>`).join('')}</ul></details>`;
    return h;
  }

  // ---------- Eşleştirme arayüzü ----------
  function mappingUI() {
    const box = $('mapping');
    if (fixed) { box.innerHTML = '<p class="okline">Fon Mağduru Hesap Defteri biçimi tanındı: "İşlemler" ve "Ödemeler" sayfaları okundu. Gelen ödemeler fon fon dolduruldu.</p>'; return; }
    const rows = sheets[sheetIdx].rows;
    const heads = (rows[hRow] || []);
    const opts = sel => `<option value="">—</option>` + heads.map((h, i) => h == null || h === '' ? '' : `<option value="${i}"${sel === i ? ' selected' : ''}>${esc(String(h).slice(0, 40))}</option>`).join('');
    box.innerHTML = `
      ${sheets.length > 1 ? `<div class="maprow"><label for="mSheet">Sayfa</label><select id="mSheet">${sheets.map((s, i) => `<option value="${i}"${i === sheetIdx ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
      <div class="mapgrid">${FIELDS.map(([f, label, req]) => `<div class="maprow"><label for="m_${f}">${label}${req ? ' *' : ''}</label><select id="m_${f}" data-f="${f}">${opts(map[f])}</select></div>`).join('')}</div>
      <p class="muted small">Sütunlar başlıklara bakılarak tahmin edildi; yanlışsa buradan düzelt. Tutar yoksa adet × birim fiyat kullanılır. İşlem sütunu yoksa eksi tutar satış sayılır.</p>`;
    box.querySelectorAll('select[data-f]').forEach(s => s.addEventListener('change', () => {
      map[s.dataset.f] = s.value === '' ? undefined : +s.value; compute();
    }));
    const ms = $('mSheet');
    if (ms) ms.addEventListener('change', () => { sheetIdx = +ms.value; hRow = headerRow(sheets[sheetIdx].rows); map = guess(sheets[sheetIdx].rows, hRow); mappingUI(); compute(); });
  }

  // ---------- Dosya seçme ----------
  async function openFile(file) {
    const status = $('fileStatus');
    $('result').hidden = true; $('download').hidden = true;
    if (!file) return;
    if (file.size > MAX_FILE) { status.innerHTML = '<span class="warnline">Dosya çok büyük (en fazla 15 MB).</span>'; return; }
    fileName = file.name;
    status.textContent = `${file.name} okunuyor…`;
    try {
      const buf = await file.arrayBuffer();
      const isZip = buf.byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50;
      if (/\.xls$/i.test(file.name) && !isZip) throw new Error('Eski Excel biçimi (.xls) okunamıyor. Dosyayı Excel\'de "Farklı Kaydet → .xlsx" ya da CSV olarak kaydet.');
      if (/\.pdf$/i.test(file.name)) throw new Error('PDF burada okunmuyor. PDF ekstreler için Fon Defterim uygulamasını kullanabilir ya da işlemleri şablona yazabilirsin.');
      sheets = isZip ? await readXLSX(buf) : readCSV(new TextDecoder().decode(buf));
      sheets = sheets.filter(s => s.rows.length);
      if (!sheets.length) throw new Error('Dosyada okunabilir bir tablo bulunamadı.');
      fixed = v13(sheets);
      compute.prefilled = false;
      Object.keys(paidByFund).forEach(k => delete paidByFund[k]);
      if (!fixed) {
        const scored = sheets.map((s, i) => ({ i, m: guess(s.rows, headerRow(s.rows)) }));
        sheetIdx = (scored.sort((a, b) => Object.keys(b.m).length - Object.keys(a.m).length)[0] || { i: 0 }).i;
        hRow = headerRow(sheets[sheetIdx].rows);
        map = guess(sheets[sheetIdx].rows, hRow);
      }
      status.innerHTML = `<b>${esc(file.name)}</b> okundu. Dosya bu cihazdan çıkmadı.`;
      $('mapWrap').hidden = false;
      mappingUI();
      compute();
    } catch (e) {
      status.innerHTML = `<span class="warnline">${esc(e.message || 'Dosya okunamadı.')}</span>`;
    }
  }

  // Okunan işlemleri Fon Defterim şablonu biçiminde indir (uygulamaya aktarmak için).
  let lastTrades = [];
  function download() {
    const lines = ['Tarih;Fon kodu;İşlem;Adet;Birim fiyat;Tutar;Aracı kurum'];
    for (const t of lastTrades) {
      const d = dateKey(t.date), c = fundCode(t.code); if (!d || !c) continue;
      const s = side(t.side) || (num(t.units ?? t.amount) < 0 ? 'sell' : 'buy');
      const f = v => v == null ? '' : String(Math.abs(num(v) ?? 0)).replace('.', ',');
      const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      lines.push([showDate(d), c, s === 'buy' ? 'Alış' : 'Satış', f(t.units), f(t.price), f(t.amount), cell(t.broker)].join(';'));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fon-defterim-islemler.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- Elle hesap ----------
  function manualRow() {
    const r = document.createElement('div');
    r.className = 'row';
    const i = $('rows').children.length + 1;
    r.innerHTML = `<div class="name"><label>Aracı kurum</label><input class="n" placeholder="Kurum ${i}"></div>
      <div><label>Alışlar toplamı (TL)</label><input class="b" inputmode="decimal" placeholder="0"></div>
      <div><label>Satışlar toplamı (TL)</label><input class="s" inputmode="decimal" placeholder="0"></div>
      <button class="del" type="button" aria-label="Bu satırı sil">×</button>`;
    r.querySelector('.del').addEventListener('click', () => { if ($('rows').children.length > 1) { r.remove(); manual(); } });
    $('rows').appendChild(r);
  }
  function manual() {
    let counted = 0, netted = 0; const lines = [];
    [...$('rows').children].forEach((r, i) => {
      const name = r.querySelector('.n').value.trim() || `Kurum ${i + 1}`;
      const net = (num(r.querySelector('.b').value) || 0) - (num(r.querySelector('.s').value) || 0);
      counted += Math.max(0, net); netted += net;
      lines.push(`<div><span>${esc(name)}</span><span>${tl(net)}${net < 0 ? ' → 0' : ''}</span></div>`);
    });
    $('perBroker').innerHTML = $('rows').children.length > 1 ? lines.join('') : '';
    $('total').textContent = tl(counted);
    $('nettedRow').hidden = Math.abs(counted - netted) < 0.005;
    $('netted').textContent = tl(netted);
    $('remaining').textContent = tl(Math.max(0, counted - (num($('paid').value) || 0)));
  }

  // ---------- Başlat ----------
  document.addEventListener('DOMContentLoaded', () => {
    const input = $('file'), drop = $('drop');
    input.addEventListener('change', () => openFile(input.files[0]));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) openFile(f); });
    $('clear').addEventListener('click', () => {
      input.value = ''; sheets = []; fixed = null; $('result').hidden = true; $('mapWrap').hidden = true; $('download').hidden = true;
      $('fileStatus').textContent = 'Dosya kaldırıldı.';
    });
    $('download').addEventListener('click', download);
    manualRow(); manualRow();
    $('add').addEventListener('click', () => { manualRow(); manual(); });
    $('manual').addEventListener('input', manual);
    manual();
    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
      $('panelFile').hidden = b.dataset.tab !== 'file';
      $('panelManual').hidden = b.dataset.tab !== 'manual';
    }));
  });
})();
