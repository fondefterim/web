// Hızlı net yatırım hesabı. Dosya yalnızca bu tarayıcıda okunur; sayfanın güvenlik kuralı (CSP)
// tarayıcının internete herhangi bir veri göndermesini zaten engeller. PDF için yalnızca sitenin kendi pdf.js kopyası kullanılır.
(function () {
  'use strict';
  const CUTOFF = 20260916;                // 16.09.2026
  // Dosya okuma ve sütun tahmini ortak dosyada (ice-aktar.js; web defteri de aynısını kullanır).
  const IA = window.FonIceAktar;
  const { MAX_FILE, norm, num, dateKey, showDate, side, fundCode, readXLSX, readCSV, headerRow, isFundType, isTL } = IA;
  const guess = (rows, h) => IA.guess(rows, h, 'trades');

  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tl = v => money.format(Math.round(v * 100) / 100) + ' TL';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FIELDS = [
    ['date', 'Tarih', true], ['code', 'Fon kodu', true], ['side', 'İşlem (Alış/Satış)', false],
    ['units', 'Adet', false], ['price', 'Birim fiyat', false], ['amount', 'Tutar', false], ['broker', 'Aracı kurum', false],
  ];

  // Fon Mağduru Hesap Defteri (v1.3) biçimi: ortak okuyucudan gelen işlemler ve ödemeler.
  function v13(sheets) {
    const r = IA.v13(sheets, new Set((window.FON_LISTESI || []).map(f => f.c)), null);
    if (!r) return null;
    const trades = r.trades.map((t, i) => ({ row: i + 1, date: t.day, code: t.code, side: t.side === 'buy' ? 'Alış' : 'Satış', units: t.units, price: t.price, amount: null, broker: null }));
    const payments = r.payments.map(p => ({ code: fundCode(p.code), amount: Math.abs(p.amount) })).filter(p => p.code && p.amount);
    return { trades, payments };
  }

  // ---------- Durum ----------
  let sheets = [], sheetIdx = 0, hRow = 0, map = {}, fixed = null, fileName = '';
  const paidByFund = {};

  const filterCols = (rows, h) => IA.filterCols(rows, h, map);

  function rowsToTrades() {
    if (fixed) return fixed.trades;
    const rows = sheets[sheetIdx].rows, out = [];
    const fc = filterCols(rows, hRow);
    for (let r = hRow + 1; r < rows.length; r++) {
      const x = rows[r] || [];
      const get = f => map[f] != null ? x[map[f]] : null;
      if (x.every(c => c == null || c === '')) continue;
      const asset = fc.asset != null ? String(x[fc.asset] == null ? '' : x[fc.asset]).trim() : '';
      const cur = fc.cur != null ? String(x[fc.cur] == null ? '' : x[fc.cur]).trim() : '';
      const skip = !isFundType(asset) ? 'fon değil (' + asset + ')' : !isTL(cur) ? 'TL dışı (' + cur + ')' : null;
      out.push({ row: r + 1, date: get('date'), code: get('code'), side: get('side'), units: get('units'), price: get('price'), amount: get('amount'), broker: get('broker'), skip });
    }
    return out;
  }

  function compute() {
    const raw = rowsToTrades();
    const funds = new Map(); const skipped = []; let after = 0, used = 0;
    for (const t of raw) {
      if (t.skip) { skipped.push([t.row, t.skip]); continue; }
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
    if (skipped.length) h += `<details><summary>Alınmayan satır: ${skipped.length}</summary><ul>${skipped.slice(0, 50).map(([r, why]) => `<li>Satır ${r}: ${esc(why)}</li>`).join('')}</ul></details>`;
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
      const isPDF = buf.byteLength > 4 && new TextDecoder().decode(new Uint8Array(buf, 0, 5)) === '%PDF-';
      if (isPDF || /\.pdf$/i.test(file.name)) { await openPDFs([{ file, buf }]); return; }
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

  // PDF ekstre(ler): satırlardan işlemleri bulur (pdf-ekstre.js), sonuç Excel'deki gibi hesaplanır.
  // Birden fazla ekstre seçilebilir (ör. her ay ya da her aracı kurum ayrı); aynı işlem iki kez sayılmaz.
  async function openPDFs(list) {
    const status = $('fileStatus');
    if (!window.FonPDF) throw new Error('PDF okuyucu yüklenemedi. Sayfayı yenileyip tekrar dene.');
    const trades = [], seen = new Set(), others = new Set(), brokers = new Set();
    let pages = 0, unread = 0, dup = 0, row = 0;
    for (let k = 0; k < list.length; k++) {
      const { file, buf } = list[k];
      status.textContent = `${list.length > 1 ? `${k + 1}/${list.length} · ` : ''}${file.name} okunuyor… (ilk PDF'te okuyucu birkaç saniyede yüklenir)`;
      let res;
      try { res = await window.FonPDF.readLines(buf); }
      catch (e) { throw new Error(`${file.name}: ${e.message || 'okunamadı'}`); }
      pages += res.pages;
      const r = window.FonPDF.scan(res.lines, window.FON_LISTESI || [], num);
      if (r.broker) brokers.add(r.broker);
      r.others.forEach(o => others.add(o));
      unread += r.unread.length;
      for (const c of r.candidates) {
        const key = [c.date, c.code, c.side, Math.round(c.units * 1e4), Math.round(c.amount * 100), r.broker || ''].join('|');
        if (seen.has(key)) { dup++; continue; }
        seen.add(key);
        trades.push({
          row: ++row, date: showDate(c.date), code: c.code,
          side: c.side === 'buy' ? 'Alış' : c.side === 'sell' ? 'Satış' : '',
          units: c.units, price: c.price, amount: c.amount, broker: r.broker || '',
        });
      }
    }
    sheets = [];
    fixed = { trades, payments: [] };
    compute.prefilled = false;
    Object.keys(paidByFund).forEach(k => delete paidByFund[k]);
    $('mapWrap').hidden = true;
    const found = trades.filter(t => t.code).length;
    const what = list.length > 1 ? `${list.length} ekstre` : `<b>${esc(list[0].file.name)}</b>`;
    const bits = [`${what} okundu (${pages} sayfa${brokers.size ? ', ' + esc([...brokers].join(', ')) : ''}). Dosya bu cihazdan çıkmadı.`,
      found ? `Tasfiyedeki fonlarda <b>${found}</b> işlem bulundu; aşağıdaki tabloyu ekstrenle karşılaştır.`
            : 'Tasfiyedeki fonlarda işlem bulunamadı. Ekstrede bu fonlar yoksa sonuç boş çıkar.'];
    if (dup) bits.push(`Birden fazla ekstrede geçen ${dup} işlem bir kez sayıldı.`);
    if (others.size) bits.push(`Listede olmayan ${others.size} kıymet (ör. ${esc([...others].slice(0, 4).join(', '))}) hesaba katılmadı.`);
    if (unread) bits.push(`${unread} satır işleme çevrilemedi (virman, masraf, bakiye gibi).`);
    status.innerHTML = bits.join(' ');
    compute();
  }

  // Birden çok dosya: yalnızca PDF ekstreler birlikte okunur.
  async function openFiles(files) {
    files = [...(files || [])];
    if (files.length <= 1) return openFile(files[0]);
    const status = $('fileStatus');
    $('result').hidden = true; $('download').hidden = true;
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) {
      status.innerHTML = '<span class="warnline">Birden fazla dosya yalnızca PDF ekstreler için seçilebilir. Excel ya da CSV için tek dosya seç.</span>';
      return;
    }
    if (pdfs.length > 24) { status.innerHTML = '<span class="warnline">Tek seferde en fazla 24 PDF seçebilirsin.</span>'; return; }
    if (pdfs.some(f => f.size > MAX_FILE)) { status.innerHTML = '<span class="warnline">Dosyalardan biri çok büyük (en fazla 15 MB).</span>'; return; }
    fileName = pdfs.length + ' ekstre';
    try {
      const list = [];
      for (const file of pdfs) list.push({ file, buf: await file.arrayBuffer() });
      await openPDFs(list);
      if (pdfs.length < files.length) status.innerHTML += ' <span class="warnline">PDF olmayan dosyalar atlandı.</span>';
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
    input.addEventListener('change', () => openFiles(input.files));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files); });
    $('clear').addEventListener('click', () => {
      input.value = ''; sheets = []; fixed = null; $('result').hidden = true; $('mapWrap').hidden = true; $('download').hidden = true;
      $('fileStatus').textContent = 'Dosya kaldırıldı.';
    });
    $('download').addEventListener('click', download);
    // PDF: tarayıcının yazdırma penceresi (Kaydet → PDF). Hiçbir veri dışarı gönderilmez.
    document.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => {
      const d = new Date();
      $('printDate').textContent = d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · fondefterim.com';
      document.body.dataset.print = $('panelFile').hidden ? 'manual' : 'file';
      window.print();
    }));
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
