// Fon Defterim'in herkese açık veri dosyasını okur (uygulamanın kullandığı dosyanın aynısı).
// Yalnızca indirme yapılır; ziyaretçiye ait hiçbir bilgi gönderilmez, çerez kullanılmaz.
window.FonVeri = (function () {
  const URL = 'https://fondefterim.github.io/v1/veri.json';
  const KEY = 'fondefterim-veri';
  let pending = null;

  function load() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
      } catch (e) { /* önbellek yoksa ya da erişilemiyorsa indir */ }
      const res = await fetch(URL, { cache: 'no-cache', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) { }
      return data;
    })();
    return pending;
  }

  const trDate = s => {
    if (!s) return '';
    const [y, m, d] = String(s).slice(0, 10).split('-');
    return d && m && y ? `${d}.${m}.${y}` : s;
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeURL = u => /^https:\/\//i.test(u || '') ? u : null;
  const fmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 });
  const money = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sourceName = { spk: 'SPK', kap: 'KAP', mkk: 'MKK', site: 'Fon Defterim' };

  function announcementHTML(a, opts = {}) {
    const url = safeURL(a.url);
    const src = sourceName[a.source] || (a.source ? String(a.source).toUpperCase() : '');
    const title = url ? `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${esc(a.title)}</a>` : esc(a.title);
    const codes = Array.isArray(a.funds) && a.funds.length ? `<span class="chips">${a.funds.slice(0, 8).map(c => `<span class="chip">${esc(c)}</span>`).join('')}</span>` : '';
    return `<article class="ann">
      <div class="ann-meta">${esc(trDate(a.date))}${src ? ` · <span class="chip src">${esc(src)}</span>` : ''}${codes}</div>
      <h3>${title}</h3>
      ${opts.compact ? '' : (a.body ? `<p>${esc(a.body)}</p>` : '')}
    </article>`;
  }

  // Fon Defterim'in kendi haberleri için öne çıkan kart.
  function newsHTML(a) {
    const url = safeURL(a.url);
    return `<article class="news">
      <div class="news-mark" aria-hidden="true"><svg viewBox="0 0 100 106"><path d="M50 3 92 17v35c0 28-20 42-42 51C28 94 8 80 8 52V17Z" fill="currentColor"/><g fill="#fff"><rect x="30" y="34" width="40" height="6" rx="3"/><rect x="30" y="47" width="40" height="6" rx="3"/><rect x="30" y="60" width="27" height="6" rx="3"/></g></svg></div>
      <div>
        <div class="news-meta"><span class="chip own">Fon Defterim</span> ${esc(trDate(a.date))}</div>
        <h3>${url ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(a.title)}</a>` : esc(a.title)}</h3>
        ${a.body ? `<p>${esc(a.body)}</p>` : ''}
      </div>
    </article>`;
  }

  // Fon Defterim'in kendi duyuruları (kaynağı yazmayanlar da bizimdir); diğerleri SPK, KAP gibi resmî kaynaklar.
  const isOwn = a => !a.source || a.source === 'site';
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));

  return { load, trDate, esc, fmt, money, announcementHTML, newsHTML, isOwn, byDate, URL };
})();
