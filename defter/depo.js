// Web defterinin kayıt katmanı: defter yalnızca bu tarayıcıda (IndexedDB) saklanır, hiçbir yere gönderilmez.
// Yedek dosyası iPhone uygulamasının .fondefterim biçimiyle birebir aynıdır (FonKit/Backup.swift):
// dış kabuk JSON; şifreliyse AES-GCM 256, anahtar şifreden PBKDF2-SHA256 (210.000 tur) ile türetilir.
window.FonDepo = (function () {
  'use strict';
  const DB = 'fondefterim', STORE = 'kv', MAGIC = 'FONDEFTERIM-YEDEK', ITER = 210000;
  const SNAPSHOTS = 3;

  // ---------- IndexedDB ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) { rej(new Error('Bu tarayıcı kayıt tutamıyor.')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('Kayıt alanı açılamadı.'));
      r.onblocked = () => rej(new Error('Defter başka bir sekmede güncelleniyor. Diğer sekmeleri kapatıp yenile.'));
    });
    return dbp;
  }
  async function get(key) {
    const d = await db();
    return new Promise((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function put(entries) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
      for (const [k, v] of Object.entries(entries)) st.put(v, k);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Kaydedilemedi.'));
    });
  }

  // ---------- Model (FonKit: Ledger, Profile) ----------
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16))).toUpperCase();
  const newProfile = (name, colorIndex = 0) => ({ id: uuid(), name, colorIndex, trades: [], payments: [], overrides: {}, parameters: window.FonHesap.defaultParameters() });
  function newLedger() {
    const p = newProfile('Ben');
    return { version: 2, profiles: [p], activeProfileID: p.id, customFunds: [], acceptedDisclaimer: false };
  }

  // Ledger.decode: eksik alanları tamamlar, eski (v1, kişisiz) biçimi tek kişilik deftere taşır.
  // Bilinmeyen alanlar (hatırlatmalar, aracı kurum alacakları…) olduğu gibi korunur.
  function normalizeLedger(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('corrupt');
    let l;
    if (Array.isArray(raw.profiles)) {
      l = raw;
    } else {
      const me = newProfile('Ben');
      me.trades = raw.trades || []; me.payments = raw.payments || []; me.overrides = raw.overrides || {};
      if (raw.parameters) me.parameters = raw.parameters;
      l = { version: 2, profiles: [me], activeProfileID: me.id, customFunds: raw.customFunds || [], acceptedDisclaimer: !!raw.acceptedDisclaimer };
    }
    if (typeof l.version !== 'number') l.version = 2;
    if (!Array.isArray(l.customFunds)) l.customFunds = [];
    if (typeof l.acceptedDisclaimer !== 'boolean') l.acceptedDisclaimer = false;
    if (!l.profiles.length) l.profiles = [newProfile('Ben')];
    for (const p of l.profiles) {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('corrupt');
      if (typeof p.colorIndex !== 'number') p.colorIndex = 0;
      if (!Array.isArray(p.trades)) p.trades = [];
      if (!Array.isArray(p.payments)) p.payments = [];
      if (!p.overrides || typeof p.overrides !== 'object') p.overrides = {};
      if (!p.parameters || typeof p.parameters !== 'object') p.parameters = window.FonHesap.defaultParameters();
      for (const t of p.trades) if (!t || typeof t.fundCode !== 'string' || typeof t.date !== 'string' || typeof t.units !== 'number' || typeof t.unitPrice !== 'number') throw new Error('corrupt');
      for (const x of p.payments) if (!x || typeof x.fundCode !== 'string' || typeof x.date !== 'string' || typeof x.amount !== 'number') throw new Error('corrupt');
    }
    if (!l.profiles.some(p => p.id === l.activeProfileID)) l.activeProfileID = l.profiles[0].id;
    return l;
  }

  // ---------- Defter: yükle / kaydet ----------
  let rev = 0;
  async function load() {
    const [ledger, r] = await Promise.all([get('defter'), get('rev')]);
    rev = r || 0;
    return ledger ? normalizeLedger(ledger) : null;
  }
  // Başka bir sekme defteri değiştirdiyse üzerine yazmaz (eski hâlin yenisini silmesini önler).
  async function save(ledger, opts = {}) {
    const current = (await get('rev')) || 0;
    if (current !== rev) { const e = new Error('Defter başka bir sekmede değişti. Sayfa yenileniyor.'); e.conflict = true; throw e; }
    const meta = (await get('meta')) || {};
    if (!opts.noCount) meta.changesSinceBackup = (meta.changesSinceBackup || 0) + 1;
    meta.firstSavedAt = meta.firstSavedAt || new Date().toISOString();
    rev = current + 1;
    await put({ defter: ledger, rev, meta });
  }
  async function meta() { return (await get('meta')) || {}; }
  async function noteBackup() {
    const m = await meta();
    m.lastBackupAt = new Date().toISOString(); m.changesSinceBackup = 0;
    await put({ meta: m });
  }
  async function setMeta(patch) { const m = await meta(); Object.assign(m, patch); await put({ meta: m }); }

  // İçe aktarma ve geri yüklemeden önce otomatik kopya (son 3).
  async function snapshot(ledger, reason) {
    const list = (await get('kopyalar')) || [];
    list.unshift({ at: new Date().toISOString(), reason, ledger: JSON.parse(JSON.stringify(ledger)) });
    await put({ kopyalar: list.slice(0, SNAPSHOTS) });
  }
  async function snapshots() { return (await get('kopyalar')) || []; }

  // Fon listesi (internetten gelen herkese açık liste) internetsiz açılış için saklanır.
  const loadCatalog = () => get('katalog');
  const saveCatalog = c => put({ katalog: c });

  // Tarayıcıdan "bu siteyi temizleme" izni (kalıcı depolama).
  async function persist() {
    if (!navigator.storage || !navigator.storage.persist) return null;
    try { return (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { return null; }
  }
  async function isPersisted() {
    if (!navigator.storage || !navigator.storage.persisted) return null;
    try { return await navigator.storage.persisted(); } catch (e) { return null; }
  }

  // ---------- Yedek dosyası (Backup.swift) ----------
  const enc = new TextEncoder();
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
  const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  class BackupError extends Error {}
  const ERR = {
    notABackup: 'Bu dosya bir Fon Defterim yedeği değil.',
    unsupportedVersion: 'Bu yedek Fon Defterim\'in daha yeni bir sürümüyle alınmış. Sayfayı yenileyip tekrar dene.',
    passwordRequired: 'Bu yedek şifreli. Açmak için şifreyi gir.',
    wrongPassword: 'Şifre yanlış.',
    corrupt: 'Yedek dosyası bozuk.',
  };
  const fail = code => { const e = new BackupError(ERR[code]); e.code = code; throw e; };

  async function makeBackup(ledger, password) {
    if (password) {
      if (!crypto.subtle) throw new Error('Bu tarayıcı şifreli yedek alamıyor (güvenli bağlantı gerekli).');
      const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveKey(password, salt);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, enc.encode(JSON.stringify(ledger))));
      const combined = new Uint8Array(12 + ct.length); combined.set(nonce); combined.set(ct, 12);
      return JSON.stringify({ ciphertext: b64(combined), createdAt: isoNow(), encrypted: true, magic: MAGIC, salt: b64(salt), version: 1 });
    }
    return JSON.stringify({ createdAt: isoNow(), encrypted: false, ledger, magic: MAGIC, version: 1 });
  }

  function envelope(text) {
    if (text.length >= 50000000) fail('notABackup');
    let env;
    try { env = JSON.parse(text); } catch (e) { fail('notABackup'); }
    if (!env || env.magic !== MAGIC || typeof env.version !== 'number' || typeof env.encrypted !== 'boolean' || typeof env.createdAt !== 'string') fail('notABackup');
    if (env.version > 1) fail('unsupportedVersion');
    return env;
  }
  const isEncrypted = text => envelope(text).encrypted;

  async function openBackup(text, password) {
    const env = envelope(text);
    let raw;
    if (env.encrypted) {
      if (!password) fail('passwordRequired');
      if (!env.salt || !env.ciphertext) fail('corrupt');
      let salt, ct;
      try { salt = unb64(env.salt); ct = unb64(env.ciphertext); } catch (e) { fail('corrupt'); }
      if (ct.length < 28) fail('corrupt');
      const key = await deriveKey(password, salt);
      let plain;
      try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.subarray(0, 12) }, key, ct.subarray(12)); } catch (e) { fail('wrongPassword'); }
      try { raw = JSON.parse(new TextDecoder().decode(plain)); } catch (e) { fail('corrupt'); }
    } else {
      if (!env.ledger) fail('corrupt');
      raw = env.ledger;
    }
    let ledger;
    try { ledger = normalizeLedger(raw); } catch (e) { fail('corrupt'); }
    return { ledger, info: {
      createdAt: env.createdAt, profileCount: ledger.profiles.length,
      tradeCount: ledger.profiles.reduce((a, p) => a + p.trades.length, 0),
      paymentCount: ledger.profiles.reduce((a, p) => a + p.payments.length, 0),
      profileNames: ledger.profiles.map(p => p.name),
    } };
  }

  // Backup.merge: yedekteki kişileri yeni kişiler olarak ekler (adlar çakışırsa "(yedek)").
  function mergeBackup(backup, current) {
    const result = JSON.parse(JSON.stringify(current));
    const names = new Set(current.profiles.map(p => p.name));
    for (const p0 of backup.profiles) {
      const p = JSON.parse(JSON.stringify(p0));
      p.id = uuid();
      if (names.has(p.name)) p.name += ' (yedek)';
      result.profiles.push(p);
    }
    for (const f of backup.customFunds) if (!result.customFunds.some(x => x.code === f.code)) result.customFunds.push(f);
    return result;
  }

  return { uuid, newLedger, newProfile, normalizeLedger, load, save, meta, setMeta, noteBackup, snapshot, snapshots,
    loadCatalog, saveCatalog, persist, isPersisted, makeBackup, openBackup, isEncrypted, mergeBackup, BackupError };
})();
