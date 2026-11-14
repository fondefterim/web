// Kaydırma animasyonları: bölümler belirerek gelir, "Neler yapar?" kartları üst üste katlanır,
// giriş bölümündeki telefonlar hafifçe derinlik kazanır. Hareketi azalt ayarı açıksa hiçbiri çalışmaz.
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // 0) Giriş bölümündeki ekran galerisi (hareket azaltılmış olsa da çalışır; yalnızca otomatik geçiş kapanır)
  (function carousel() {
    const box = document.getElementById('slides');
    if (!box) return;
    const slides = [...box.querySelectorAll('.slide')];
    const dots = [...document.querySelectorAll('#dots button')];
    const cap = document.getElementById('slideCap');
    let index = 0, timer = null, userTouched = false;
    const go = (i, smooth = true) => {
      index = (i + slides.length) % slides.length;
      box.scrollTo({ left: index * box.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    };
    const mark = i => {
      dots.forEach((d, k) => d.setAttribute('aria-current', k === i ? 'true' : 'false'));
      const s = slides[i];
      cap.innerHTML = `<b>${s.dataset.title}</b><span>${s.dataset.sub}</span>`;
    };
    let raf = 0;
    box.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(box.scrollLeft / Math.max(1, box.clientWidth));
        if (i !== index) { index = i; }
        mark(Math.min(Math.max(i, 0), slides.length - 1));
      });
    }, { passive: true });
    const stop = () => { userTouched = true; clearInterval(timer); timer = null; };
    dots.forEach((d, k) => d.addEventListener('click', () => { stop(); go(k); }));
    document.querySelector('.nav-btn.prev').addEventListener('click', () => { stop(); go(index - 1); });
    document.querySelector('.nav-btn.next').addEventListener('click', () => { stop(); go(index + 1); });
    box.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { stop(); go(index + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { stop(); go(index - 1); e.preventDefault(); }
    });
    ['pointerdown', 'touchstart', 'wheel'].forEach(ev => box.addEventListener(ev, stop, { passive: true }));
    // Masaüstünde fareyle sürükleyerek de kaydırılabilsin.
    let dragX = null, startLeft = 0;
    box.addEventListener('mousedown', e => { dragX = e.clientX; startLeft = box.scrollLeft; box.style.scrollSnapType = 'none'; box.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => { if (dragX !== null) box.scrollLeft = startLeft - (e.clientX - dragX); });
    window.addEventListener('mouseup', () => {
      if (dragX === null) return;
      dragX = null; box.style.cursor = ''; box.style.scrollSnapType = '';
      go(Math.round(box.scrollLeft / box.clientWidth));
    });
    if (!reduce) timer = setInterval(() => { if (!userTouched && !document.hidden) go(index + 1); }, 4500);
    window.addEventListener('resize', () => go(index, false));
  })();
  if (reduce || !('IntersectionObserver' in window)) { root.classList.remove('js'); return; }

  // 1) Belirerek gelme
  const groups = [
    ['main section h2, main section .sub, .notice, .news-head', 0],
    ['.links a', 70], ['.stats > div', 70], ['.gallery figure', 90], ['.news', 90],
    ['.split > *', 100], ['.cta-card', 0], ['.stack-intro .btn', 0],
  ];
  const targets = [];
  groups.forEach(([sel, step]) => {
    const els = document.querySelectorAll(sel);
    els.forEach((el, i) => {
      if (el.closest('.hero2') || el.classList.contains('reveal')) return;
      el.classList.add('reveal');
      el.style.setProperty('--d', `${Math.min(i, 6) * step}ms`);
      targets.push(el);
    });
  });
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  targets.forEach(el => io.observe(el));

  // Haberler sonradan yüklenir; gelince onları da izle.
  const latest = document.getElementById('latest');
  if (latest) new MutationObserver(() => {
    latest.querySelectorAll('.news:not(.reveal)').forEach((el, i) => {
      el.classList.add('reveal'); el.style.setProperty('--d', `${i * 90}ms`); io.observe(el);
    });
  }).observe(latest, { childList: true });

  // 2) Üst üste katlanan kartlar ve 3) telefonlarda derinlik
  const cards = [...document.querySelectorAll('.stack-card')];
  const front = document.querySelector('.devices .phone.front');
  const back = document.querySelector('.devices .phone.back');
  const hero = document.querySelector('.hero2');
  let ticking = false;

  function update() {
    ticking = false;
    const vh = window.innerHeight;
    cards.forEach((card, i) => {
      const next = cards[i + 1];
      if (!next) { card.style.setProperty('--s', 1); card.style.setProperty('--dim', 0); return; }
      // Bir sonraki kart bu kartın üstüne ne kadar bindi? (0 → 1)
      const a = card.getBoundingClientRect(), b = next.getBoundingClientRect();
      const overlap = Math.min(Math.max((a.bottom - b.top) / a.height, 0), 1);
      card.style.setProperty('--s', (1 - overlap * 0.06).toFixed(4));
      card.style.setProperty('--dim', (overlap * 0.35).toFixed(3));
    });
    if (hero && front && back) {
      const r = hero.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh) {
        const y = Math.max(0, -r.top);
        front.style.setProperty('--py', `${(-y * 0.08).toFixed(1)}px`);
        back.style.setProperty('--py', `${(y * 0.05).toFixed(1)}px`);
      }
    }
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();
