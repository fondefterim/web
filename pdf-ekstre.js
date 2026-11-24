// Aracı kurum PDF ekstrelerini tarayıcıda okur (Fon Defterim uygulamasındaki kuralların aynısı).
// PDF, Mozilla'nın pdf.js kütüphanesiyle (sitenin kendi kopyası: vendor/pdfjs) bu cihazda açılır;
// sayfanın güvenlik kuralı (CSP) internete veri gönderilmesine zaten izin vermez.
//
// Kurumdan kuruma düzen değiştiği için sütun konumlarına güvenmez: her satırda bir tarih ve
// "adet × fiyat ≈ tutar" tutan üç sayı arar. Fon kodu tasfiye listesinden, Alış/Satış satırdaki
// kelimelerden bulunur. Sonuç her zaman kullanıcıya gösterilir.
(function () {
  'use strict';

  const norm = s => String(s == null ? '' : s).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const upTR = s => String(s == null ? '' : s).toLocaleUpperCase('tr-TR');

  // ---------- PDF → satırlar ----------
  // Kütüphane bu dosyanın yanındaki vendor/ klasöründen yüklenir (alt klasördeki sayfalar, ör. defter/, için de).
  const BASE = (document.currentScript && document.currentScript.src) || document.baseURI;
  let lib = null;
  async function pdfjs() {
    if (!lib) {
      lib = await import(new URL('vendor/pdfjs/pdf.min.mjs', BASE).href);
      lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', BASE).href;
    }
    return lib;
  }

  async function readLines(buf) {
    const L = await pdfjs();
    let doc;
    const task = L.getDocument({
      data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true,
      useSystemFonts: false, useWorkerFetch: false, stopAtErrors: false,
    });
    try {
      doc = await task.promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('PDF şifreli. Şifresiz bir kopyasını seç.');
      throw new Error('PDF açılamadı. Dosya bozuk olabilir.');
    }
    const lines = [];
    const pages = Math.min(doc.numPages, 200);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      lines.push(...groupRows(tc.items));
      page.cleanup();
    }
    try { await task.destroy(); } catch (e) { /* temizlik hatası sonucu etkilemez */ }
    if (!lines.some(l => l.trim())) throw new Error('PDF\'te okunabilir yazı yok (taranmış görüntü olabilir). Bu tür PDF\'ler için Fon Defterim uygulamasını kullan; yazı tanıma yalnızca uygulamada var.');
    return { lines, pages };
  }

  // Aynı yükseklikteki parçalar bir satır; aralarında büyük boşluk varsa sütun ayırıcı ("   ").
  function groupRows(items) {
    const parts = [];
    for (const it of items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const t = it.transform;
      const h = it.height || Math.hypot(t[2], t[3]) || 8;
      parts.push({ x: t[4], y: t[5], w: it.width || 0, h, str });
    }
    parts.sort((a, b) => b.y - a.y);
    const rows = [];
    for (const p of parts) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - p.y) < Math.max(Math.min(last.h, p.h) * 0.5, 0.001)) last.items.push(p);
      else rows.push({ y: p.y, h: p.h, items: [p] });
    }
    return rows.map(r => {
      const its = r.items.sort((a, b) => a.x - b.x);
      let out = '', prevEnd = null;
      for (const it of its) {
        if (prevEnd != null) {
          const gap = it.x - prevEnd;
          out += gap > r.h * 1.0 ? '   ' : gap > r.h * 0.12 ? ' ' : '';
        }
        out += it.str;
        prevEnd = Math.max(prevEnd == null ? it.x + it.w : prevEnd, it.x + it.w);
      }
      return out.trim();
    });
  }

  // ---------- Satırlardan işlem çıkarma ----------
  const DATE_PATTERNS = [
    [/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g, 'dmy'],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/g, 'ymd'],
    // 04/09/26 gibi iki haneli yıl (ör. Midas). Dört haneli biçimlerden sonra denenir.
    [/\b(\d{1,2})[./](\d{1,2})[./](\d{2})\b/g, 'dmy2'],
  ];

  // İlk tarihi bulur (yyyymmdd); tarihleri ve saatleri sayı aramasından çıkarır.
  function extractDate(line) {
    let found = null, rest = line;
    for (const [re, kind] of DATE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while (found == null && (m = re.exec(rest))) {
        const g = [+m[1], +m[2], +m[3]];
        const [d, mo, y] = kind === 'ymd' ? [g[2], g[1], g[0]] : [g[0], g[1], kind === 'dmy2' ? 2000 + g[2] : g[2]];
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100) found = y * 10000 + mo * 100 + d;
      }
      rest = rest.replace(re, ' ');
    }
    rest = rest.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');
    return found == null ? null : { date: found, rest };
  }

  const NUM_RE = /(^|[^\p{L}\p{N}_.,])(-?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?))(?![\p{L}\p{N}_])/gu;

  function extractNumbers(s, num) {
    const out = [];
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(s))) {
      const raw = m[2];
      const v = num(raw);
      if (v == null || v === 0) continue;
      const lc = raw.lastIndexOf(','), ld = raw.lastIndexOf('.');
      let decimals = 0;
      if (lc >= 0 && (ld < 0 || ld < lc)) decimals = raw.length - lc - 1;
      else if (ld >= 0 && Math.abs(v - Math.round(v)) > 1e-12) decimals = raw.length - ld - 1;
      out.push({ value: Math.abs(v), decimals, position: m.index + m[1].length });
    }
    return out;
  }

  // adet × fiyat ≈ tutar tutan üç sayı. Fiyat yuvarlanmışsa gerçek fiyat tutar ÷ adet olur.
  function bestTriple(n, expectedPrice) {
    if (n.length < 3) return null;
    const half = x => 0.5 * Math.pow(10, -x.decimals);
    let best = null;
    for (let k = 0; k < n.length; k++) {
      const target = n[k].value;
      for (let i = 0; i < n.length; i++) {
        if (i === k) continue;
        for (let j = i + 1; j < n.length; j++) {
          if (j === k) continue;
          const product = n[i].value * n[j].value;
          let rounding;
          if (n[i].decimals === n[j].decimals) rounding = Math.min(n[i].value * half(n[j]), n[j].value * half(n[i]));
          else {
            const [few, many] = n[i].decimals < n[j].decimals ? [n[i], n[j]] : [n[j], n[i]];
            rounding = few.value * half(many);
          }
          const tol = Math.max(0.011, target * 0.002, rounding + 0.011);
          const diff = Math.abs(product - target);
          if (diff > tol || !(n[i].value < target || n[j].value < target)) continue;
          const err = diff / Math.max(target, 1e-9);
          const rank = n[k].position > Math.max(n[i].position, n[j].position) ? 0 : 1;
          let better = !best;
          if (best) {
            if (rank !== best.rank) better = rank < best.rank;
            else if (Math.abs(err - best.err) > 1e-9) better = err < best.err;
            else better = target > best.amount.value;
          }
          if (better) best = { a: n[i], b: n[j], amount: n[k], err, rank };
        }
      }
    }
    if (!best) return null;
    const [u, p] = assignUnitsAndPrice(best.a, best.b, expectedPrice);
    const amount = best.amount.value;
    const price = Math.abs(u.value * p.value - amount) > 0.005 && u.value > 0 ? amount / u.value : p.value;
    return { units: u.value, price, amount };
  }

  function assignUnitsAndPrice(x, y, expected) {
    if (expected > 0) {
      const dx = Math.abs(Math.log(x.value / expected)), dy = Math.abs(Math.log(y.value / expected));
      if (Math.abs(dx - dy) > 0.7) return dx < dy ? [y, x] : [x, y];
    }
    if (x.decimals >= 3 && y.decimals === 0) return [y, x];
    if (y.decimals >= 3 && x.decimals === 0) return [x, y];
    if (x.decimals !== y.decimals) return x.decimals < y.decimals ? [x, y] : [y, x];
    return x.position < y.position ? [x, y] : [y, x];
  }

  // "… Fon Emri DOH Alış …", "Piyasa Emri AKBNK Satış": sembol açıkça yazıyor.
  const ORDER_RE = /(?:^|[^\p{L}\p{N}])(?:Limit|Piyasa|Fon|Stop|Şartlı|Sartli)\s+Emri\s+([A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9.]{1,11})\s+(?:Alış|Satış|Alis|Satis|ALIŞ|SATIŞ)(?![\p{L}\p{N}])/u;
  function orderSymbol(line) {
    const m = ORDER_RE.exec(line);
    return m ? upTR(m[1]) : null;
  }

  function fundCode(line, codes, names) {
    // Kod ekstrede büyük harfle yazılır; "Brt Kar" (brüt kâr) gibi sözcükler BRT fonu sayılmasın.
    const tokens = String(line).split(/[^\p{L}\p{N}]+/u);
    const hit = tokens.find(t => codes.has(t));
    if (hit) return hit;
    const n = norm(line);
    const byName = names.find(([nm]) => n.includes(nm));
    return byName ? byName[1] : null;
  }

  // Fon alım-satımı olmayan nakit hareketleri (repo, stopaj, virman, devir…).
  const NON_FUND = [' repo ', ' ters repo', ' stopaj ', ' virman', ' devir ', ' faiz ', ' komisyon ', ' bsmv ', ' saklama ',
    ' havale ', ' eft ', ' para yatirma', ' para cekme', ' temettu '];
  function isNonFundMovement(line) {
    const n = ' ' + norm(line).replace(/[^a-z0-9 ]/g, ' ') + ' ';
    return NON_FUND.some(k => n.includes(k));
  }

  function side(line) {
    const n = ' ' + norm(line).replace(/[^a-z0-9 ]/g, ' ') + ' ';
    const sell = [' satis', ' satim', ' iade', ' geri alim', ' geri satim', ' fon satis', ' sell', ' cikis '];
    const buy = [' alis', ' alim', ' satin al', ' fon alim', ' buy', ' giris '];
    const isSell = sell.some(k => n.includes(k)), isBuy = buy.some(k => n.includes(k));
    if (isSell && !isBuy) return 'sell';
    if (isBuy && !isSell) return 'buy';
    if (isBuy && isSell && (n.includes(' geri alim') || n.includes(' iade'))) return 'sell';
    return null;
  }

  const BROKERS = [
    ['midas', 'Midas'], ['is yatirim', 'İş Yatırım'], ['garanti bbva yatirim', 'Garanti BBVA Yatırım'],
    ['yapi kredi yatirim', 'Yapı Kredi Yatırım'], ['ak yatirim', 'Ak Yatırım'], ['qnb invest', 'QNB Invest'],
    ['qnb finansinvest', 'QNB Invest'], ['tera yatirim', 'Tera Yatırım'], ['gedik yatirim', 'Gedik Yatırım'],
    ['info yatirim', 'İnfo Yatırım'], ['halk yatirim', 'Halk Yatırım'], ['ziraat yatirim', 'Ziraat Yatırım'],
    ['vakif yatirim', 'Vakıf Yatırım'], ['deniz yatirim', 'Deniz Yatırım'], ['osmanli yatirim', 'Osmanlı Yatırım'],
    ['ata yatirim', 'Ata Yatırım'], ['seker yatirim', 'Şeker Yatırım'], ['teb yatirim', 'TEB Yatırım'],
    ['ing yatirim', 'ING Yatırım'], ['hsbc yatirim', 'HSBC Yatırım'], ['alnus yatirim', 'Alnus Yatırım'],
    ['phillipcapital', 'PhillipCapital'], ['a1 capital', 'A1 Capital'], ['colendi', 'Colendi'],
  ];
  function detectBroker(lines) {
    for (const line of lines.slice(0, 12)) {
      const n = norm(line);
      const hit = BROKERS.find(([k]) => n.includes(k));
      if (hit) return hit[1];
    }
    return null;
  }

  // funds: [{c: kod, n: ad, p: 16.09 fiyatı}]; num: sayı okuyucu (hesapla.js ile aynı).
  // ---------- Türkiye İş Bankası "Hesap Özeti" ----------
  // Fon işlemleri açıklamada yazar: "123456-DOH-TEFAS YATIRIM FONU TALİMAT SONUCU - ALIM Fiyat/Faiz: 1.234567 Adt: +1,234.567".
  // Uzun açıklama bir üst satıra taşar. "ALIŞ/SATIŞ TALİMATI" satırları yalnızca emirdir (bloke); işlem sayılmaz.
  // Tutar Türkçe (12.345,67), adet çoğu zaman İngilizce (1,234.567): adet ve fiyat, "adet × fiyat ≈ tutar" tutacak biçimde okunur.
  // Uygulamadaki IsBankStatement.swift ile aynı kurallar.
  function isBank(lines) {
    const n = lines.map(norm);
    return n.some(l => l.includes('is bankasi') || l.includes('isbank.com.tr')) && n.some(l => l.includes('hesap ozeti') || l.includes('yatirim fonu'));
  }

  const IB_ROW = /^\s*(\d{2})\/(\d{2})\/(\d{4})-\d{2}:\d{2}(?::\d{2})?\s+\d+\s+/;
  const IB_MONEY = /(^|[^\d.,])(-?\d{1,3}(?:\.\d{3})*,\d{2})(?![\d,])/;
  const IB_CODE = /\b\d{2,8}-([A-Z0-9]{3})-/;
  const IB_UNITS = /Adt\s*:\s*([+-]?)\s*(\d[\d.,]*)/;

  function ibReadings(t) {
    const out = [];
    for (const v of [parseFloat(t.replace(/,/g, '')), parseFloat(t.replace(/\./g, '').replace(',', '.'))]) {
      if (v > 0 && !out.includes(v)) out.push(v);
    }
    return out;
  }

  function ibRows(lines) {
    const out = []; let pending = [], started = false;
    lines.forEach((line, i) => {
      const m = IB_ROW.exec(line);
      if (m) {
        const rest = line.slice(m[0].length);
        out.push({ i, date: +m[3] * 10000 + +m[2] * 100 + +m[1], row: rest, text: pending.concat(rest).join(' ') });
        pending = []; started = true;
      } else if (started || norm(line).includes('tefas') || line.includes('Adt')) {
        pending.push(line);
      }
      if (norm(line).startsWith('islem tarihi')) { started = true; pending = []; }
    });
    return out;
  }

  function ibSide(n) {
    const k = n.indexOf('talimat sonucu');
    const tail = k >= 0 ? n.slice(k + 14) : n;
    const buy = tail.includes('alim') || tail.includes('alis'), sell = tail.includes('satim') || tail.includes('satis');
    return buy !== sell ? (buy ? 'buy' : 'sell') : null;
  }

  function ibScan(lines, funds) {
    const codes = new Set(funds.map(f => f.c));
    const out = { candidates: [], unread: [], others: [], broker: 'İş Bankası' };
    for (const r of ibRows(lines)) {
      const n = norm(r.text);
      if (!n.includes('yatirim fonu') || n.includes('iptal')) continue;
      if (!(n.includes('talimat sonucu') || n.includes('fonu alisi') || n.includes('fonu satisi'))) continue;   // emir, işlem değil
      const cm = IB_CODE.exec(r.text);
      if (!cm) { out.unread.push(r.text); continue; }
      const code = cm[1];
      if (!codes.has(code)) { if (!out.others.includes(code)) out.others.push(code); continue; }
      const sd = ibSide(n);
      const um = IB_UNITS.exec(r.text);
      const mm = IB_MONEY.exec(r.row);
      if (!sd || !um || !mm) { out.unread.push(r.text); continue; }
      const before = r.text.slice(0, um.index).match(/\d[\d.,]*\d|\d/g);
      const amount = Math.abs(parseFloat(mm[2].replace(/\./g, '').replace(',', '.')));
      let best = null;
      if (before && amount > 0) {
        for (const u of ibReadings(um[2])) for (const p of ibReadings(before[before.length - 1])) {
          const err = Math.abs(u * p - amount) / amount;
          if (!best || err < best.err) best = { units: u, price: p, err };
        }
      }
      if (!best || best.err > 0.01) { out.unread.push(r.text); continue; }
      out.candidates.push({ line: r.i + 1, date: r.date, code, side: sd, units: best.units, price: best.price, amount });
    }
    return out;
  }

  function scan(lines, funds, num) {
    if (isBank(lines)) return ibScan(lines, funds);
    const codes = new Set(funds.map(f => f.c));
    const prices = Object.fromEntries(funds.filter(f => f.p > 0).map(f => [f.c, f.p]));
    const names = funds.map(f => [norm(f.n), f.c]).filter(([n]) => n.length >= 8).sort((a, b) => b[0].length - a[0].length);
    const out = { candidates: [], unread: [], others: [], broker: detectBroker(lines) };
    lines.forEach((original, i) => {
      // "1.234 Payx1,234567" (Tera): fiyat "x" harfine bitişik; sayı olarak okunabilsin diye ayrılır.
      const line = String(original).replace(/(pay)\s*x\s*(?=\d)/gi, '$1 x ');
      const d = extractDate(line);
      if (!d) return;
      let explicit = null;
      const sym = orderSymbol(line);
      if (sym) {
        if (codes.has(sym)) explicit = sym;
        else { if (!out.others.includes(sym)) out.others.push(sym); return; }
      }
      const numbers = extractNumbers(d.rest, num);
      const code = explicit || fundCode(line, codes, names);
      // İçinde alış/satış geçmeyen repo, stopaj gibi satırlar kodla eşleşse bile atlanır.
      if (isNonFundMovement(line) && (!code || !side(line))) return;
      const t = bestTriple(numbers, code ? prices[code] : null);
      if (!t) { if (numbers.length >= 2) out.unread.push(line); return; }
      out.candidates.push({ line: i + 1, date: d.date, code, side: side(line), units: t.units, price: t.price, amount: t.amount });
    });
    return out;
  }

  window.FonPDF = { readLines, scan, _test: { isBank, ibScan, isNonFundMovement, fundCode, extractDate, extractNumbers, bestTriple, orderSymbol, side, detectBroker, groupRows } };
})();
