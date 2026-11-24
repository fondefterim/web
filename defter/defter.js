// Fon Defterim web defteri: ekranlar. Hesaplar hesap.js'te (uygulamayla aynı kurallar), dosya okuma ice-aktar.js'te,
// kayıt ve yedek depo.js'te. Kayıtlar yalnızca bu tarayıcıda tutulur; internete yalnızca herkese açık fon listesi için çıkılır.
(function () {
  'use strict';
  const H = window.FonHesap, IA = window.FonIceAktar, D = window.FonDepo;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- Biçimler ----------
  const money = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plain = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 });
  const tl = v => (v < -0.004 ? '−' : '') + money.format(Math.abs(Math.round(v * 100) / 100)) + ' TL';
  const pct = (r, d = 0) => r == null ? '–' : (r < 0 ? '−' : '') + '%' + new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(r * 100));
  const showDay = day => { if (!day) return ''; const [y, m, d] = day.split('-'); return `${d}.${m}.${y}`; };
  const dayOf = iso => H.isoDay(iso);
  const todayDay = () => H.isoDay(new Date().toISOString());
  const numIn = s => { const v = IA.parseNumber(String(s || '').trim()); return v == null ? null : v; };
  const numOut = v => v == null ? '' : String(v).replace('.', ',');
  const COLORS = ['#0e6b5f', '#2f6fdf', '#b4572e', '#7a4fc9', '#c0392b', '#1f8a4c', '#a07a00', '#5b6b77'];
  const initials = n => (String(n).trim().split(/\s+/).filter(w => /^\p{L}|^\p{N}/u.test(w)).slice(0, 2).map(w => [...w][0]).join('') || '?').toLocaleUpperCase('tr-TR');

  // ---------- Durum ----------
  let ledger = null, meta = {}, catalog = { updated: '', funds: [] }, installPrompt = null;
  const profile = () => ledger.profiles.find(p => p.id === ledger.activeProfileID) || ledger.profiles[0];
  const funds = () => H.fundList(catalog.funds, ledger.customFunds);
  const fundBy = code => funds().find(f => f.code === code);
  const codeSet = () => new Set(funds().map(f => f.code));
  const basis = () => (profile().parameters && profile().parameters.claimBasis) || '16.09.2026 değeri';
  const hasRecords = p => p.trades.length || p.payments.length || (p.brokerClaims || []).length;
  const heroBasis = () => meta.heroBasis === 'net' ? 'net' : '1609';

  // ---------- Kaydetme (her değişiklik hemen cihaza yazılır) ----------
  let toastTimer = null;
  function toast(text, undo) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button">Geri al</button>' : ''}`;
    t.hidden = false;
    if (undo) t.querySelector('button').onclick = () => { t.hidden = true; undo(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 8000 : 3500);
  }
  async function commit(change, opts = {}) {
    const before = clone(ledger);
    change(ledger);
    try {
      await D.save(ledger, opts);
    } catch (e) {
      ledger = before;
      if (e.conflict) { await dialog({ title: 'Defter başka bir sekmede değişti', body: 'Son hâli görmek için sayfa yenileniyor. Bu sekmedeki son değişiklik kaydedilmedi.', ok: 'Yenile' }); location.reload(); return false; }
      await dialog({ title: 'Kaydedilemedi', body: 'Tarayıcı kaydı reddetti: ' + (e.message || e) + '. Telefonda yer azsa biraz yer açıp tekrar dene.', ok: 'Tamam' });
      return false;
    }
    meta = await D.meta();
    if (!meta.persistAsked) { D.persist(); D.setMeta({ persistAsked: true }); meta.persistAsked = true; }
    if (opts.toast) toast(opts.toast, opts.undo === false ? null : async () => { ledger = before; await D.save(ledger); meta = await D.meta(); render(); toast('Geri alındı.'); });
    if (opts.go) location.hash = opts.go; else render();
    return true;
  }

  // ---------- Pencere (onay / bilgi / tek alan) ----------
  function dialog({ title, body = '', ok = 'Tamam', cancel = null, danger = false, input = null }) {
    const dlg = $('#dlg');
    return new Promise(resolve => {
      dlg.innerHTML = `<form method="dialog" class="in form">
        <h2>${esc(title)}</h2>${body ? `<div class="muted">${body}</div>` : ''}
        ${input ? `<div class="f"><label for="dlgIn">${esc(input.label)}</label><input id="dlgIn" type="${input.type || 'text'}" value="${esc(input.value || '')}" autocomplete="off" ${input.max ? `maxlength="${input.max}"` : ''}></div>` : ''}
        <div class="actions">${cancel ? `<button class="btn ghost" value="cancel" type="submit">${esc(cancel)}</button>` : ''}<button class="btn ${danger ? 'danger' : 'primary'}" value="ok" type="submit">${esc(ok)}</button></div>
      </form>`;
      dlg.onclose = () => {
        const v = dlg.returnValue === 'ok';
        resolve(input ? (v ? $('#dlgIn', dlg).value : null) : v);
      };
      dlg.returnValue = '';
      dlg.showModal();
      if (input) setTimeout(() => $('#dlgIn', dlg).focus(), 30);
    });
  }

  // ---------- Fon listesi (herkese açık veri; internetsiz de çalışsın diye saklanır) ----------
  function validCatalog(d) {
    if (!d || d.format !== 1 || !Array.isArray(d.funds) || !d.funds.length || !/^\d{4}-\d{2}-\d{2}$/.test(d.updated || '')) return null;
    const seen = new Set(), out = [];
    for (const f0 of d.funds) {
      const f = Object.assign({}, f0);
      f.code = String(f.code || '').trim().toLocaleUpperCase('tr-TR');
      if (!/^[\p{L}\p{N}]{1,10}$/u.test(f.code) || seen.has(f.code)) return null;
      for (const k of ['lastPrice', 'price1609']) if (f[k] != null && !(f[k] > 0 && isFinite(f[k]))) return null;
      if (f.valuation != null && !(f.valuation >= 0 && isFinite(f.valuation))) return null;
      if (f.source && !/^https:\/\//i.test(f.source)) delete f.source;
      seen.add(f.code); out.push(f);
    }
    return { updated: d.updated, funds: out };
  }
  function bundledCatalog() {
    return { updated: '2026-11-14', bundled: true, funds: (window.FON_LISTESI || []).map(f => ({ code: f.c, name: f.n, price1609: f.p > 0 ? f.p : undefined })) };
  }
  async function refreshCatalog(force) {
    if (!navigator.onLine && !force) return false;
    try {
      const c = validCatalog(await window.FonVeri.load());
      if (c && (!catalog.updated || c.updated >= catalog.updated || catalog.bundled)) {
        catalog = c; await D.saveCatalog(c); return true;
      }
    } catch (e) { /* internet yoksa saklı liste kullanılır */ }
    return false;
  }
  const pdfFunds = () => funds().map(f => ({ c: f.code, n: f.name || '', p: H.referencePrice(f) || 0 }));

  // ---------- Yönlendirme ----------
  function route() {
    const h = decodeURIComponent(location.hash.slice(1) || 'ozet');
    const [path, q] = h.split('?');
    const parts = path.split('/');
    const query = Object.fromEntries(new URLSearchParams(q || ''));
    return { name: parts[0] || 'ozet', parts, query };
  }
  const TABS = { ozet: 'ozet', fonlar: 'fonlar', fon: 'fonlar', ekle: 'ekle', aktar: 'ekle', dava: 'dava', yedek: 'yedek', ayarlar: 'ayarlar' };
  let lastRoute = '';
  function render() {
    if (!ledger) return;
    const r = route();
    const p = profile();
    $('#whoName').textContent = p.name;
    $('#whoAv').textContent = initials(p.name);
    $('#whoAv').style.background = COLORS[(p.colorIndex || 0) % COLORS.length];
    $$('.d-tabs a').forEach(a => { if (a.dataset.tab === (TABS[r.name] || 'ozet')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const view = VIEWS[r.name] || VIEWS.ozet;
    app.innerHTML = view.html(r);
    if (view.bind) view.bind(r);
    const key = location.hash;
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
  }

  // ---------- Ortak parçalar ----------
  function positions() { return H.activePositions(funds(), profile()); }
  function backupDue() {
    if (!ledger.profiles.some(hasRecords)) return false;
    if (!meta.lastBackupAt) return true;
    const days = (Date.now() - Date.parse(meta.lastBackupAt)) / 86400000;
    return (meta.changesSinceBackup || 0) >= 20 || (days >= 7 && (meta.changesSinceBackup || 0) > 0);
  }
  function lastBackupText() {
    if (!meta.lastBackupAt) return 'Henüz yedek alınmadı.';
    const d = new Date(meta.lastBackupAt);
    return 'Son yedek: ' + d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      + ((meta.changesSinceBackup || 0) > 0 ? ` · sonra ${meta.changesSinceBackup} değişiklik yapıldı` : '');
  }
  const backupBanner = () => backupDue() ? `<div class="warnbox banner"><span><b>Yedek al.</b> ${esc(lastBackupText())} Tarayıcı verisi silinirse defter de gider; yedek dosyası kalır.</span><a class="btn primary small" href="#yedek">Yedek al</a></div>` : '';
  const fundName = f => f && f.name ? f.name : '';
  const sideTag = s => s === H.BUY ? '<span class="tag buy">Alış</span>' : '<span class="tag sell">Satış</span>';
  const tradeLine = t => H.isAmountOnly(t) ? `${tl(t.enteredAmount)} <span class="tag">yalnızca tutar</span>` : `${plain.format(t.units)} × ${plain.format(t.unitPrice)} = ${tl(H.amountOf(t))}`;

  // ---------- Özet ----------
  const VIEWS = {};
  VIEWS.ozet = {
    html() {
      const p = profile();
      if (!hasRecords(p)) return emptyHTML();
      const pos = positions();
      const s = H.summary(pos, basis());
      const sel = heroBasis();
      const r = H.recovery(pos, sel);
      const unitsMissing = pos.some(x => x.unitsUnknown);
      const after = H.tradesAfterReference(p);
      const missingPrice = pos.filter(x => x.missingPrice1609);
      const unknownUnits = pos.filter(x => x.unitsUnknown);
      const bars = pos.filter(x => x.remainingUnits > 0 || x.unitsUnknown).sort((a, b) => b.value1609 - a.value1609).slice(0, 8);
      const recent = H.paymentAnalyses(pos, p.payments).slice(-5).reverse();
      const basisNote = (sel === 'net') !== (basis() === 'Net yatırım')
        ? `<div class="foot">Dava hesabı ${esc(basis().toLocaleLowerCase('tr-TR'))} esasına göre yapılıyor (Ayarlar).</div>` : '';
      const headline = r.isBaseNonPositive ? 'Esas sıfır: satışlarla geri alınmış' : r.isComplete ? 'Tamamı geri geldi' : 'Geri gelen';
      return `
        ${backupBanner()}
        <section class="hero-card" aria-label="Kalan alacak">
          <div class="lbl">Kalan alacağım</div>
          <div class="seg" role="group" aria-label="Hesap esası">
            <button type="button" data-hb="1609" aria-pressed="${sel === '1609'}">16.09 değerine göre</button>
            <button type="button" data-hb="net" aria-pressed="${sel === 'net'}">Net yatırıma göre</button>
          </div>
          <div class="amt">${tl(r.remaining)}</div>
          <div class="row"><span>${headline}</span><span>${r.isBaseNonPositive ? '' : pct(r.ratio, 1)}</span></div>
          <div class="bar"><i style="width:${(r.fraction * 100).toFixed(1)}%"></i></div>
          <div class="detail">Alınan ${tl(r.received)} · ${sel === 'net' ? 'net yatırım' : '16.09 değeri'} ${tl(r.base)}</div>
          ${basisNote}
        </section>
        <div class="grid2">
          <div class="tile"><div class="t">Net yatırım</div><div class="v">${tl(s.totalNetInvestment)}</div><div class="c">yatırılan − çekilen</div></div>
          <div class="tile"><div class="t">16.09.2026 değeri</div><div class="v">${tl(s.totalValue1609)}</div><div class="c">${unitsMissing ? 'eksik: adedi girilmeyen fon var' : 'kalan adet × fiyat'}</div></div>
          <div class="tile"><div class="t">Kâr / zarar</div><div class="v ${unitsMissing ? '' : s.profitLoss < 0 ? 'neg' : 'pos'}">${unitsMissing ? '–' : tl(s.profitLoss)}</div><div class="c">${unitsMissing ? '16.09 adedi girilince' : '16.09 değeri − net yatırım'}</div></div>
          <div class="tile"><div class="t">Alınan ödemeler</div><div class="v">${tl(s.totalReceived)}</div><div class="c">tasfiyeden gelen</div></div>
        </div>
        ${after.length ? `<div class="warnbox"><b>16.09.2026'dan sonra tarihli ${after.length} işlem var.</b> Tasfiye kararından sonraki alım-satımlar normalde olmaz; tarihleri kontrol et. Tasfiyeden gelen paraları işlem olarak değil, ödeme olarak gir.</div>` : ''}
        ${missingPrice.length ? `<div class="warnbox"><b>16.09 fiyatı yok:</b> ${missingPrice.map(x => `<a href="#fon/${esc(x.fund.code)}">${esc(x.fund.code)}</a>`).join(', ')}. Fon sayfasından ekstrendeki 16.09 fiyatını gir; girilene kadar 16.09 değeri 0 sayılır.</div>` : ''}
        ${unknownUnits.length ? `<div class="warnbox"><b>16.09'daki adet eksik:</b> ${unknownUnits.map(x => `<a href="#fon/${esc(x.fund.code)}">${esc(x.fund.code)}</a>`).join(', ')}. Bu fonlarda yalnızca tutarla girilen işlem var; 16.09 değeri için fon sayfasından adedi gir.</div>` : ''}
        ${bars.length ? `<h2>Fon bazında alınan ve kalan</h2>
        <ul class="list">${bars.map(x => {
          const fr = H.fundRecovery(x, sel);
          return `<li><a class="it fundbar" href="#fon/${esc(x.fund.code)}" style="display:block">
            <div class="top"><span><b>${esc(x.fund.code)}</b> <small class="muted">${esc(fundName(x.fund)).slice(0, 40)}</small></span><span>${tl(fr.remaining)}</span></div>
            <div class="bar dark"><i style="width:${(fr.fraction * 100).toFixed(1)}%"></i></div>
            <div class="sum-line"><span>Alınan ${tl(fr.received)}</span><span>${fr.isBaseNonPositive ? '' : pct(fr.ratio)} geri geldi</span></div></a></li>`;
        }).join('')}</ul>` : ''}
        ${recent.length ? `<h2>Son ödemeler</h2><ul class="list">${recent.map(a => `<li><a class="it" href="#ekle/odeme/${esc(a.payment.id)}">
          <span class="l"><b>${esc(a.payment.fundCode)} · ${esc(a.payment.kind || 'Ödeme')}</b><small>${showDay(dayOf(a.payment.date))}${a.payment.broker ? ' · ' + esc(a.payment.broker) : ''}</small></span>
          <span class="r">${tl(a.payment.amount)}${a.toValue1609 != null ? `<small>16.09 değerinin ${pct(a.toValue1609)}</small>` : ''}</span></a></li>`).join('')}</ul>` : ''}
        <p class="foot-note">Hukuki ya da yatırım tavsiyesi değildir. Resmî tutarları tasfiye süreci belirler; buradaki rakam kontrol amaçlıdır.</p>`;
    },
    bind() {
      $$('[data-hb]').forEach(b => b.onclick = async () => { meta.heroBasis = b.dataset.hb; await D.setMeta({ heroBasis: b.dataset.hb }); render(); });
    },
  };
  function emptyHTML() {
    return `${backupBanner()}<div class="box empty">
      <svg viewBox="0 0 100 106" aria-hidden="true"><path d="M50 3 92 17v35c0 28-20 42-42 51C28 94 8 80 8 52V17Z" fill="currentColor"/><g fill="var(--surface)"><rect x="30" y="34" width="40" height="6" rx="3"/><rect x="30" y="47" width="40" height="6" rx="3"/><rect x="30" y="60" width="27" height="6" rx="3"/></g></svg>
      <h1>Henüz kayıt yok</h1>
      <p class="muted">Tasfiyedeki fonlardaki alım-satımlarını ve tasfiyeden gelen ödemeleri ekle; defter net yatırımını, 16.09.2026 değerini ve kalan alacağını hesaplasın. Excel, CSV ya da aracı kurum PDF ekstren varsa doğrudan içe aktarabilirsin.</p>
      <div class="actions" style="flex-direction:column">
        <a class="btn primary" href="#ekle">İşlem ekle</a>
        <a class="btn ghost" href="#aktar">Excel, CSV ya da PDF'ten içe aktar</a>
        <a class="btn ghost" href="#yedek">Yedeği geri yükle (iPhone'dan da olur)</a>
      </div>
      <p class="small muted" style="margin-top:14px">Kayıtların yalnızca bu cihazda, bu tarayıcıda kalır; hiçbir yere gönderilmez.</p>
    </div>`;
  }

  // ---------- Fonlarım ----------
  VIEWS.fonlar = {
    html() {
      const pos = positions();
      const sel = heroBasis();
      if (!pos.length) return `<h1>Fonlarım</h1>${emptyHTML()}`;
      const list = pos.slice().sort((a, b) => H.fundRecovery(b, sel).remaining - H.fundRecovery(a, sel).remaining || a.fund.code.localeCompare(b.fund.code));
      return `<h1>Fonlarım</h1>
        <p class="muted small">Kalan alacak ${sel === 'net' ? 'net yatırıma' : '16.09 değerine'} göre gösteriliyor (Özet'teki seçime göre).</p>
        <ul class="list">${list.map(x => {
          const fr = H.fundRecovery(x, sel);
          const flags = [x.missingPrice1609 ? '<span class="tag warn">16.09 fiyatı yok</span>' : '', x.unitsUnknown ? '<span class="tag warn">adet eksik</span>' : ''].join(' ');
          return `<li><a class="it" href="#fon/${esc(x.fund.code)}">
            <span class="l"><b>${esc(x.fund.code)} ${flags}</b><small>${esc(fundName(x.fund) || 'Listede olmayan fon')}</small></span>
            <span class="r"><b>${tl(fr.remaining)}</b><small>net yatırım ${tl(x.netInvestment)}</small></span>
            <span class="chev" aria-hidden="true">›</span></a></li>`;
        }).join('')}</ul>
        <div class="actions"><a class="btn ghost" href="#ekle">İşlem ya da ödeme ekle</a></div>`;
    },
  };

  // ---------- Fon sayfası ----------
  VIEWS.fon = {
    html(r) {
      const code = r.parts[1];
      const p = profile();
      const pos = H.positions(funds(), p).find(x => x.fund.code === code);
      if (!pos) return `<p>Fon bulunamadı.</p><a href="#fonlar">Fonlarım</a>`;
      const f = pos.fund, ov = p.overrides[code] || {};
      const trades = p.trades.filter(t => t.fundCode === code).sort((a, b) => b.date.localeCompare(a.date));
      const pays = p.payments.filter(t => t.fundCode === code).sort((a, b) => b.date.localeCompare(a.date));
      const ref = H.referencePrice(f), refDay = H.referencePriceDate(f);
      const priceSrc = ov.userPrice != null ? 'senin girdiğin (ekstre) fiyat'
        : ref != null ? (f.price1609 > 0 ? (f.price1609Source === 'derleme' ? '16.09 fiyatı (TEFAS verisini aktaran derleme)' : '16.09 fiyatı (TEFAS)') : `son fiyat (${showDay(refDay) || 'tarihsiz'})`) : 'fiyat yok';
      return `<p><a href="#fonlar">‹ Fonlarım</a></p>
        <h1>${esc(code)}</h1>
        ${f.name ? `<p class="muted" style="margin-top:-8px">${esc(f.name)}${f.status ? ` · <span class="chip">${esc(f.status)}</span>` : ''}</p>` : '<p class="muted" style="margin-top:-8px">Listede olmayan fon</p>'}
        ${pos.missingPrice1609 ? '<div class="warnbox"><b>16.09 fiyatı yok.</b> Ekstrendeki 16.09.2026 birim fiyatını aşağıya gir; girilene kadar 16.09 değeri 0 sayılır.</div>' : ''}
        ${pos.unitsUnknown ? '<div class="warnbox"><b>16.09\'daki adet eksik.</b> Bu fonda yalnızca tutarla girilen işlem var. 16.09 değerini hesaplamak için o gün elinde kalan toplam adedi aşağıya gir.</div>' : ''}
        <div class="box"><div class="kv">
          <span>16.09 fiyatı<small>${esc(priceSrc)}</small></span><span class="v">${pos.priceUsed > 0 ? plain.format(pos.priceUsed) : '–'}</span>
          <span>16.09'da kalan adet</span><span class="v">${pos.unitsUnknown ? '–' : plain.format(pos.remainingUnits)}</span>
          <span>16.09.2026 değeri</span><span class="v">${tl(pos.value1609)}</span>
          <span class="sep"></span>
          <span>Net yatırım</span><span class="v">${tl(pos.netInvestment)}</span>
          ${Math.abs(pos.netInvestment - pos.netInvestmentNetted) > 0.005 ? `<span class="muted">Çaprazlama yapılırsa</span><span class="v muted">${tl(pos.netInvestmentNetted)}</span>` : ''}
          <span>Alınan ödemeler</span><span class="v">${tl(pos.paymentsReceived)}</span>
          ${pos.expectedPayment ? `<span>Beklenen ödeme</span><span class="v">${tl(pos.expectedPayment)}</span>` : ''}
          <span class="sep"></span>
          <span>Kalan (16.09 değerine göre)</span><span class="v">${tl(pos.remainingClaim1609)}</span>
          <span>Kalan (net yatırıma göre)</span><span class="v">${tl(pos.remainingClaimNet)}</span>
          ${pos.unitsUnknown ? '' : `<span>Kâr / zarar</span><span class="v ${pos.profitLoss < 0 ? 'neg' : 'pos'}">${tl(pos.profitLoss)}</span>`}
        </div></div>
        ${pos.hasMultipleBrokers ? `<h3>Aracı kurumlara göre</h3><div class="table-wrap"><table class="mini"><thead><tr><th>Kurum</th><th class="n">Net yatırım</th><th class="n">Gelen ödeme</th></tr></thead><tbody>
          ${pos.parts.map(b => `<tr><td>${esc(b.name || 'belirtilmemiş')}</td><td class="n">${tl(b.amountBought - b.amountSold)}${b.amountBought - b.amountSold < 0 ? ' <span class="tag warn">0 sayılır</span>' : ''}</td><td class="n">${tl(b.paymentsReceived)}</td></tr>`).join('')}
          ${pos.unassignedPayments ? `<tr><td>Kurumu eşleşmeyen ödeme</td><td></td><td class="n">${tl(pos.unassignedPayments)}</td></tr>` : ''}
          </tbody></table></div>` : ''}
        <h2>İşlemler (${trades.length})</h2>
        ${trades.length ? `<ul class="list">${trades.map(t => `<li><a class="it" href="#ekle/islem/${esc(t.id)}">
          <span class="l"><b>${sideTag(t.side)} ${showDay(dayOf(t.date))}</b><small>${tradeLine(t)}${t.broker ? ' · ' + esc(t.broker) : ''}${t.note ? ' · ' + esc(t.note) : ''}</small></span><span class="chev">›</span></a></li>`).join('')}</ul>` : '<p class="muted">İşlem yok.</p>'}
        <div class="actions"><a class="btn ghost small" href="#ekle?tur=islem&fon=${encodeURIComponent(code)}">İşlem ekle</a></div>
        <h2>Ödemeler (${pays.length})</h2>
        ${pays.length ? `<ul class="list">${pays.map(x => `<li><a class="it" href="#ekle/odeme/${esc(x.id)}">
          <span class="l"><b>${showDay(dayOf(x.date))} · ${esc(x.kind || 'Ödeme')}</b><small>${x.broker ? esc(x.broker) : 'aracı kurum belirtilmemiş'}${x.note ? ' · ' + esc(x.note) : ''}</small></span><span class="r">${tl(x.amount)}</span></a></li>`).join('')}</ul>` : '<p class="muted">Ödeme yok.</p>'}
        <div class="actions"><a class="btn ghost small" href="#ekle?tur=odeme&fon=${encodeURIComponent(code)}">Ödeme ekle</a></div>
        <h2>Bu fon için bilgilerin</h2>
        <form class="box form" id="ovForm">
          <div class="two">
            <div class="f"><label for="ovPrice">Ekstrendeki 16.09 fiyatı</label><input id="ovPrice" inputmode="decimal" placeholder="${ref != null ? esc(numOut(ref)) : 'yok'}" value="${esc(numOut(ov.userPrice))}"></div>
            <div class="f"><label for="ovUnits">16.09'daki toplam adet</label><input id="ovUnits" inputmode="decimal" placeholder="${esc(numOut(pos.tradedRemainingUnits))}" value="${esc(numOut(ov.units1609))}"></div>
          </div>
          <div class="f"><label for="ovExp">Beklenen ödeme (TL)</label><input id="ovExp" inputmode="decimal" placeholder="0" value="${esc(numOut(ov.expectedPayment))}"><div class="hint">Henüz gelmemiş ama tasfiyeden beklenen tutar. Kalan alacaktan düşülür.</div></div>
          <div class="f"><label for="ovNote">Not</label><textarea id="ovNote" maxlength="2000">${esc(ov.note || '')}</textarea></div>
          <div class="hint">Boş bırakılan alan kullanılmaz: fiyat boşsa listedeki fiyat, adet boşsa işlemlerden hesaplanan adet geçerlidir.</div>
          <button class="btn primary" type="submit">Kaydet</button>
        </form>
        ${f.note || f.valuation ? `<div class="box small">${f.note ? `<p>${esc(f.note)}</p>` : ''}${f.valuation ? `<p class="muted">Son tasfiye değerlemesi: ${plain.format(f.valuation)}${f.valuationDate ? ' (' + showDay(f.valuationDate) + ')' : ''}. Bilgi amaçlı; hesapta kullanılmaz.</p>` : ''}${f.source ? `<p><a href="${esc(f.source)}" rel="noopener noreferrer" target="_blank">Kaynak</a></p>` : ''}</div>` : ''}
        <div class="actions" style="margin-top:22px"><button class="btn ghost" type="button" id="rmFund" style="color:#b23a2e">Bu fonu defterden kaldır</button></div>`;
    },
    bind(r) {
      const code = r.parts[1];
      const form = $('#ovForm');
      if (form) form.onsubmit = async e => {
        e.preventDefault();
        const vals = { userPrice: $('#ovPrice').value, units1609: $('#ovUnits').value, expectedPayment: $('#ovExp').value };
        const ov = {};
        for (const [k, v] of Object.entries(vals)) {
          if (!v.trim()) continue;
          const n = numIn(v);
          if (n == null || n < 0) { await dialog({ title: 'Sayı okunamadı', body: esc(v) + ' bir sayı değil.' }); return; }
          if (k === 'userPrice' && n === 0) continue;
          ov[k] = n;
        }
        const note = $('#ovNote').value.trim();
        if (note) ov.note = note;
        await commit(l => {
          const p = l.profiles.find(x => x.id === l.activeProfileID);
          const old = p.overrides[code] || {};
          const merged = Object.assign({}, old); ['userPrice', 'units1609', 'expectedPayment', 'note'].forEach(k => delete merged[k]);
          Object.assign(merged, ov);
          if (Object.keys(merged).length) p.overrides[code] = merged; else delete p.overrides[code];
        }, { toast: code + ' bilgileri kaydedildi.' });
      };
      const rm = $('#rmFund');
      if (rm) rm.onclick = async () => {
        const p = profile();
        const nt = p.trades.filter(t => t.fundCode === code).length, np = p.payments.filter(t => t.fundCode === code).length;
        const ok = await dialog({ title: code + ' defterden kaldırılsın mı?', body: `${nt} işlem, ${np} ödeme ve bu fon için girdiğin bilgiler silinir. Hemen ardından "Geri al" ile vazgeçebilirsin.`, ok: 'Kaldır', cancel: 'Vazgeç', danger: true });
        if (!ok) return;
        await commit(l => {
          const q = l.profiles.find(x => x.id === l.activeProfileID);
          q.trades = q.trades.filter(t => t.fundCode !== code); q.payments = q.payments.filter(t => t.fundCode !== code); delete q.overrides[code];
        }, { toast: code + ' kaldırıldı.', go: '#fonlar' });
      };
    },
  };

  // ---------- Kayıt ekleme / düzenleme ----------
  function fundOptions() {
    return `<datalist id="fonListe">${funds().map(f => `<option value="${esc(f.code)}">${esc(f.name || '')}</option>`).join('')}</datalist>`;
  }
  function brokerOptions() {
    const set = new Set();
    ledger.profiles.forEach(p => p.trades.concat(p.payments).forEach(t => { const b = H.brokerClean(t.broker); if (b) set.add(b); }));
    return `<datalist id="kurumListe">${[...set].sort((a, b) => a.localeCompare(b, 'tr')).map(b => `<option value="${esc(b)}">`).join('')}</datalist>`;
  }
  VIEWS.ekle = {
    html(r) {
      const p = profile();
      const editKind = r.parts[1], editId = r.parts[2];
      let kind = editKind === 'odeme' || r.query.tur === 'odeme' ? 'odeme' : 'islem';
      let rec = null;
      if (editId) {
        rec = (kind === 'odeme' ? p.payments : p.trades).find(x => x.id === editId);
        if (!rec) return '<p>Kayıt bulunamadı (başka bir kişinin defterinde olabilir).</p><a href="#ozet">Özet</a>';
      }
      const st = this.state = { kind, rec, side: rec ? rec.side : H.BUY, mode: rec && H.isAmountOnly(rec) ? 'tutar' : 'adet' };
      const code = rec ? rec.fundCode : (r.query.fon || '');
      const day = rec ? dayOf(rec.date) : todayDay();
      const title = rec ? (kind === 'odeme' ? 'Ödemeyi düzenle' : 'İşlemi düzenle') : 'Yeni kayıt';
      return `<h1>${title}</h1>
        ${rec ? '' : `<div class="seg2" role="group" aria-label="Kayıt türü"><button type="button" data-kind="islem" aria-pressed="${kind === 'islem'}">Alış / satış</button><button type="button" data-kind="odeme" aria-pressed="${kind === 'odeme'}">Tasfiye ödemesi</button></div>`}
        <form class="form" id="recForm" style="margin-top:14px" novalidate>
          ${fundOptions()}${brokerOptions()}
          <div class="two">
            <div class="f"><label for="fCode">Fon kodu</label><input id="fCode" list="fonListe" autocomplete="off" autocapitalize="characters" placeholder="ör. TLY" value="${esc(code)}" required><div class="hint" id="fName"></div></div>
            <div class="f"><label for="fDate">Tarih</label><input id="fDate" type="date" value="${esc(day)}" required></div>
          </div>
          <div id="tradeFields" ${kind === 'islem' ? '' : 'hidden'}>
            <div class="form">
              <div class="seg2" role="group" aria-label="İşlem"><button type="button" data-side="${H.BUY}" aria-pressed="${st.side === H.BUY}">Alış</button><button type="button" data-side="${H.SELL}" aria-pressed="${st.side === H.SELL}">Satış</button></div>
              <div class="seg2" role="group" aria-label="Giriş biçimi"><button type="button" data-mode="adet" aria-pressed="${st.mode === 'adet'}">Adet ve fiyatla</button><button type="button" data-mode="tutar" aria-pressed="${st.mode === 'tutar'}">Yalnızca tutarla</button></div>
              <div class="two" id="unitFields" ${st.mode === 'adet' ? '' : 'hidden'}>
                <div class="f"><label for="fUnits">Adet</label><input id="fUnits" inputmode="decimal" value="${rec && !H.isAmountOnly(rec) ? esc(numOut(rec.units)) : ''}"></div>
                <div class="f"><label for="fPrice">Birim fiyat (TL)</label><input id="fPrice" inputmode="decimal" value="${rec && !H.isAmountOnly(rec) ? esc(numOut(rec.unitPrice)) : ''}"></div>
              </div>
              <div class="f" id="amtField" ${st.mode === 'tutar' ? '' : 'hidden'}><label for="fAmt">Tutar (TL)</label><input id="fAmt" inputmode="decimal" value="${rec && H.isAmountOnly(rec) ? esc(numOut(rec.enteredAmount)) : ''}"><div class="hint">Adet ve fiyatı bilmiyorsan: net yatırım için yeter; 16.09 değeri için fon sayfasından 16.09'daki adedi gir.</div></div>
              <div class="okbox" id="calcOut" hidden></div>
            </div>
          </div>
          <div id="payFields" ${kind === 'odeme' ? '' : 'hidden'} class="form">
            <div class="two">
              <div class="f"><label for="pAmt">Tutar (TL)</label><input id="pAmt" inputmode="decimal" value="${rec && kind === 'odeme' ? esc(numOut(rec.amount)) : ''}"></div>
              <div class="f"><label for="pKind">Tür</label><select id="pKind">${['Ara ödeme', 'Nihai ödeme', 'Diğer'].map(k => `<option${(rec && rec.kind || 'Ara ödeme') === k ? ' selected' : ''}>${k}</option>`).join('')}${rec && rec.kind && !['Ara ödeme', 'Nihai ödeme', 'Diğer'].includes(rec.kind) ? `<option selected>${esc(rec.kind)}</option>` : ''}</select></div>
            </div>
            <div class="hint">Ödemeler net yatırımı değiştirmez; kalan alacaktan düşülür. Aracı kurumu yazarsan ödeme o kurumdaki alacaktan düşülür; boş bırakırsan fonun toplamından.</div>
          </div>
          <div class="f"><label for="fBroker">Aracı kurum (isteğe bağlı)</label><input id="fBroker" list="kurumListe" autocomplete="off" value="${esc(rec && rec.broker || '')}"></div>
          <div class="f"><label for="fNote">Not (isteğe bağlı)</label><input id="fNote" autocomplete="off" maxlength="500" value="${esc(rec && rec.note || '')}"></div>
          <div class="warnbox" id="formErr" hidden></div>
          <div class="actions"><button class="btn primary big" type="submit">Kaydet</button></div>
          ${rec ? `<div class="actions"><button class="btn ghost" type="button" id="delRec" style="color:#b23a2e">${kind === 'odeme' ? 'Ödemeyi sil' : 'İşlemi sil'}</button></div>` : ''}
        </form>
        ${rec ? '' : `<div class="box" style="margin-top:22px"><b>Dosyan mı var?</b><p class="muted small">Excel, CSV ya da aracı kurum PDF ekstrelerini tek seferde içe aktar.</p><a class="btn ghost small" href="#aktar">Dosyadan içe aktar</a></div>`}`;
    },
    bind() {
      const st = this.state;
      if (!st) return;
      const setPressed = (sel, attr, v) => $$(sel).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === v)));
      $$('[data-kind]').forEach(b => b.onclick = () => { st.kind = b.dataset.kind; setPressed('[data-kind]', 'kind', st.kind); $('#tradeFields').hidden = st.kind !== 'islem'; $('#payFields').hidden = st.kind !== 'odeme'; });
      $$('[data-side]').forEach(b => b.onclick = () => { st.side = b.dataset.side; setPressed('[data-side]', 'side', st.side); });
      $$('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; setPressed('[data-mode]', 'mode', st.mode); $('#unitFields').hidden = st.mode !== 'adet'; $('#amtField').hidden = st.mode !== 'tutar'; calc(); });
      const showName = () => {
        const c = IA.resolveFundCode($('#fCode').value, codeSet());
        const f = c && fundBy(c);
        $('#fName').textContent = f ? (f.name || c) : c ? 'Listede yok; kendi fonun olarak eklenir.' : '';
      };
      const calc = () => {
        const u = numIn($('#fUnits').value), pr = numIn($('#fPrice').value), out = $('#calcOut');
        out.hidden = !(st.mode === 'adet' && u > 0 && pr > 0);
        if (!out.hidden) out.textContent = 'Tutar: ' + tl(u * pr);
      };
      $('#fCode').oninput = showName; showName();
      $('#fUnits').oninput = calc; $('#fPrice').oninput = calc; calc();
      const err = msg => { const e = $('#formErr'); e.hidden = !msg; e.innerHTML = msg || ''; if (msg) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      $('#recForm').onsubmit = async e => {
        e.preventDefault();
        const code = IA.resolveFundCode($('#fCode').value, codeSet());
        const day = $('#fDate').value;
        if (!code) return err('Fon kodunu yaz (ör. TLY).');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err('Tarihi seç.');
        const broker = H.brokerClean($('#fBroker').value), note = $('#fNote').value.trim() || null;
        const base = st.rec ? clone(st.rec) : { id: D.uuid() };
        base.date = st.rec && dayOf(st.rec.date) === day ? st.rec.date : H.dayISO(day);
        base.fundCode = code;
        if (broker) base.broker = broker; else delete base.broker;
        if (note) base.note = note; else delete base.note;
        let rec;
        if (st.kind === 'islem') {
          rec = base; rec.side = st.side;
          if (st.mode === 'adet') {
            const u = numIn($('#fUnits').value), pr = numIn($('#fPrice').value);
            if (!(u > 0) || !(pr > 0)) return err('Adet ve birim fiyatı yaz (sıfırdan büyük).');
            rec.units = u; rec.unitPrice = pr; delete rec.enteredAmount;
          } else {
            const a = numIn($('#fAmt').value);
            if (!(a > 0)) return err('Tutarı yaz (sıfırdan büyük).');
            rec.units = 0; rec.unitPrice = 0; rec.enteredAmount = a;
          }
          delete rec.amount; delete rec.kind;
        } else {
          const a = numIn($('#pAmt').value);
          if (!(a > 0)) return err('Ödeme tutarını yaz (sıfırdan büyük).');
          rec = base; rec.amount = a; rec.kind = $('#pKind').value;
          ['side', 'units', 'unitPrice', 'enteredAmount'].forEach(k => delete rec[k]);
        }
        if (st.kind === 'islem' && day > H.REFERENCE_DAY) {
          const ok = await dialog({ title: '16.09.2026\'dan sonraki tarih', body: 'Tasfiye kararından sonra alım-satım normalde olmaz. Tasfiyeden gelen bir paraysa "Tasfiye ödemesi" olarak gir. Yine de işlem olarak kaydedilsin mi?', ok: 'Kaydet', cancel: 'Vazgeç' });
          if (!ok) return;
        }
        const isNew = !st.rec;
        await commit(l => {
          const p = l.profiles.find(x => x.id === l.activeProfileID);
          if (!l.customFunds.some(f => f.code === code) && !catalog.funds.some(f => f.code === code)) l.customFunds.push({ code });
          const arr = st.kind === 'islem' ? p.trades : p.payments;
          if (st.rec && st.rec.fundCode !== undefined) {
            // Tür değişmediyse yerinde güncelle.
            const i = arr.findIndex(x => x.id === rec.id);
            if (i >= 0) { arr[i] = rec; return; }
          }
          arr.push(rec);
        }, { toast: isNew ? (st.kind === 'islem' ? 'İşlem kaydedildi.' : 'Ödeme kaydedildi.') : 'Değişiklik kaydedildi.', go: '#fon/' + encodeURIComponent(code) });
      };
      const del = $('#delRec');
      if (del) del.onclick = async () => {
        const id = st.rec.id, code = st.rec.fundCode;
        await commit(l => {
          const p = l.profiles.find(x => x.id === l.activeProfileID);
          p.trades = p.trades.filter(x => x.id !== id); p.payments = p.payments.filter(x => x.id !== id);
        }, { toast: st.kind === 'islem' ? 'İşlem silindi.' : 'Ödeme silindi.', go: '#fon/' + encodeURIComponent(code) });
      };
    },
  };

  // ---------- İçe aktarma ----------
  const imp = { sheets: null, file: '', v13: null, pdf: null, idx: 0, h: 0, map: {}, kind: 'trades', msg: '' };
  function targetHTML() {
    return `<div class="box form"><div class="f"><label for="tgt">Kimin defterine?</label><select id="tgt">
      ${ledger.profiles.map(p => `<option value="${esc(p.id)}"${p.id === ledger.activeProfileID ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">Yeni kişi…</option></select></div>
      <div class="f" id="tgtNameWrap" hidden><label for="tgtName">Yeni kişinin adı</label><input id="tgtName" placeholder="ör. Annem" maxlength="60"></div>
      <div class="f"><label for="tgtBroker">Aracı kurum (isteğe bağlı)</label><input id="tgtBroker" list="kurumListe" autocomplete="off"><div class="hint">Dosya tek bir aracı kurumun ekstresiyse yaz; aracı kurumu belirtilmemiş tüm kayıtlara eklenir.</div></div>
      ${brokerOptions()}</div>`;
  }
  function bindTarget() {
    const t = $('#tgt'); if (!t) return;
    t.onchange = () => { $('#tgtNameWrap').hidden = t.value !== '__new'; };
  }
  // Hedef kişiyi döndürür (yeniyse defterde oluşturur). Ad eksikse null.
  function resolveTarget(l) {
    const v = $('#tgt').value;
    if (v === '__new') {
      const name = $('#tgtName').value.trim();
      if (!name) return null;
      const p = D.newProfile(name, l.profiles.length % COLORS.length);
      l.profiles.push(p); return p;
    }
    return l.profiles.find(p => p.id === v) || l.profiles[0];
  }
  const tagBroker = (list, b) => b ? list.map(x => (x.broker ? x : Object.assign({}, x, { broker: b }))) : list;
  const toTrade = t => {
    const o = { id: D.uuid(), date: H.dayISO(t.day), fundCode: t.code, side: t.side === 'sell' ? H.SELL : H.BUY };
    if (t.amount != null && t.units == null) { o.units = 0; o.unitPrice = 0; o.enteredAmount = t.amount; } else { o.units = t.units; o.unitPrice = t.price; }
    if (t.note) o.note = t.note; const b = H.brokerClean(t.broker); if (b) o.broker = b;
    return o;
  };
  const toPayment = x => {
    const o = { id: D.uuid(), date: H.dayISO(x.day), fundCode: x.code, amount: x.amount };
    if (x.kind) o.kind = x.kind; if (x.note) o.note = x.note; const b = H.brokerClean(x.broker); if (b) o.broker = b;
    return o;
  };
  // GenericImporter.removingDuplicates
  function newTradesOnly(list, existing) {
    return list.filter(n => !existing.some(e => e.fundCode === n.fundCode && e.side === n.side && dayOf(e.date) === dayOf(n.date)
      && Math.abs(e.units - n.units) < 1e-6
      && (Math.abs(e.unitPrice - n.unitPrice) < 1e-6 || Math.abs(H.amountOf(e) - H.amountOf(n)) <= Math.max(0.02, H.amountOf(n) * 0.005))
      && H.brokerCompatible(e.broker, n.broker)));
  }
  function newPaymentsOnly(list, existing) {
    return list.filter(n => !existing.some(e => e.fundCode === n.fundCode && dayOf(e.date) === dayOf(n.date) && Math.abs(e.amount - n.amount) < 0.005 && H.brokerCompatible(e.broker, n.broker)));
  }

  VIEWS.aktar = {
    html() {
      let body = '';
      if (imp.v13) body = v13HTML();
      else if (imp.pdf) body = pdfHTML();
      else if (imp.sheets) body = genericHTML();
      return `<p><a href="#ekle">‹ Kayıt ekle</a></p><h1>Dosyadan içe aktar</h1>
        <label class="drop small" for="impFile">
          <span class="drop-title">Excel, CSV ya da PDF ekstre seç</span>
          <span class="muted small">Fon Mağduru Hesap Defteri (v1.x) Excel'i, aracı kurum dökümü ya da PDF ekstreler (birden çok PDF birlikte seçilebilir). Dosya bu cihazdan çıkmaz.</span>
          <input type="file" id="impFile" multiple accept=".xlsx,.xlsm,.csv,.txt,.tsv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        </label>
        <div id="impMsg" class="small" style="margin:10px 0">${imp.msg}</div>
        ${body}`;
    },
    bind() {
      $('#impFile').onchange = e => openImport([...e.target.files]);
      bindTarget();
      if (imp.v13) bindV13(); else if (imp.pdf) bindPDF(); else if (imp.sheets) bindGeneric();
    },
  };
  function resetImport() { Object.assign(imp, { sheets: null, file: '', v13: null, pdf: null, idx: 0, h: 0, map: {}, kind: 'trades', msg: '' }); }
  async function openImport(files) {
    resetImport();
    if (!files.length) { render(); return; }
    const setMsg = m => { imp.msg = m; const el = $('#impMsg'); if (el) el.innerHTML = m; };
    try {
      const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      if (files.length > 1 && pdfs.length !== files.length) throw new Error('Birden fazla dosya yalnızca PDF ekstreler için seçilebilir. Excel ya da CSV için tek dosya seç.');
      if (pdfs.length > 24) throw new Error('Tek seferde en fazla 24 PDF seçebilirsin.');
      if (files.length === 1) {
        setMsg(`${esc(files[0].name)} okunuyor…`);
        const r = await IA.readFile(files[0]);
        imp.file = files[0].name;
        if (r.kind === 'sheets') {
          const v = IA.v13(r.sheets, codeSet(), H.defaultParameters());
          if (v) { imp.v13 = v; setMsg(`<span class="okline">Fon Mağduru Hesap Defteri biçimi tanındı.</span> ${esc(files[0].name)} okundu; dosya bu cihazdan çıkmadı.`); render(); return; }
          imp.sheets = r.sheets;
          const codes = codeSet();
          let best = { i: 0, n: -1 };
          r.sheets.forEach((s, i) => { const h = IA.headerRow(s.rows); const m = IA.guess(s.rows, h, 'trades'); const n = IA.parseRecords(s.rows, h, m, 'trades', codes).trades.length; if (n > best.n) best = { i, n }; });
          selectSheet(best.i);
          setMsg(`<b>${esc(files[0].name)}</b> okundu; dosya bu cihazdan çıkmadı. Sütunları kontrol et.`);
          render(); return;
        }
        const list = [{ name: files[0].name, buf: r.buf }];
        return openPDFs(list, setMsg);
      }
      const list = [];
      for (const f of pdfs) { if (f.size > IA.MAX_FILE) throw new Error(`${f.name} çok büyük (en fazla 15 MB).`); list.push({ name: f.name, buf: await f.arrayBuffer() }); }
      return openPDFs(list, setMsg);
    } catch (e) {
      resetImport(); setMsg(`<span class="warnline">${esc(e.message || 'Dosya okunamadı.')}</span>`); render();
    }
  }
  async function openPDFs(list, setMsg) {
    const r = await IA.readPDFs(list, pdfFunds(), (k, name) => setMsg(`${list.length > 1 ? `${k + 1}/${list.length} · ` : ''}${esc(name)} okunuyor… (ilk PDF'te okuyucu birkaç saniyede yüklenir)`));
    imp.pdf = { rows: r.trades.map(t => Object.assign(t, { on: !!(t.code && t.side) })), info: r, names: list.map(x => x.name) };
    const bits = [`${list.length > 1 ? list.length + ' ekstre' : '<b>' + esc(list[0].name) + '</b>'} okundu (${r.pages} sayfa${r.brokers.size ? ', ' + esc([...r.brokers].join(', ')) : ''}). Dosya bu cihazdan çıkmadı.`];
    bits.push(r.trades.length ? `Tasfiyedeki fonlarda <b>${r.trades.length}</b> işlem bulundu; ekstrenle karşılaştır.` : 'Tasfiyedeki fonlarda işlem bulunamadı.');
    if (r.dup) bits.push(`Birden fazla ekstrede geçen ${r.dup} işlem bir kez sayıldı.`);
    if (r.others.size) bits.push(`Listede olmayan ${r.others.size} kıymet (ör. ${esc([...r.others].slice(0, 4).join(', '))}) alınmadı.`);
    if (r.unread) bits.push(`${r.unread} satır işleme çevrilemedi (virman, masraf, bakiye gibi).`);
    imp.msg = bits.join(' ');
    render();
  }

  // Hesap defteri (v1.x) Excel'i
  function v13HTML() {
    const v = imp.v13;
    const nPrice = Object.values(v.overrides).filter(o => o.userPrice != null).length;
    return `<div class="box"><div class="kv">
        <span>İşlem</span><span class="v">${v.trades.length}</span><span>Ödeme</span><span class="v">${v.payments.length}</span>
        <span>Kendi fiyatın girilmiş fon</span><span class="v">${nPrice}</span>
        ${v.customFunds.length ? `<span>Listeye eklenecek fon</span><span class="v">${v.customFunds.length}</span>` : ''}
        ${v.skippedSampleRows ? `<span class="muted">Atlanan örnek satır</span><span class="v muted">${v.skippedSampleRows}</span>` : ''}
      </div></div>
      ${v.warnings.length ? `<div class="warnbox"><b>Uyarılar</b><ul>${v.warnings.slice(0, 30).map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${targetHTML()}
      ${v.parameters ? '<label class="check box"><input type="checkbox" id="impParams" checked><span>Parametreleri de al<br><small class="muted">Kur, faiz, senaryo, masraf ve dava hesabı esası Excel\'deki gibi olur.</small></span></label>' : ''}
      ${v.trades.length || v.payments.length ? `<div class="warnbox" id="replaceNote" hidden></div><div class="actions"><button class="btn primary big" id="doV13">İçe aktar (${v.trades.length} işlem, ${v.payments.length} ödeme)</button></div>`
        : '<div class="okbox">Bu dosyada işlem ya da ödeme yok (yalnızca örnek satırlar var). Defterindeki kayıtlar olduğu gibi kalır.</div>' + (v.parameters ? '<div class="actions"><button class="btn ghost" id="doParams">Yalnızca parametreleri al</button></div>' : '')}`;
  }
  function bindV13() {
    const v = imp.v13;
    const note = () => {
      const t = $('#tgt').value, p = ledger.profiles.find(x => x.id === t), el = $('#replaceNote');
      if (!el) return;
      el.hidden = !(p && hasRecords(p));
      if (p) el.innerHTML = `<b>“${esc(p.name)}” içindeki mevcut ${p.trades.length} işlem, ${p.payments.length} ödeme ve fon notları, Excel'dekilerle değiştirilecek.</b> Diğer kişilerin defterlerine dokunulmaz. Önceki hâl otomatik kopya olarak saklanır.`;
    };
    $('#tgt').addEventListener('change', note); note();
    const go = async onlyParams => {
      const tgtVal = $('#tgt').value;
      if (tgtVal === '__new' && !$('#tgtName').value.trim()) { await dialog({ title: 'Yeni kişinin adını yaz.' }); return; }
      const existing = ledger.profiles.find(x => x.id === tgtVal);
      if (!onlyParams && existing && hasRecords(existing)) {
        const ok = await dialog({ title: 'Kayıtlar değiştirilsin mi?', body: `“${esc(existing.name)}” içindeki ${existing.trades.length} işlem ve ${existing.payments.length} ödeme silinip Excel'deki ${v.trades.length} işlem ve ${v.payments.length} ödeme alınacak.`, ok: 'Değiştir', cancel: 'Vazgeç', danger: true });
        if (!ok) return;
      }
      await D.snapshot(ledger, 'Excel içe aktarmadan önce');
      const broker = H.brokerClean($('#tgtBroker').value);
      const withParams = onlyParams || ($('#impParams') && $('#impParams').checked);
      let who = '';
      await commit(l => {
        const p = resolveTarget(l);
        who = p.name;
        if (!onlyParams) {
          p.trades = tagBroker(v.trades.map(toTrade), broker);
          p.payments = tagBroker(v.payments.map(toPayment), broker);
          p.overrides = clone(v.overrides);
          for (const f of v.customFunds) if (!l.customFunds.some(x => x.code === f.code)) l.customFunds.push(clone(f));
        }
        if (withParams && v.parameters) p.parameters = clone(v.parameters);
        l.activeProfileID = p.id;
      }, { toast: onlyParams ? `Parametreler alındı. Kayıtlar değişmedi.` : `${v.trades.length} işlem ve ${v.payments.length} ödeme alındı.`, go: '#ozet' });
      resetImport();
      void who;
    };
    const b = $('#doV13'); if (b) b.onclick = () => go(false);
    const bp = $('#doParams'); if (bp) bp.onclick = () => go(true);
  }

  // Genel tablo (aracı kurum dökümü, CSV)
  function selectSheet(i) {
    imp.idx = i;
    const rows = imp.sheets[i].rows;
    imp.h = IA.headerRow(rows);
    if (/ödeme|odeme/i.test(imp.sheets[i].name)) imp.kind = 'payments';
    imp.map = IA.guess(rows, imp.h, imp.kind);
  }
  function genericResult() {
    const rows = imp.sheets[imp.idx].rows;
    return IA.parseRecords(rows, imp.h, imp.map, imp.kind, codeSet());
  }
  function genericHTML() {
    const rows = imp.sheets[imp.idx].rows;
    const heads = rows[imp.h] || [];
    const ncol = rows.reduce((m, r) => Math.max(m, (r || []).length), 0);
    const letter = c => { let s = '', n = c + 1; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
    const opt = sel => '<option value="">—</option>' + Array.from({ length: ncol }, (_, c) => {
      const h = IA.cellString(heads[c]);
      return `<option value="${c}"${sel === c ? ' selected' : ''}>${esc(letter(c) + (h ? ' – ' + h.slice(0, 32) : ''))}</option>`;
    }).join('');
    const res = genericResult();
    const miss = IA.missing(imp.map, imp.kind);
    const n = imp.kind === 'trades' ? res.trades.length : res.payments.length;
    return `<div class="box form">
      ${imp.sheets.length > 1 ? `<div class="f"><label for="gSheet">Sayfa</label><select id="gSheet">${imp.sheets.map((s, i) => `<option value="${i}"${i === imp.idx ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
      <div class="f"><span class="lbl">Dosyadaki kayıtlar</span><div class="seg2"><button type="button" data-gk="trades" aria-pressed="${imp.kind === 'trades'}">Alış / satış</button><button type="button" data-gk="payments" aria-pressed="${imp.kind === 'payments'}">Tasfiye ödemeleri</button></div></div>
      <div class="f"><label for="gHead">Başlık satırı</label><select id="gHead">${rows.slice(0, 30).map((r, i) => `<option value="${i}"${i === imp.h ? ' selected' : ''}>${i + 1}. satır: ${esc((r || []).filter(x => x != null).slice(0, 4).map(x => String(x).slice(0, 14)).join(' · '))}</option>`).join('')}</select></div>
      <div class="two">${IA.FIELDS[imp.kind].map(f => `<div class="f"><label for="gm_${f}">${esc(IA.LABELS[f])}${f === 'date' || f === 'code' ? ' *' : ''}</label><select id="gm_${f}" data-gf="${f}">${opt(imp.map[f])}</select></div>`).join('')}</div>
      <div class="hint">Sütunlar başlıklara bakılarak tahmin edildi; yanlışsa buradan düzelt. ${imp.kind === 'trades' ? 'Tutar yoksa adet × birim fiyat kullanılır; yalnızca tutar varsa işlem tutarla kaydedilir. İşlem sütunu yoksa eksi tutar satış sayılır.' : ''}</div>
    </div>
    ${miss.length ? `<div class="warnbox"><b>Eksik sütun:</b> ${miss.map(f => esc(IA.LABELS[f])).join(', ')}</div>` : ''}
    <div class="okbox"><b>${n}</b> ${imp.kind === 'trades' ? 'işlem' : 'ödeme'} okunabildi.${res.unknownCodes.size ? ` Listede olmayan fon: ${esc([...res.unknownCodes].slice(0, 8).join(', '))} (kendi fonun olarak eklenir).` : ''}</div>
    ${res.skipped.length ? `<details class="box small"><summary>Alınmayan satır: ${res.skipped.length}</summary><ul>${res.skipped.slice(0, 60).map(([r, w]) => `<li>Satır ${r}: ${esc(w)}</li>`).join('')}</ul></details>` : ''}
    ${n ? previewTable(imp.kind === 'trades' ? res.trades : res.payments, imp.kind) : ''}
    ${targetHTML()}
    <div class="actions"><button class="btn primary big" id="doGeneric" ${n && !miss.length ? '' : 'disabled'}>Deftere ekle</button></div>
    <p class="hint">Defterde zaten olan kayıtlar (aynı gün, fon, tutar) ikinci kez eklenmez.</p>`;
  }
  function previewTable(list, kind) {
    const rows = list.slice(0, 8);
    return `<div class="table-wrap"><table class="mini"><thead><tr><th>Tarih</th><th>Fon</th>${kind === 'trades' ? '<th>İşlem</th><th class="n">Adet</th><th class="n">Fiyat</th>' : '<th>Tür</th>'}<th class="n">Tutar</th></tr></thead><tbody>
      ${rows.map(t => `<tr><td>${showDay(t.day)}</td><td>${esc(t.code)}</td>${kind === 'trades' ? `<td>${t.side === 'sell' ? 'Satış' : 'Alış'}</td><td class="n">${t.units != null ? plain.format(t.units) : '–'}</td><td class="n">${t.price != null ? plain.format(t.price) : '–'}</td><td class="n">${tl(t.amount != null && t.units == null ? t.amount : t.units * t.price)}</td>` : `<td>${esc(t.kind || '')}</td><td class="n">${tl(t.amount)}</td>`}</tr>`).join('')}
      ${list.length > rows.length ? `<tr><td colspan="6" class="muted">… ve ${list.length - rows.length} kayıt daha</td></tr>` : ''}</tbody></table></div>`;
  }
  function bindGeneric() {
    const s = $('#gSheet'); if (s) s.onchange = () => { selectSheet(+s.value); render(); };
    $$('[data-gk]').forEach(b => b.onclick = () => { imp.kind = b.dataset.gk; imp.map = IA.guess(imp.sheets[imp.idx].rows, imp.h, imp.kind); render(); });
    $('#gHead').onchange = e => { imp.h = +e.target.value; imp.map = IA.guess(imp.sheets[imp.idx].rows, imp.h, imp.kind); render(); };
    $$('[data-gf]').forEach(sel => sel.onchange = () => { if (sel.value === '') delete imp.map[sel.dataset.gf]; else imp.map[sel.dataset.gf] = +sel.value; render(); });
    $('#doGeneric').onclick = async () => {
      if ($('#tgt').value === '__new' && !$('#tgtName').value.trim()) { await dialog({ title: 'Yeni kişinin adını yaz.' }); return; }
      const res = genericResult(), broker = H.brokerClean($('#tgtBroker').value);
      await D.snapshot(ledger, 'Dosyadan içe aktarmadan önce');
      let added = 0, kind = imp.kind;
      await commit(l => {
        const p = resolveTarget(l);
        for (const code of res.unknownCodes) if (!l.customFunds.some(f => f.code === code)) l.customFunds.push({ code });
        if (kind === 'trades') { const n = newTradesOnly(tagBroker(res.trades.map(toTrade), broker), p.trades); p.trades.push(...n); added = n.length; }
        else { const n = newPaymentsOnly(tagBroker(res.payments.map(toPayment), broker), p.payments); p.payments.push(...n); added = n.length; }
        l.activeProfileID = p.id;
      }, { toast: `${added} ${kind === 'trades' ? 'işlem' : 'ödeme'} eklendi.`, go: '#ozet' });
      resetImport();
    };
  }

  // PDF ekstreler
  function pdfHTML() {
    const rows = imp.pdf.rows;
    if (!rows.length) return '';
    const codes = funds().map(f => f.code);
    return `<div class="table-wrap"><table class="mini"><thead><tr><th></th><th>Tarih</th><th>Fon</th><th>İşlem</th><th class="n">Adet</th><th class="n">Fiyat</th><th class="n">Tutar</th></tr></thead><tbody>
      ${rows.map((t, i) => `<tr><td><input type="checkbox" data-pon="${i}" ${t.on ? 'checked' : ''} aria-label="Bu satırı al"></td><td>${showDay(t.day)}</td>
        <td>${t.code ? esc(t.code) : `<select data-pcode="${i}"><option value="">?</option>${codes.map(c => `<option>${esc(c)}</option>`).join('')}</select>`}</td>
        <td><select data-pside="${i}"><option value=""${!t.side ? ' selected' : ''}>?</option><option value="buy"${t.side === 'buy' ? ' selected' : ''}>Alış</option><option value="sell"${t.side === 'sell' ? ' selected' : ''}>Satış</option></select></td>
        <td class="n">${plain.format(t.units)}</td><td class="n">${plain.format(t.price)}</td><td class="n">${tl(t.amount)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="hint">Fonu ya da Alış/Satış'ı belirsiz satırları seçip düzeltebilirsin. İşaretsiz satırlar alınmaz.</p>
      ${targetHTML()}
      <div class="actions"><button class="btn primary big" id="doPDF">Seçili işlemleri deftere ekle</button></div>
      <p class="hint">Defterde zaten olan işlemler ikinci kez eklenmez.</p>`;
  }
  function bindPDF() {
    const rows = imp.pdf.rows;
    $$('[data-pon]').forEach(c => c.onchange = () => { rows[+c.dataset.pon].on = c.checked; });
    $$('[data-pside]').forEach(s => s.onchange = () => { const t = rows[+s.dataset.pside]; t.side = s.value || null; if (t.side && t.code) { t.on = true; $(`[data-pon="${s.dataset.pside}"]`).checked = true; } });
    $$('[data-pcode]').forEach(s => s.onchange = () => { const t = rows[+s.dataset.pcode]; t.code = s.value || null; if (t.side && t.code) { t.on = true; $(`[data-pon="${s.dataset.pcode}"]`).checked = true; } });
    const b = $('#doPDF'); if (!b) return;
    b.onclick = async () => {
      if ($('#tgt').value === '__new' && !$('#tgtName').value.trim()) { await dialog({ title: 'Yeni kişinin adını yaz.' }); return; }
      const chosen = rows.filter(t => t.on);
      if (chosen.some(t => !t.code || !t.side)) { await dialog({ title: 'Eksik bilgi', body: 'Seçili satırların hepsinde fon ve Alış/Satış belli olmalı.' }); return; }
      if (!chosen.length) { await dialog({ title: 'Seçili işlem yok.' }); return; }
      const broker = H.brokerClean($('#tgtBroker').value);
      await D.snapshot(ledger, 'PDF içe aktarmadan önce');
      let added = 0;
      await commit(l => {
        const p = resolveTarget(l);
        const list = chosen.map(t => toTrade({ day: t.day, code: t.code, side: t.side, units: t.units, price: t.price, broker: broker || t.broker }));
        const n = newTradesOnly(list, p.trades); p.trades.push(...n); added = n.length;
        for (const t of n) if (!catalog.funds.some(f => f.code === t.fundCode) && !l.customFunds.some(f => f.code === t.fundCode)) l.customFunds.push({ code: t.fundCode });
        l.activeProfileID = p.id;
      }, { toast: `${added} işlem eklendi.`, go: '#ozet' });
      resetImport();
    };
  }

  // ---------- Yedek ----------
  const restore = { text: null, name: '', opened: null, needsPw: false, err: '' };
  VIEWS.yedek = {
    html() {
      const canShare = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File(['x'], 'a.fondefterim', { type: 'application/octet-stream' })] }));
      return `<h1>Yedek</h1>
        <div class="${backupDue() ? 'warnbox' : 'okbox'}">${esc(lastBackupText())}<br><span class="small">Defter yalnızca bu tarayıcıda durur. Tarayıcı verilerini temizlersen ya da Chrome'u silersen defter gider; yedek dosyası kalır. Arada bir yedek al ve dosyayı Drive'a, e-postana ya da bilgisayarına da koy.</span></div>
        <div id="persistBox"></div>
        <h2>Yedek al</h2>
        <form class="box form" id="bkForm">
          <label class="check"><input type="checkbox" id="bkProtect" checked><span>Şifreyle koru<br><small class="muted">Şifreyi unutursan yedek açılamaz; kurtarma yolu yoktur.</small></span></label>
          <div class="two" id="bkPw">
            <div class="f"><label for="bkP1">Şifre (en az 6 karakter)</label><input id="bkP1" type="password" autocomplete="new-password"></div>
            <div class="f"><label for="bkP2">Şifre (tekrar)</label><input id="bkP2" type="password" autocomplete="new-password"></div>
          </div>
          <div class="warnbox" id="bkErr" hidden></div>
          <div class="actions"><button class="btn primary" type="submit" data-how="download">Yedeği indir</button>${canShare ? '<button class="btn ghost" type="submit" data-how="share">Paylaş (Drive, e-posta…)</button>' : ''}</div>
          <p class="hint">Dosya: FonDefterim-yedek-${todayDay()}.fondefterim. iPhone'daki Fon Defterim uygulaması da bu dosyayı açar (Ayarlar › Yedek › Yedeği geri yükle).</p>
        </form>
        <h2>Yedeği geri yükle</h2>
        <div class="box form">
          <div class="f"><label for="rsFile">Yedek dosyası (.fondefterim, iPhone'dan da olur)</label><input type="file" id="rsFile"></div>
          ${restore.needsPw ? `<div class="f"><label for="rsPw">Bu yedek şifreli. Şifre</label><input id="rsPw" type="password" autocomplete="current-password"></div><button class="btn primary" type="button" id="rsOpen">Aç</button>` : ''}
          ${restore.err ? `<div class="warnbox">${esc(restore.err)}</div>` : ''}
          ${restore.opened ? restoreInfoHTML() : ''}
        </div>
        <h2>Otomatik kopyalar</h2>
        <div id="snaps" class="muted small">Yükleniyor…</div>`;
    },
    bind() {
      const prot = $('#bkProtect');
      prot.onchange = () => { $('#bkPw').hidden = !prot.checked; };
      let how = 'download';
      $$('#bkForm [data-how]').forEach(b => b.onclick = () => { how = b.dataset.how; });
      $('#bkForm').onsubmit = async e => {
        e.preventDefault();
        const errEl = $('#bkErr'); errEl.hidden = true;
        let pw = null;
        if (prot.checked) {
          pw = $('#bkP1').value;
          if (pw.length < 6) { errEl.hidden = false; errEl.textContent = 'Şifre en az 6 karakter olmalı.'; return; }
          if (pw !== $('#bkP2').value) { errEl.hidden = false; errEl.textContent = 'İki şifre aynı değil.'; return; }
        }
        try {
          const text = await D.makeBackup(ledger, pw);
          const name = `FonDefterim-yedek-${todayDay()}.fondefterim`;
          const file = new File([text], name, { type: 'application/octet-stream' });
          if (how === 'share') {
            try { await navigator.share({ files: [file], title: 'Fon Defterim yedeği' }); }
            catch (x) { if (x && x.name === 'AbortError') return; throw x; }
          } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(file); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          }
          await D.noteBackup(); meta = await D.meta();
          $('#bkP1').value = ''; $('#bkP2').value = '';
          render();
          toast(how === 'share' ? 'Yedek paylaşıldı.' : 'Yedek indirildi (İndirilenler klasörü).');
        } catch (x) { errEl.hidden = false; errEl.textContent = 'Yedek alınamadı: ' + (x.message || x); }
      };
      $('#rsFile').onchange = async e => {
        const f = e.target.files[0];
        Object.assign(restore, { text: null, name: '', opened: null, needsPw: false, err: '' });
        if (!f) { render(); return; }
        if (f.size > 50000000) { restore.err = 'Bu dosya bir Fon Defterim yedeği değil.'; render(); return; }
        restore.text = await f.text(); restore.name = f.name;
        await tryOpen(null);
      };
      const ob = $('#rsOpen'); if (ob) ob.onclick = () => tryOpen($('#rsPw').value);
      const pwIn = $('#rsPw'); if (pwIn) { pwIn.onkeydown = ev => { if (ev.key === 'Enter') tryOpen(pwIn.value); }; setTimeout(() => pwIn.focus(), 30); }
      const rep = $('#rsReplace'); if (rep) rep.onclick = () => applyRestore('replace');
      const add = $('#rsAdd'); if (add) add.onclick = () => applyRestore('add');
      fillPersist(); fillSnapshots();
    },
  };
  async function tryOpen(pw) {
    restore.err = '';
    try {
      restore.opened = await D.openBackup(restore.text, pw);
      restore.needsPw = false;
    } catch (e) {
      restore.opened = null;
      if (e.code === 'passwordRequired') restore.needsPw = true;
      else if (e.code === 'wrongPassword') { restore.needsPw = true; restore.err = e.message; }
      else { restore.needsPw = false; restore.err = e.message || 'Yedek açılamadı.'; }
    }
    render();
  }
  function restoreInfoHTML() {
    const i = restore.opened.info;
    const d = new Date(i.createdAt);
    return `<div class="okbox"><b>Yedek açıldı.</b> ${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} tarihli.<br>
      Kişiler: ${esc(i.profileNames.join(', '))} · ${i.tradeCount} işlem · ${i.paymentCount} ödeme</div>
      <div class="actions" style="flex-direction:column">
        <button class="btn primary" id="rsReplace">Defterimin yerine koy</button>
        <button class="btn ghost" id="rsAdd">Yanına ekle (yedekteki kişiler ayrı kişi olarak eklenir)</button>
      </div>
      <p class="hint">Hangisini seçersen seç, defterin şimdiki hâli önce otomatik kopya olarak saklanır.</p>`;
  }
  async function applyRestore(how) {
    const o = restore.opened;
    if (how === 'replace' && ledger.profiles.some(hasRecords)) {
      const ok = await dialog({ title: 'Defterin yedektekiyle değiştirilsin mi?', body: 'Bu cihazdaki kayıtların yerine yedekteki kayıtlar gelir. Şimdiki hâl otomatik kopya olarak saklanır; Yedek ekranından geri dönebilirsin.', ok: 'Değiştir', cancel: 'Vazgeç', danger: true });
      if (!ok) return;
    }
    await D.snapshot(ledger, 'Yedek geri yüklemeden önce');
    const next = how === 'replace' ? clone(o.ledger) : D.mergeBackup(o.ledger, ledger);
    if (how === 'replace') next.acceptedDisclaimer = true;
    Object.assign(restore, { text: null, name: '', opened: null, needsPw: false, err: '' });
    await commit(l => { Object.keys(l).forEach(k => delete l[k]); Object.assign(l, next); }, { toast: how === 'replace' ? 'Yedek geri yüklendi.' : 'Yedekteki kişiler eklendi.', go: '#ozet', noCount: how === 'replace' });
    if (how === 'replace') { await D.noteBackup(); meta = await D.meta(); render(); }
  }
  async function fillPersist() {
    const el = $('#persistBox'); if (!el) return;
    const p = await D.isPersisted();
    if (p === null) { el.innerHTML = ''; return; }
    el.innerHTML = p ? '<p class="small muted">✓ Tarayıcı bu defteri kalıcı olarak saklıyor (yer darlığında kendiliğinden silmez).</p>'
      : `<div class="box small"><b>Kalıcı saklama izni yok.</b> Tarayıcı, telefonda yer azalırsa site verilerini silebilir. İzin iste; defteri ana ekrana eklemek de bu izni kolaylaştırır.<div class="actions"><button class="btn ghost small" id="askPersist">Kalıcı saklama izni iste</button></div></div>`;
    const b = $('#askPersist');
    if (b) b.onclick = async () => { const ok = await D.persist(); toast(ok ? 'İzin verildi.' : 'Tarayıcı şimdilik izin vermedi. Defteri ana ekrana ekleyip tekrar dene.'); fillPersist(); };
  }
  async function fillSnapshots() {
    const el = $('#snaps'); if (!el) return;
    const list = await D.snapshots();
    if (!list.length) { el.textContent = 'Henüz otomatik kopya yok. İçe aktarma ve geri yüklemeden önce defterin son hâli burada saklanır (son 3).'; return; }
    el.innerHTML = `<ul class="list">${list.map((s, i) => {
      const n = s.ledger.profiles.reduce((a, p) => a + p.trades.length + p.payments.length, 0);
      const d = new Date(s.at);
      return `<li><div class="it"><span class="l"><b>${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</b><small>${esc(s.reason)} · ${n} kayıt</small></span><button class="btn ghost small" data-snap="${i}">Bu hâle dön</button></div></li>`;
    }).join('')}</ul>`;
    $$('[data-snap]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.snap];
      const ok = await dialog({ title: 'Bu kopyaya dönülsün mü?', body: 'Defterin şimdiki hâli de önce kopya olarak saklanır.', ok: 'Dön', cancel: 'Vazgeç' });
      if (!ok) return;
      const next = D.normalizeLedger(clone(s.ledger));
      await D.snapshot(ledger, 'Kopyaya dönmeden önce');
      await commit(l => { Object.keys(l).forEach(k => delete l[k]); Object.assign(l, next); }, { toast: 'Kopyaya dönüldü.', go: '#ozet' });
    });
  }

  // ---------- Dava senaryoları (iPhone'daki Dava ekranı) ----------
  const nf = (v, max) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: max }).format(v);
  const short = v => Math.abs(v) >= 1e6 ? nf(v / 1e6, 1) + ' Mn' : Math.abs(v) >= 1e3 ? nf(v / 1e3, 0) + ' B' : nf(v, 0);
  const usd = v => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(v);
  function possessive(n) {
    const v = Math.abs(n), ones = ['ı', 'i', 'si', 'ü', 'ü', 'i', 'sı', 'si', 'i', 'u'], tens = ['', 'u', 'si', 'u', 'ı', 'si', 'ı', 'i', 'i', 'ı'];
    if (v === 0) return ones[0];
    if (v % 1000000 === 0) return 'u';
    if (v % 1000 === 0) return 'i';
    if (v % 100 === 0) return 'ü';
    if (v % 10 === 0) return tens[Math.floor(v / 10) % 10];
    return ones[v % 10];
  }
  const pctPoss = r => { const n = Math.round(r * 100); return `%${n}'${possessive(n)}`; };
  const dava = { scenario: 'Baz', years: 5 };

  function projectionSVG(rows, claim) {
    const W = 340, Hh = 190, L = 46, R = 22, T = 12, B = 24;
    const vals = rows.flatMap(r => [r.nominal, r.real]).concat([claim]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.1 || 1; lo = Math.max(0, lo - pad); hi += pad;
    const x = i => L + (W - L - R) * i / (rows.length - 1), y = v => T + (Hh - T - B) * (1 - (v - lo) / (hi - lo));
    const line = k => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join('');
    const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * i / 3);
    return `<svg viewBox="0 0 ${W} ${Hh}" class="chart" role="img" aria-label="Yıl yıl nominal ve reel alacak">
      ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${short(t)}</text>`).join('')}
      ${rows.map((r, i) => i % 2 === 0 ? `<text x="${x(i)}" y="${Hh - 6}" text-anchor="middle" class="ax">${r.year}. yıl</text>` : '').join('')}
      <line x1="${L}" x2="${W - R}" y1="${y(claim)}" y2="${y(claim)}" class="base"/><text x="${L + 4}" y="${y(claim) - 5}" class="ax">anapara</text>
      <path d="${line('nominal')}" class="l1"/><path d="${line('real')}" class="l2"/>
    </svg>
    <div class="legend"><span><i class="k1"></i>Nominal</span><span><i class="k2"></i>Reel (16.09 fiyatıyla)</span></div>`;
  }

  VIEWS.dava = {
    html() {
      const p = profile(), params = p.parameters;
      const claim = H.summary(H.positions(funds(), p), basis()).claimValue;
      const durations = (params.durations && params.durations.length ? params.durations : [3, 5, 7]);
      if (!durations.includes(dava.years)) dava.years = durations.includes(5) ? 5 : durations[0];
      const head = `<h1>Dava senaryoları</h1>`;
      if (!(claim > 0)) return head + `<div class="box empty"><h2>Dava değeri yok</h2><p class="muted">Kalan alacağın olduğunda dava senaryoları burada hesaplanır.</p><a class="btn ghost" href="#ekle">Kayıt ekle</a></div>`;
      const outs = H.lawsuitOutcomes(claim, params);
      const o = H.lawsuitOutcome(claim, dava.scenario, dava.years, params);
      const e = H.lossEstimate(claim, params);
      const find = (s, y) => outs.find(x => x.scenario === s && x.years === y);
      const be = (win, loss) => win > 0 && win + loss > 0 ? loss / (win + loss) : null;
      const range = e.opposingMaktuLow === e.opposingMaktuHigh ? tl(e.totalMaktuHigh) : `${tl(e.totalMaktuLow)} ile ${tl(e.totalMaktuHigh)} arası`;
      const minus = v => v > 0 ? '−' + tl(v) : '–';
      const row = (label, v, sign = '', bold = false) => `<span${bold ? ' style="font-weight:650;color:var(--text)"' : ''}>${label}</span><span class="v">${sign}${tl(v)}</span>`;
      const matrix = (cell) => `<div class="table-wrap"><table class="mini"><thead><tr><th></th>${durations.map(y => `<th class="n">${y} yıl</th>`).join('')}</tr></thead><tbody>
        ${H.SCENARIOS.map(s => `<tr><td class="muted">${s}</td>${durations.map(y => `<td class="n">${cell(find(s, y))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      return `${head}
        <p class="muted small" style="margin-top:-6px">Dava değeri: <b>${tl(claim)}</b> (${esc(basis().toLocaleLowerCase('tr-TR'))} esasına göre kalan alacak).</p>
        <div class="seg2" role="group" aria-label="Senaryo">${H.SCENARIOS.map(s => `<button type="button" data-sc="${s}" aria-pressed="${dava.scenario === s}">${s}</button>`).join('')}</div>
        <div class="seg2" role="group" aria-label="Süre" style="margin-top:8px">${durations.map(y => `<button type="button" data-yr="${y}" aria-pressed="${dava.years === y}">${y} yıl</button>`).join('')}</div>
        <section class="box" style="margin-top:14px">
          <div class="muted small">${o.years} yıl sonra net ele geçen</div>
          <div style="font-size:clamp(28px,8vw,36px);font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums">${tl(o.netNominal)}</div>
          <div class="muted small">Tahmini tahsil: ${showDay(o.collectionDay)}</div>
          <div class="grid2" style="margin:12px 0 0">
            <div><div class="muted small">Bugünkü TL karşılığı</div><b>${tl(o.netReal)}</b><div class="small ${o.purchasingPowerRatio >= 1 ? 'pos' : 'warn-t'}">anaparanın ${pctPoss(o.purchasingPowerRatio)}</div></div>
            <div><div class="muted small">Bugünkü dolar</div><b>${usd(o.netUSDToday)}</b><div class="small ${o.usdGainLoss >= 0 ? 'pos' : 'neg'}">${o.usdGainLossPercent >= 0 ? '+' : ''}${pct(o.usdGainLossPercent)} · 16.09: ${usd(o.claimUSD1609)}</div></div>
          </div>
        </section>
        <h2>Avukat ücretin</h2>
        <form class="box form" id="lawForm">
          <div class="two">
            <div class="f"><label for="lawFixed">Sabit ücret (TL)</label><input id="lawFixed" inputmode="decimal" value="${esc(numOut(params.lawyerFixedFee ?? 50000))}"><div class="hint">Davayı kazansan da kaybetsen de ödenir.</div></div>
            <div class="f"><label for="lawRate">Başarı ücreti (%)</label><input id="lawRate" inputmode="decimal" value="${esc(numOut(Math.round((params.lawyerSuccessRate ?? 0.06) * 100000) / 1000))}"><div class="hint">Kazanılırsa, alınan toplam tutar üzerinden.</div></div>
          </div>
          <label class="check"><input type="checkbox" id="lawOffset" ${params.awardedFeeOffset ? 'checked' : ''}><span>Karşı vekâlet ücreti avukat ücretimden düşülür<br><small class="muted">Avukat sözleşmende bu madde varsa işaretle.</small></span></label>
          <div class="warnbox" id="lawErr" hidden></div>
          <button class="btn primary" type="submit">Kaydet</button>
          <p class="hint" style="margin:0">“${esc(p.name)}” defteri için. iPhone uygulamasındaki Ayarlar › Parametreler'deki avukat ücretiyle aynı alan; yedekle taşınır.</p>
        </form>
        <h2>Hesap dökümü</h2>
        <div class="box"><div class="kv">
          ${row('Anapara (dava değeri)', o.principal)}
          ${row(`Faiz (%${nf(o.interestRate * 100, 2)} × ${o.years} yıl, basit)`, o.interest, '+')}
          ${row('Brüt hüküm', o.grossJudgment, '', true)}
          ${o.unrecoveredCosts > 0 ? row('Yargılama giderleri (cebinde kalan)', o.unrecoveredCosts, '−') : ''}
          ${row('Avukat sabit ücreti', o.lawyerFixedFee, '−')}
          ${row(`Avukat başarı ücreti (%${nf((params.lawyerSuccessRate || 0) * 100, 2)})`, o.lawyerSuccessFee, '−')}
          ${o.awardedFeeOffset > 0 ? row('Karşı vekâlet ücreti mahsubu (sözleşmene göre)', o.awardedFeeOffset, '+') : ''}
          <span class="sep"></span>
          ${row('Net ele geçen', o.netNominal, '', true)}
        </div></div>
        <h2>Bugünkü satın alma gücü (reel TL)</h2>
        ${matrix(x => x ? `<span class="${x.netReal >= claim ? 'pos' : 'warn-t'}">${short(x.netReal)}</span>` : '–')}
        <p class="hint">Anapara: ${tl(claim)}. Turuncu: dava kazanılsa bile faiz, masraf ve enflasyon birlikte satın alma gücünü anaparanın altına düşürüyor.</p>
        <h2>Yıl yıl seyir – ${esc(dava.scenario)}</h2>
        <div class="box">${projectionSVG(H.lawsuitProjection(claim, dava.scenario, params), claim)}
          <p class="hint">Masraflar düşülmemiş brüt alacak. Reel çizgi anaparanın altına iniyorsa faiz enflasyonu karşılamıyor demektir.</p></div>
        <h2>Kaybedilirse ödenecek</h2>
        <div class="box">
          <div class="neg" style="font-size:22px;font-weight:750;font-variant-numeric:tabular-nums">${range}</div>
          <div class="muted small">Makul senaryo: karşı tarafa sabit (maktu) vekâlet ücreti; duruşmasız / duruşmalı</div>
          <div class="warn-t" style="font-size:17px;font-weight:700;margin-top:10px;font-variant-numeric:tabular-nums">${minus(e.totalProportional)}</div>
          <div class="muted small">En kötü senaryo · mahkeme nispi ücret hesaplar ve istinafta düzeltilmezse</div>
          <div class="kv" style="margin-top:12px">
            <span>Karşı vekâlet – maktu<small>${params.opposingAttorneyFee == null ? '2025-2026 AAÜT: duruşmasız 30.000, duruşmalı 40.000 TL' : 'Parametrelerde girilen tutar'}</small></span><span class="v">${e.opposingMaktuLow === e.opposingMaktuHigh ? minus(e.opposingMaktuHigh) : `−${nf(e.opposingMaktuLow, 0)} / ${nf(e.opposingMaktuHigh, 0)} TL`}</span>
            <span>Karşı vekâlet – nispi (risk)<small>AAÜT Üçüncü Kısım dilimleri; reddedilen miktarı geçemez</small></span><span class="v">${minus(e.opposingProportional)}</span>
            <span>Bilirkişi, posta, keşif avansları</span><span class="v">${minus(e.expenses)}</span>
            <span>Maktu harçlar<small>Peşin harcın fazlası iade edilir (Harçlar K. m.31)</small></span><span class="v">${minus(e.fixedCourtFees)}</span>
            <span>İstinaf / temyiz harçları</span><span class="v">${minus(e.appealCosts)}</span>
          </div>
          <p class="hint">Kendi avukatına ödeyeceğin ${tl(e.ownLawyerFee)} (sabit ücret) bu toplama dahil değil: davayı kazansan da kaybetsen de ödenir. Kazanırsan karşı taraftan alınan vekâlet ücreti de avukatına aittir (Avukatlık K. m.164).</p>
          <p class="hint">Dava açarken peşin harç olarak ${tl(e.upfrontCourtFee)} ödenir. Dava reddedilirse kalan 3/4 istenmez; maktu harcı aşan kısım talep üzerine iade edilir.</p>
          <p class="hint">Kaybeden tazminat ödemez; yalnız yargılama giderlerini ve karşı vekâlet ücretini öder. Kaybetme maliyeti senaryodan ve süreden bağımsızdır.</p>
        </div>
        <h3>Kazanırsan / kaybedersen (bugünkü TL)</h3>
        ${matrix(x => { if (!x) return '–'; const b = be(x.netReal, e.totalMaktuHigh + e.ownLawyerFee); return `<span class="pos">+${short(x.netReal)}</span><br><span class="neg">−${short(e.totalMaktuHigh)}</span>${b != null ? `<br><span class="muted">en az ${pct(b)}</span>` : ''}`; })}
        <p class="hint">Yeşil: kazanılırsa masraflar sonrası net alacağın bugünkü TL karşılığı. Kırmızı: kaybedilirse karşı tarafa ve mahkemeye ödenecek. "En az %": dava açmanın, hiç açmamaya göre kârlı olması için gereken kazanma olasılığı (kendi avukat ücretin iki durumda da ödendiği için hesaba katıldı); nispi senaryoda bu oran ${pct(be(o.netReal, e.totalProportional + e.ownLawyerFee))} olur (seçili senaryo ve süre). Basit beklenen değer hesabıdır, hukuki değerlendirme değildir.</p>
        <div class="okbox small">Faiz, enflasyon, kur ve harç varsayımları defterin parametrelerinden gelir (iPhone uygulamasının Ayarlar › Parametreler'i ya da hesap defteri Excel'i). Bunlar webde şimdilik değiştirilemez; yedekle taşınır.</div>
        <p class="foot-note">Senaryolar tahmindir; sonuçlar varsayımlar kadar iyidir. Faiz türü, harç ve avukat ücretlerini avukatınla netleştir.</p>`;
    },
    bind() {
      $$('[data-sc]').forEach(b => b.onclick = () => { dava.scenario = b.dataset.sc; render(); });
      $$('[data-yr]').forEach(b => b.onclick = () => { dava.years = +b.dataset.yr; render(); });
      const f = $('#lawForm');
      if (f) f.onsubmit = async e => {
        e.preventDefault();
        const err = $('#lawErr'); err.hidden = true;
        const fixed = numIn($('#lawFixed').value), rate = numIn($('#lawRate').value);
        if (fixed == null || fixed < 0) { err.hidden = false; err.textContent = 'Sabit ücreti TL olarak yaz (ör. 50.000). Yoksa 0 yaz.'; return; }
        if (rate == null || rate < 0 || rate > 100) { err.hidden = false; err.textContent = 'Başarı ücretini yüzde olarak yaz (ör. 6). Yoksa 0 yaz.'; return; }
        const offset = $('#lawOffset').checked;
        await commit(l => {
          const q = l.profiles.find(x => x.id === l.activeProfileID);
          q.parameters.lawyerFixedFee = fixed;
          q.parameters.lawyerSuccessRate = Math.round(rate * 1000) / 100000;
          q.parameters.awardedFeeOffset = offset;
        }, { toast: 'Avukat ücreti kaydedildi.' });
      };
    },
  };

  // ---------- Ayarlar ----------
  VIEWS.ayarlar = {
    html() {
      const p = profile();
      const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      return `<h1>Ayarlar</h1>
        <h2>Kişiler</h2>
        <p class="muted small">Ailenin ya da yakınlarının kayıtlarını ayrı defterlerde tut.</p>
        <ul class="list">${ledger.profiles.map(x => `<li><button class="it" data-switch="${esc(x.id)}">
          <span class="av" style="background:${COLORS[(x.colorIndex || 0) % COLORS.length]}">${esc(initials(x.name))}</span>
          <span class="l"><b>${esc(x.name)}</b><small>${x.trades.length} işlem · ${x.payments.length} ödeme</small></span>
          <span class="r">${x.id === p.id ? '<span class="tag buy">açık</span>' : ''}</span></button></li>`).join('')}</ul>
        <div class="actions"><button class="btn ghost small" id="addP">Kişi ekle</button><button class="btn ghost small" id="renP">“${esc(p.name)}” adını değiştir</button>${ledger.profiles.length > 1 ? `<button class="btn ghost small" id="delP" style="color:#b23a2e">“${esc(p.name)}” defterini sil</button>` : ''}</div>
        <h2>Dava hesabı esası</h2>
        <div class="seg2" role="group" aria-label="Dava hesabı esası">
          <button type="button" data-cb="16.09.2026 değeri" aria-pressed="${basis() !== 'Net yatırım'}">16.09.2026 değeri</button>
          <button type="button" data-cb="Net yatırım" aria-pressed="${basis() === 'Net yatırım'}">Net yatırım</button>
        </div>
        <p class="hint">“${esc(p.name)}” defteri için. iPhone uygulamasındaki Ayarlar › Parametreler'deki seçimle aynıdır ve yedekle taşınır.</p>
        <h2>Ana ekrana ekle</h2>
        <div class="box small">${standalone ? '✓ Defter ana ekrandan uygulama gibi açılıyor. İnternet olmadan da açılır.'
          : `${installPrompt ? '<div class="actions" style="margin:0 0 8px"><button class="btn primary small" id="install">Ana ekrana ekle</button></div>' : ''}
            Android'de Chrome'un sağ üstteki <b>⋮</b> menüsünden <b>“Ana ekrana ekle”</b> ya da <b>“Uygulamayı yükle”</b>yi seç. Defter ana ekranda simgeyle durur, uygulama gibi açılır ve internetsiz de çalışır.`}</div>
        <h2>Fon listesi</h2>
        <div class="box small">Fon fiyatları ve 16.09 fiyatları: <b>${showDay(catalog.updated)}</b> tarihli liste${catalog.bundled ? ' (sitenin kopyası)' : ''}. Defter açılışta internet varsa günceller.
          <div class="actions"><button class="btn ghost small" id="refCat">Şimdi güncelle</button></div></div>
        <h2>Gizlilik</h2>
        <div class="box small">Kayıtların yalnızca bu cihazda, bu tarayıcıda durur; hiçbir sunucuya gönderilmez. Hesap, üyelik, çerez ya da reklam yok. Defter internete yalnızca herkese açık fon listesini indirmek için çıkar. <a href="../gizlilik.html">Gizlilik</a></div>
        <h2>iPhone ya da iPad'in mi var?</h2>
        <div class="box small">Fon Defterim'in iPhone uygulamasında dava hesabı, hatırlatmalar ve otomatik yedek de var. Buradan aldığın yedeği uygulamada açabilirsin. <a href="https://apps.apple.com/app/id6836281635" rel="noopener">App Store'da Fon Defterim</a></div>
        <h2>Tehlikeli bölge</h2>
        <div class="actions"><button class="btn ghost small" id="eraseAll" style="color:#b23a2e">Bu cihazdaki defteri sıfırla</button></div>
        <p class="foot-note">Fon Defterim · Hukuki ya da yatırım tavsiyesi değildir.</p>`;
    },
    bind() {
      $$('[data-switch]').forEach(b => b.onclick = () => commit(l => { l.activeProfileID = b.dataset.switch; }, { noCount: true }));
      $$('[data-cb]').forEach(b => b.onclick = () => commit(l => { const p = l.profiles.find(x => x.id === l.activeProfileID); p.parameters.claimBasis = b.dataset.cb; }, { toast: 'Dava hesabı esası değişti.', undo: false }));
      $('#addP').onclick = addPerson;
      $('#renP').onclick = async () => {
        const name = await dialog({ title: 'Adı değiştir', input: { label: 'Ad', value: profile().name, max: 60 }, ok: 'Kaydet', cancel: 'Vazgeç' });
        if (name && name.trim()) commit(l => { l.profiles.find(x => x.id === l.activeProfileID).name = name.trim(); }, { toast: 'Ad değişti.', undo: false });
      };
      const del = $('#delP');
      if (del) del.onclick = async () => {
        const p = profile();
        const ok = await dialog({ title: `“${p.name}” defteri silinsin mi?`, body: `${p.trades.length} işlem ve ${p.payments.length} ödeme silinir. Hemen ardından “Geri al” ile vazgeçebilirsin.`, ok: 'Sil', cancel: 'Vazgeç', danger: true });
        if (ok) commit(l => { l.profiles = l.profiles.filter(x => x.id !== p.id); l.activeProfileID = l.profiles[0].id; }, { toast: `“${p.name}” silindi.` });
      };
      const ins = $('#install');
      if (ins) ins.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); installPrompt = null; render(); };
      $('#refCat').onclick = async () => { const ok = await refreshCatalog(true); toast(ok ? 'Fon listesi güncellendi.' : (navigator.onLine ? 'Liste zaten güncel.' : 'İnternet yok; saklı liste kullanılıyor.')); render(); };
      $('#eraseAll').onclick = async () => {
        const ok = await dialog({ title: 'Defter sıfırlansın mı?', body: 'Bu cihazdaki tüm kişiler ve kayıtlar silinir. Defterin şimdiki hâli otomatik kopya olarak saklanır (Yedek › Otomatik kopyalar). Yedek dosyaların etkilenmez.', ok: 'Sıfırla', cancel: 'Vazgeç', danger: true });
        if (!ok) return;
        await D.snapshot(ledger, 'Defteri sıfırlamadan önce');
        const fresh = D.newLedger(); fresh.acceptedDisclaimer = true;
        commit(l => { Object.keys(l).forEach(k => delete l[k]); Object.assign(l, fresh); }, { toast: 'Defter sıfırlandı.', go: '#ozet' });
      };
    },
  };
  async function addPerson() {
    const name = await dialog({ title: 'Kişi ekle', body: 'ör. Annem, Eşim', input: { label: 'Ad', max: 60 }, ok: 'Ekle', cancel: 'Vazgeç' });
    if (!name || !name.trim()) return;
    commit(l => { const p = D.newProfile(name.trim(), l.profiles.length % COLORS.length); l.profiles.push(p); l.activeProfileID = p.id; }, { toast: `“${name.trim()}” eklendi.`, undo: false });
  }

  // Üstteki kişi düğmesi: hızlı geçiş
  $('#who').onclick = async () => {
    const dlg = $('#dlg');
    dlg.innerHTML = `<div class="in"><h2>Kimin defteri?</h2><ul class="list">${ledger.profiles.map(x => `<li><button class="it" data-pick="${esc(x.id)}" type="button">
      <span class="av" style="background:${COLORS[(x.colorIndex || 0) % COLORS.length]}">${esc(initials(x.name))}</span><span class="l"><b>${esc(x.name)}</b><small>${x.trades.length} işlem · ${x.payments.length} ödeme</small></span>${x.id === ledger.activeProfileID ? '<span class="tag buy">açık</span>' : ''}</button></li>`).join('')}</ul>
      <div class="actions"><button class="btn ghost" type="button" id="pickAdd">Kişi ekle</button><button class="btn primary" type="button" id="pickClose">Kapat</button></div></div>`;
    dlg.onclose = null;
    dlg.showModal();
    $$('[data-pick]', dlg).forEach(b => b.onclick = () => { dlg.close(); if (b.dataset.pick !== ledger.activeProfileID) commit(l => { l.activeProfileID = b.dataset.pick; }, { noCount: true }); });
    $('#pickAdd', dlg).onclick = () => { dlg.close(); setTimeout(addPerson, 50); };
    $('#pickClose', dlg).onclick = () => dlg.close();
  };

  // ---------- İlk açılış ----------
  async function welcome() {
    const ok = await dialog({
      title: 'Fon Defterim web defteri',
      body: `<p>Tasfiyedeki fonlardaki işlemlerini ve ödemelerini kaydet; net yatırımını, 16.09.2026 değerini ve kalan alacağını gör.</p>
        <p><b>Kayıtların yalnızca bu cihazda kalır</b>, hiçbir yere gönderilmez. Bu yüzden arada bir <b>yedek al</b>.</p>
        <p class="small">Hukuki ya da yatırım tavsiyesi değildir. Resmî tutarları tasfiye süreci belirler; buradaki rakamlar kontrol amaçlıdır.</p>`,
      ok: 'Anladım, başla',
    });
    void ok;
    await commit(l => { l.acceptedDisclaimer = true; }, { noCount: true });
  }

  async function start() {
    try {
      ledger = await D.load();
      meta = await D.meta();
      catalog = (await D.loadCatalog()) || bundledCatalog();
    } catch (e) {
      app.innerHTML = `<div class="warnbox"><b>Defter açılamadı.</b> ${esc(e.message || e)}<br>Gizli sekmede ya da çok eski bir tarayıcıda olabilirsin. Chrome'un normal sekmesinde aç.</div>`;
      return;
    }
    const first = !ledger;
    if (first) { ledger = D.newLedger(); await D.save(ledger, { noCount: true }); meta = await D.meta(); }
    render();
    window.addEventListener('hashchange', render);
    if (first || !ledger.acceptedDisclaimer) welcome();
    refreshCatalog().then(changed => { if (changed) render(); });
    window.addEventListener('online', () => refreshCatalog().then(c => { if (c) render(); }));
  }

  // Ana ekrana ekleme ve internetsiz açılış
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (route().name === 'ayarlar') render(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; D.persist(); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* internetsiz açılış olmadan da çalışır */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      toast('Defterin yeni sürümü hazır.', () => location.reload());
      const b = $('#toast button'); if (b) b.textContent = 'Yenile';
    });
  }

  start();
})();
