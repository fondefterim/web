// Ana sayfadaki "Fonunu bul" kutusu: kod ya da ad yazınca öneri gösterir, seçince fonun sayfasını açar.
// Liste fon-listesi.js'ten gelir (sitenin kendi dosyası; internete istek atılmaz).
(function () {
  'use strict';
  const norm = s => String(s == null ? '' : s).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function setup(form) {
    const input = form.querySelector('input');
    const list = form.querySelector('[role="listbox"]');
    const funds = (window.FON_LISTESI || []).map(f => ({ ...f, nn: norm(f.n), cc: f.c.toLowerCase() }));
    if (!input || !list || !funds.length) return;
    // Liste doğrudan sayfa gövdesine taşınır: animasyonlu ya da taşmayı gizleyen kutular onu kesmesin.
    list.classList.add('ff-list');
    document.body.appendChild(list);
    let items = [], active = -1;

    function search(q) {
      const n = norm(q);
      if (!n) return [];
      const words = n.split(' ');
      const scored = [];
      for (const f of funds) {
        let score = -1;
        if (f.cc === n) score = 100;
        else if (f.cc.startsWith(n)) score = 80;
        // Kısa yazımlarda (ör. "tl") yalnızca kod aranır; adlardaki "(TL)" gibi ekler sonucu doldurmasın.
        else if (n.length >= 3 && words.every(w => f.nn.includes(w) || f.cc.startsWith(w))) score = f.nn.startsWith(n) ? 60 : 40;
        if (score >= 0) scored.push([score, f]);
      }
      return scored.sort((a, b) => b[0] - a[0] || a[1].c.localeCompare(b[1].c)).slice(0, 7).map(x => x[1]);
    }

    // Liste sayfanın üstünde (position: fixed) açılır; giriş bölümünün kenarında kesilmesin.
    const box = form.querySelector('.ff-box') || input;
    function place() {
      if (list.hidden) return;
      const r = box.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      list.style.position = 'fixed';
      list.style.left = r.left + 'px';
      list.style.width = r.width + 'px';
      list.style.right = 'auto';
      if (below >= 180 || below >= r.top - 12) {
        list.style.top = (r.bottom + 6) + 'px'; list.style.bottom = 'auto';
        list.style.maxHeight = Math.max(140, Math.min(360, below)) + 'px';
      } else {
        list.style.top = 'auto'; list.style.bottom = (window.innerHeight - r.top + 6) + 'px';
        list.style.maxHeight = Math.max(140, Math.min(360, r.top - 18)) + 'px';
      }
    }
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);

    function show() {
      items = search(input.value);
      active = items.length ? 0 : -1;
      if (!input.value.trim()) { close(); return; }
      list.innerHTML = items.length
        ? items.map((f, i) => `<li role="option" id="fa-${i}" aria-selected="${i === active}"><a href="fon/${esc(f.c.toLowerCase())}.html"><b>${esc(f.c)}</b><span>${esc(f.n)}</span></a></li>`).join('')
        : `<li class="none">Bu adla tasfiyedeki bir fon yok. <a href="fonlar.html">Tüm liste →</a></li>`;
      list.hidden = false;
      place();
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', active >= 0 ? `fa-${active}` : '');
    }
    function close() {
      list.hidden = true; list.innerHTML = ''; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }
    function move(d) {
      if (!items.length) return;
      active = (active + d + items.length) % items.length;
      list.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', i === active));
      input.setAttribute('aria-activedescendant', `fa-${active}`);
    }

    input.addEventListener('input', show);
    input.addEventListener('focus', () => { if (input.value.trim()) show(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) show(); else move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Escape') close();
    });
    form.addEventListener('submit', e => {
      const pick = items[active] || search(input.value)[0];
      if (pick) { e.preventDefault(); location.href = `fon/${pick.c.toLowerCase()}.html`; }
      // Eşleşme yoksa form fonlar.html?q=… adresine gider (orada arama kutusu dolu açılır).
    });
    document.addEventListener('click', e => { if (!form.contains(e.target) && !list.contains(e.target)) close(); });
  }

  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('form.fund-find').forEach(setup));
})();
