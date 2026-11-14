// Sayfalarda ortak küçük yardımcılar. Hiçbir veri gönderilmez.
window.FonOrtak = {
  // "1.234.567,89" ya da "1234567.89" biçimlerini sayıya çevirir.
  num(s) {
    s = String(s || '').replace(/\s|TL/gi, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    const v = parseFloat(s);
    return isFinite(v) ? v : 0;
  }
};
