// Fon Defterim hesapları: iPhone uygulamasındaki kuralların (FonKit: Portfolio, Recovery, Fund) birebir aktarımı.
// Toplamalar Swift'teki sırayla yapılır; böylece rakamlar kuruşu kuruşuna aynı çıkar. Hiçbir veri gönderilmez.
window.FonHesap = (function () {
  'use strict';

  const REFERENCE_DAY = '2026-09-16';
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  // Broker.clean / Broker.key
  const brokerClean = s => { const t = String(s == null ? '' : s).trim(); return t ? t : null; };
  const brokerKey = s => { const c = brokerClean(s); return c == null ? null : c.toLocaleLowerCase('tr-TR'); };
  const brokerCompatible = (a, b) => { const ka = brokerKey(a), kb = brokerKey(b); return ka == null || kb == null || ka === kb; };

  // Fund.referencePrice: 16.09 fiyatı; yoksa son fiyat ancak 16.09 ya da öncesine aitse ya da tarihsizse.
  function referencePrice(f) {
    if (f.price1609 != null && f.price1609 > 0) return f.price1609;
    if (!(f.lastPrice != null && f.lastPrice > 0)) return null;
    if (!f.priceDate) return f.lastPrice;
    return f.priceDate <= REFERENCE_DAY ? f.lastPrice : null;
  }
  function referencePriceDate(f) {
    if (f.price1609 != null && f.price1609 > 0) return REFERENCE_DAY;
    return referencePrice(f) == null ? null : f.priceDate || null;
  }

  const amountOf = t => t.enteredAmount != null ? t.enteredAmount : t.units * t.unitPrice;
  const isAmountOnly = t => t.enteredAmount != null;
  const BUY = 'Alış', SELL = 'Satış';

  function part(key, name, ub, us, ab, as, paid) {
    return { key, name, unitsBought: ub, unitsSold: us, amountBought: ab, amountSold: as, paymentsReceived: paid,
      // BrokerPart.countedNetInvestment: eksi çıkan kurum 0 sayılır.
      get countedNetInvestment() { return Math.max(0, this.amountBought - this.amountSold); } };
  }

  // Portfolio.brokerParts
  function brokerParts(trades, payments) {
    if (!trades.length) return [[], 0];
    const order = [], names = new Map(), groups = new Map();
    for (const tr of trades) {
      const k = brokerKey(tr.broker);
      if (!groups.has(k)) { order.push(k); names.set(k, brokerClean(tr.broker)); groups.set(k, []); }
      groups.get(k).push(tr);
    }
    const paid = new Map(); let unassigned = 0;
    for (const p of payments) {
      const k = brokerKey(p.broker);
      if (groups.has(k)) paid.set(k, (paid.get(k) || 0) + p.amount); else unassigned += p.amount;
    }
    const parts = order.map(k => {
      const g = groups.get(k) || [];
      const b = g.filter(t => t.side === BUY), s = g.filter(t => t.side === SELL);
      return part(k, names.get(k), sum(b, t => t.units), sum(s, t => t.units), sum(b, amountOf), sum(s, amountOf), paid.get(k) || 0);
    });
    return [parts, unassigned];
  }

  // FundPosition
  function position(o) {
    const p = Object.assign({}, o);
    p.parts = p.brokers.length ? p.brokers
      : [part(null, null, p.unitsBought, p.unitsSold, p.amountBought, p.amountSold, p.paymentsReceived - p.unassignedPayments)];
    p.hasMultipleBrokers = p.brokers.length > 1;
    p.tradedRemainingUnits = p.unitsBought - p.unitsSold;
    p.remainingUnits = p.units1609Override != null ? p.units1609Override : p.tradedRemainingUnits;
    p.unitsUnknown = p.hasAmountOnlyTrades && p.units1609Override == null;
    p.missingPrice1609 = p.priceUsed <= 0 && p.remainingUnits > 0 && !p.unitsUnknown;
    p.netInvestment = sum(p.parts, x => x.countedNetInvestment);
    p.netInvestmentNetted = p.amountBought - p.amountSold;
    p.value1609 = p.unitsUnknown ? 0 : p.remainingUnits * p.priceUsed;
    p.profitLoss = p.value1609 - p.netInvestmentNetted;
    p.remainingClaim1609Netted = p.value1609 - p.paymentsReceived - p.expectedPayment;
    p.remainingClaim1609 = Math.max(0, p.remainingClaim1609Netted);
    const perBroker = sum(p.parts, x => Math.max(0, x.countedNetInvestment - x.paymentsReceived));
    p.remainingClaimNet = Math.max(0, perBroker - p.unassignedPayments - p.expectedPayment);
    p.remainingClaimNetNetted = p.netInvestmentNetted - p.paymentsReceived - p.expectedPayment;
    p.legalCap = sum(p.parts, x => Math.min(x.countedNetInvestment, p.interimPaymentCap));
    p.receivedToNetInvestment = p.netInvestment > 0 ? p.paymentsReceived / p.netInvestment : null;
    p.receivedToValue1609 = p.value1609 > 0 ? p.paymentsReceived / p.value1609 : null;
    p.isActive = p.unitsBought !== 0 || p.unitsSold !== 0 || p.paymentsReceived !== 0 || p.amountBought !== 0 || p.amountSold !== 0
      || (p.units1609Override || 0) !== 0;
    p.remainingClaim = basis => basis === 'Net yatırım' ? p.remainingClaimNet : p.remainingClaim1609;
    p.remainingClaimNetted = basis => basis === 'Net yatırım' ? p.remainingClaimNetNetted : p.remainingClaim1609Netted;
    return p;
  }

  // Store.funds: liste + kullanıcının eklediği (listede olmayan) fonlar.
  function fundList(catalog, customFunds) {
    const codes = new Set(catalog.map(f => f.code));
    return catalog.concat((customFunds || []).filter(c => !codes.has(c.code)));
  }

  // Portfolio.positions
  function positions(funds, profile) {
    const trades = profile.trades || [], payments = profile.payments || [], overrides = profile.overrides || {};
    const cap = (profile.parameters && profile.parameters.interimPaymentCap) != null ? profile.parameters.interimPaymentCap : 1000000;
    const known = new Set(funds.map(f => f.code));
    const extra = [...new Set(trades.map(t => t.fundCode).concat(payments.map(p => p.fundCode)))].filter(c => !known.has(c)).sort();
    const all = funds.concat(extra.map(code => ({ code })));
    return all.map(fund => {
      const t = trades.filter(x => x.fundCode === fund.code);
      const buys = t.filter(x => x.side === BUY), sells = t.filter(x => x.side === SELL);
      const ov = overrides[fund.code];
      const pays = payments.filter(x => x.fundCode === fund.code);
      const [parts, unassigned] = brokerParts(t, pays);
      const ref = referencePrice(fund);
      return position({
        fund,
        unitsBought: sum(buys, x => x.units), unitsSold: sum(sells, x => x.units),
        amountBought: sum(buys, amountOf), amountSold: sum(sells, amountOf),
        priceUsed: (ov && ov.userPrice != null) ? ov.userPrice : (ref != null ? ref : 0),
        paymentsReceived: sum(pays, x => x.amount),
        expectedPayment: (ov && ov.expectedPayment != null) ? ov.expectedPayment : 0,
        interimPaymentCap: cap,
        brokers: parts, unassignedPayments: unassigned,
        units1609Override: ov && ov.units1609 != null ? ov.units1609 : null,
        hasAmountOnlyTrades: t.some(isAmountOnly),
      });
    });
  }

  const activePositions = (funds, profile) => positions(funds, profile).filter(p => p.isActive);

  // Portfolio.summary(of:)
  function summary(pos, basis) {
    const s = {
      totalNetInvestment: sum(pos, p => p.netInvestment),
      totalValue1609: sum(pos, p => p.value1609),
      totalReceived: sum(pos, p => p.paymentsReceived),
      claimValue: sum(pos, p => p.remainingClaim(basis)),
      totalNetInvestmentNetted: sum(pos, p => p.netInvestmentNetted),
      claimValueNetted: Math.max(0, sum(pos, p => p.remainingClaimNetted(basis))),
    };
    s.profitLoss = s.totalValue1609 - s.totalNetInvestmentNetted;
    s.nettingChangesResult = Math.abs(s.claimValue - s.claimValueNetted) > 0.5 || Math.abs(s.totalNetInvestment - s.totalNetInvestmentNetted) > 0.5;
    return s;
  }

  // Recovery: '16.09' ya da 'net'
  const EPS = 0.005;
  function recoveryOf(p, basis) {
    return basis === 'net'
      ? { base: p.netInvestment, received: p.paymentsReceived, remaining: Math.max(p.remainingClaimNet, 0) }
      : { base: p.value1609, received: p.paymentsReceived, remaining: Math.max(p.remainingClaim1609, 0) };
  }
  function recovery(pos, basis) {
    const parts = pos.map(p => recoveryOf(p, basis));
    const r = {
      base: sum(parts, x => x.base), received: sum(parts, x => x.received),
      remaining: basis === 'net' ? sum(pos, p => p.remainingClaimNet) : sum(pos, p => p.remainingClaim1609),
    };
    return decorate(r);
  }
  function decorate(r) {
    r.ratio = r.base > EPS ? r.received / r.base : null;
    r.isBaseNonPositive = r.base <= EPS;
    r.fraction = r.ratio != null ? Math.min(Math.max(r.ratio, 0), 1) : (r.isBaseNonPositive ? 1 : 0);
    r.isComplete = r.isBaseNonPositive || r.received >= r.base - EPS;
    return r;
  }
  const fundRecovery = (p, basis) => decorate(recoveryOf(p, basis));

  // Portfolio.paymentAnalyses (yalnızca ekranda kullanılan oranlar)
  function paymentAnalyses(pos, payments) {
    const byCode = new Map(); pos.forEach(p => { if (!byCode.has(p.fund.code)) byCode.set(p.fund.code, p); });
    const running = {};
    return payments.map((p, i) => [p, i]).sort((a, b) => a[0].date === b[0].date ? a[1] - b[1] : (dayMs(a[0].date) - dayMs(b[0].date)))
      .map(([p]) => {
        running[p.fundCode] = (running[p.fundCode] || 0) + p.amount;
        const ps = byCode.get(p.fundCode);
        return { payment: p, position: ps, cumulativeReceived: running[p.fundCode],
          toValue1609: ps && ps.value1609 > 0 ? p.amount / ps.value1609 : null,
          toNetInvestment: ps && ps.netInvestment > 0 ? p.amount / ps.netInvestment : null };
      });
  }
  const dayMs = iso => Date.parse(iso);

  // ---------- Tarihler (uygulama tarihleri Türkiye saatine göre gün başı olarak saklar) ----------
  const TR_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
  // ISO tarih → "yyyy-mm-dd" (Türkiye saatine göre gün)
  const isoDay = iso => { const d = new Date(iso); return isNaN(d) ? '' : TR_DAY.format(d); };
  // "yyyy-mm-dd" → Türkiye saatiyle gün başının ISO yazımı (Swift'in okuyabileceği biçim: salise yok).
  function dayISO(day) {
    const [y, m, d] = String(day).split('-').map(Number);
    let t = Date.UTC(y, m - 1, d) - 3 * 3600 * 1000;
    // Türkiye 2016'dan beri sabit UTC+3; öncesi için gerçek farkı Intl'den düzelt.
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
      const get = k => +parts.find(x => x.type === k).value;
      const shift = (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour')) - Date.UTC(y, m - 1, d)) ;
      if (!shift) break;
      t -= shift;
    }
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  // Portfolio.tradesAfterReferenceDate
  function tradesAfterReference(profile) {
    const ref = profile.parameters && profile.parameters.referenceDate ? isoDay(profile.parameters.referenceDate) : REFERENCE_DAY;
    return (profile.trades || []).filter(t => isoDay(t.date) > ref);
  }

  // Parameters.defaults (v1.3 Excel'in 03.11.2026 varsayılanları), uygulamanın yedek dosyasındaki yazımıyla.
  const DEFAULT_PARAMETERS = {
    advanceInterest: 0.3975, appealCostIfLost: 0, claimBasis: '16.09.2026 değeri', costsRecoveredIfWon: true,
    courtFeeRate: 0.06831, courtFeeUpfrontShare: 0.25, durations: [3, 5, 7], expenseAdvance: 15000, fxChoice: 'Alış',
    interestStartDate: '2026-09-15T21:00:00Z', interestType: 'Yasal faiz', interimPaymentCap: 1000000, lawyerFixedFee: 50000,
    lawyerSuccessRate: 0.06, legalInterest2026: 0.31, projectionScenario: 'Baz', referenceDate: '2026-09-15T21:00:00Z',
    scenarios: [
      'İyimser', { fxDepreciation: 0.12, inflation: 0.18, legalInterest: 0.2, usInflation: 0.025 },
      'Baz', { fxDepreciation: 0.2, inflation: 0.25, legalInterest: 0.26, usInflation: 0.03 },
      'Kötümser', { fxDepreciation: 0.32, inflation: 0.35, legalInterest: 0.31, usInflation: 0.035 },
    ],
    usdTryBuying1609: 48.5779, usdTrySelling1609: 48.6654, usdTryToday: 49.96,
  };
  const defaultParameters = () => JSON.parse(JSON.stringify(DEFAULT_PARAMETERS));

  // ---------- Dava senaryoları (FonKit: Lawsuit.swift, LossEstimate.swift, Parameters) ----------
  const SCENARIOS = ['İyimser', 'Baz', 'Kötümser'];
  // Yedekte senaryolar ["İyimser", {...}, "Baz", {...}] biçiminde durur.
  function assumptions(p, s) {
    const arr = Array.isArray(p.scenarios) ? p.scenarios : [];
    const i = arr.indexOf(s);
    const d = DEFAULT_PARAMETERS.scenarios[DEFAULT_PARAMETERS.scenarios.indexOf(s) + 1];
    return i >= 0 && arr[i + 1] && typeof arr[i + 1] === 'object' ? Object.assign({}, d, arr[i + 1]) : d;
  }
  const P = p => Object.assign({}, DEFAULT_PARAMETERS, p || {});
  const interestRate = (p, s) => p.interestType === 'Avans faizi' ? p.advanceInterest : assumptions(p, s).legalInterest;
  const usdTry1609 = p => p.fxChoice === 'Satış' ? p.usdTrySelling1609 : p.usdTryBuying1609;
  const addYears = (iso, y) => { const d = isoDay(iso); return d ? (+d.slice(0, 4) + y) + d.slice(4) : ''; };

  const MAKTU_LOW = 30000, MAKTU_HIGH = 40000, FIXED_COURT_FEES = 1000;
  const TIERS = [[600000, 0.16], [600000, 0.15], [1200000, 0.14], [1200000, 0.13], [1800000, 0.11],
    [2400000, 0.08], [3000000, 0.05], [3600000, 0.03], [4200000, 0.02], [Infinity, 0.01]];
  function proportionalFee(claim) {
    if (!(claim > 0)) return 0;
    let left = claim, fee = 0;
    for (const [w, r] of TIERS) { if (!(left > 0)) break; const part = Math.min(left, w); fee += part * r; left -= part; }
    return Math.min(fee, claim);
  }
  const opposingAttorneyFee = (claim, p) => p.opposingAttorneyFee != null ? p.opposingAttorneyFee : Math.round(claim * 0.04 / 1000) * 1000;

  function lawsuitOutcome(claim, scenario, years, params) {
    const p = P(params), a = assumptions(p, scenario), y = years;
    const rate = interestRate(p, scenario);
    const interest = claim * rate * y, gross = claim + interest;
    const fee = claim * p.courtFeeRate, feeUpfront = fee * p.courtFeeUpfrontShare;
    const unrecovered = p.costsRecoveredIfWon ? 0 : fee + p.expenseAdvance;
    const success = gross * p.lawyerSuccessRate;
    const awarded = proportionalFee(claim);
    const offset = p.awardedFeeOffset ? Math.min(awarded, p.lawyerFixedFee + success) : 0;
    const net = gross - unrecovered - p.lawyerFixedFee - success + offset;
    const inflF = Math.pow(1 + a.inflation, y), fx = usdTry1609(p) * Math.pow(1 + a.fxDepreciation, y), usInfl = Math.pow(1 + a.usInflation, y);
    const usdAt = net / fx, claimUSD = usdTry1609(p) > 0 ? claim / usdTry1609(p) : 0;
    const o = {
      scenario, years, collectionDay: addYears(p.interestStartDate, y), principal: claim, interestRate: rate, interest, grossJudgment: gross,
      courtFee: fee, courtFeeUpfront: feeUpfront, expenseAdvance: p.expenseAdvance, unrecoveredCosts: unrecovered,
      lawyerFixedFee: p.lawyerFixedFee, lawyerSuccessFee: success, awardedAttorneyFee: awarded, awardedFeeOffset: offset,
      netNominal: net, inflationFactor: inflF, netReal: net / inflF, fxAtCollection: fx, netUSDAtCollection: usdAt,
      usInflationFactor: usInfl, netUSDToday: usdAt / usInfl, claimUSD1609: claimUSD,
      costIfLost: feeUpfront + p.expenseAdvance + p.lawyerFixedFee + opposingAttorneyFee(claim, p) + p.appealCostIfLost,
    };
    o.purchasingPowerRatio = claim > 0 ? o.netReal / claim : 0;
    o.usdGainLoss = o.netUSDToday - claimUSD;
    o.usdGainLossPercent = claimUSD > 0 ? o.netUSDToday / claimUSD - 1 : 0;
    return o;
  }
  const lawsuitOutcomes = (claim, params) => SCENARIOS.flatMap(s => P(params).durations.map(y => lawsuitOutcome(claim, s, y, params)));
  function lawsuitProjection(claim, scenario, params, years = 8) {
    const p = P(params), a = assumptions(p, scenario), rate = interestRate(p, scenario);
    return Array.from({ length: years + 1 }, (_, t) => {
      const nominal = claim + claim * rate * t, cpi = 100 * Math.pow(1 + a.inflation, t);
      const fx = usdTry1609(p) * Math.pow(1 + a.fxDepreciation, t), usd = nominal / fx, usCPI = 100 * Math.pow(1 + a.usInflation, t);
      return { year: t, day: addYears(p.interestStartDate, t), nominal, real: nominal / (cpi / 100), usd, usdToday: usd / (usCPI / 100) };
    });
  }
  function lossEstimate(claim, params) {
    const p = P(params);
    const e = {
      claim,
      opposingMaktuLow: p.opposingAttorneyFee != null ? p.opposingAttorneyFee : MAKTU_LOW,
      opposingMaktuHigh: p.opposingAttorneyFee != null ? p.opposingAttorneyFee : MAKTU_HIGH,
      opposingProportional: proportionalFee(claim),
      upfrontCourtFee: claim * p.courtFeeRate * p.courtFeeUpfrontShare,
      fixedCourtFees: FIXED_COURT_FEES, expenses: p.expenseAdvance, ownLawyerFee: p.lawyerFixedFee, appealCosts: p.appealCostIfLost,
    };
    e.otherCosts = e.fixedCourtFees + e.expenses + e.appealCosts;
    e.totalMaktuLow = e.opposingMaktuLow + e.otherCosts;
    e.totalMaktuHigh = e.opposingMaktuHigh + e.otherCosts;
    e.totalProportional = e.opposingProportional + e.otherCosts;
    return e;
  }

  return {
    SCENARIOS, lawsuitOutcome, lawsuitOutcomes, lawsuitProjection, lossEstimate, proportionalFee,
    REFERENCE_DAY, BUY, SELL, defaultParameters, brokerClean, brokerKey, brokerCompatible, referencePrice, referencePriceDate,
    amountOf, isAmountOnly, fundList, positions, activePositions, summary, recovery, fundRecovery,
    paymentAnalyses, isoDay, dayISO, tradesAfterReference,
  };
})();
