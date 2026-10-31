// ===== Debt payoff engine =====
// Pure functions, no DOM: every scenario runs through one month-by-month simulation.
// Loaded by the page (window.DebtEngine) and by the unit tests (require).
//
// A debt here is:
//   { id, name, kind: "card" | "loan", limit, minRule, buckets: [bucket] }
//   bucket = { balance, apr, promoApr?, promoMonths?, deferred? }  (APRs in %, e.g. 24.99)
//   minRule = { type: "standard", floor, pct }  greater of floor or pct% of balance + interest
//           | { type: "percent", floor, pct }   greater of floor or pct% of balance
//           | { type: "fixed", amount }         loans
// Month 1 is this month's payment.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DebtEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_MONTHS = 600;
  const EPS = 0.005;
  const DEFAULT_MIN_RULE = { type: "standard", floor: 35, pct: 1 };

  const sum = (list, fn = (x) => x) => list.reduce((total, x) => total + fn(x), 0);
  const round2 = (n) => Math.round(n * 100) / 100;

  // ----- Rates and minimums -----
  const inPromo = (b, m) => Boolean(b.promoMonths) && m <= b.promoMonths;
  const monthlyRate = (b, m) => (inPromo(b, m) ? b.promoApr || 0 : b.apr) / 100 / 12;

  function minimumPayment(rule = DEFAULT_MIN_RULE, balance, interest) {
    const owed = balance + interest;
    if (owed <= EPS) return 0;
    let min;
    if (rule.type === "fixed") min = rule.amount;
    else if (rule.type === "percent") min = Math.max(rule.floor, (balance * rule.pct) / 100);
    else min = Math.max(rule.floor ?? 35, (balance * (rule.pct ?? 1)) / 100 + interest);
    return Math.min(min, owed);
  }

  // ----- State -----
  function cloneDebts(debts) {
    return debts.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind || "card",
      limit: d.limit || 0,
      minRule: d.minRule || DEFAULT_MIN_RULE,
      buckets: d.buckets.map((b) => ({
        balance: Math.max(0, Number(b.balance) || 0),
        apr: Number(b.apr) || 0,
        promoApr: Number(b.promoApr) || 0,
        promoMonths: Math.max(0, Math.round(Number(b.promoMonths) || 0)),
        deferred: Boolean(b.deferred),
        accrued: b.accrued || 0,
      })),
    }));
  }

  const debtBalance = (d) => sum(d.buckets, (b) => b.balance);

  // Interest and minimum for one debt this month, without changing anything
  function assess(d, m) {
    const interest = d.buckets.map((b) => b.balance * monthlyRate(b, m));
    const balance = debtBalance(d);
    const total = sum(interest);
    return { d, balance, interestByBucket: interest, interest: total, min: minimumPayment(d.minRule, balance, total) };
  }

  // This month's rate across the debt: 0% promo balances sort last
  const currentRate = (row) => (row.balance > EPS ? row.interest / row.balance : 0);

  // ----- Payoff order -----
  function avalancheOrder(rows) {
    return [...rows].sort((a, b) => currentRate(b) - currentRate(a) || a.balance - b.balance);
  }

  function snowballOrder(rows) {
    return [...rows].sort((a, b) => a.balance - b.balance || currentRate(b) - currentRate(a));
  }

  function customOrder(rows, order = []) {
    const rank = (row) => {
      const i = order.indexOf(row.d.id);
      return i === -1 ? Infinity : i;
    };
    const ranked = avalancheOrder(rows);
    return ranked.sort((a, b) => rank(a) - rank(b));
  }

  // Promo-aware pacing: full-APR cards first, unless a promo card would otherwise still
  // carry a balance when its promo ends. Then it gets enough each month to clear in time.
  // simulate() keeps this only when it beats plain avalanche.
  function promoReserves(debts, rows, m, opts) {
    const reserves = [];
    rows.forEach((row) => {
      const promo = row.d.buckets.filter((b) => inPromo(b, m) && b.balance > EPS);
      if (!promo.length) return;
      const end = Math.max(...promo.map((b) => b.promoMonths));
      const left = end - m + 1;
      if (forecastPromoBalance(debts, row.d.id, m, end, opts) <= EPS) return;
      // Minimum payments land on the lowest-rate (promo) balance first
      const need = Math.max(0, (sum(promo, (b) => b.balance) - row.min) / left);
      reserves.push({ row, need, end });
    });
    return reserves.sort((a, b) => a.end - b.end);
  }

  // Balance left on a promo card at the end of its promo if we simply ran avalanche
  function forecastPromoBalance(debts, debtId, from, end, opts) {
    const state = { debts: cloneDebts(debts), deferredCharged: 0 };
    for (let m = from; m <= end; m++) stepMonth(state, m, opts, "avalanche");
    const d = state.debts.find((x) => x.id === debtId);
    return sum(d.buckets.filter((b) => b.promoMonths === end), (b) => b.balance);
  }

  // ----- One month -----
  function extrasFor(opts, m) {
    const extra = sum(opts.extraPayments || [], (e) => (e.month === m ? e.amount : 0));
    const freed = sum(opts.spend || [], (s) => (s.freesCash && m <= s.months ? s.amount : 0));
    return extra + freed;
  }

  // Applies one payment to a debt's buckets: the minimum to the lowest rate first,
  // anything above it to the highest rate first (CARD Act).
  function applyPayment(row, m) {
    const { d } = row;
    d.buckets.forEach((b, i) => {
      if (b.deferred && inPromo(b, m)) b.accrued += (b.balance * b.apr) / 1200;
      b.balance += row.interestByBucket[i];
    });
    const byRate = [...d.buckets].sort((a, b) => monthlyRate(a, m) - monthlyRate(b, m));
    let minPart = Math.min(row.min, row.pay); // the whole payment when the budget falls short
    let extra = row.pay - minPart;
    for (const b of byRate) {
      const take = Math.min(b.balance, minPart);
      b.balance -= take;
      minPart -= take;
    }
    for (const b of byRate.reverse()) {
      const take = Math.min(b.balance, extra);
      b.balance -= take;
      extra -= take;
    }
    d.buckets.forEach((b) => { if (b.balance < EPS) b.balance = 0; });
  }

  function stepMonth(state, m, opts, strategy) {
    const { debts } = state;
    const rows = debts.map((d) => assess(d, m));
    rows.forEach((row) => { row.pay = row.min; });

    // A budget below the minimums pays only what it has, split across the minimums
    const minimums = sum(rows, (r) => r.min);
    const available = opts.budget + extrasFor(opts, m);
    let pool = available - minimums;
    const short = pool < -EPS;
    if (short) {
      const scale = minimums > 0 ? Math.max(0, available) / minimums : 0;
      rows.forEach((row) => { row.pay = row.min * scale; });
      pool = 0;
    }

    const room = (row) => row.balance + row.interest - row.pay;
    let target = null;
    const give = (row, amount) => {
      const amt = Math.min(amount, room(row), pool);
      if (amt <= EPS) return;
      row.pay += amt;
      pool -= amt;
      if (target === null) target = row.d.id;
    };

    const open = rows.filter((r) => room(r) > EPS);
    if (strategy === "promo") {
      promoReserves(debts, rows, m, opts).forEach(({ row, need }) => give(row, need));
    }
    const order = strategy === "snowball" ? snowballOrder(open)
      : strategy === "custom" ? customOrder(open, opts.order)
        : avalancheOrder(open);
    order.forEach((row) => give(row, pool));

    rows.forEach((row) => applyPayment(row, m));

    // Deferred interest: charged back in full if the promo balance isn't $0 at expiry
    let deferredCharged = 0;
    debts.forEach((d) => d.buckets.forEach((b) => {
      if (!b.deferred || b.promoMonths !== m) return;
      if (b.balance > EPS) {
        b.balance += b.accrued;
        deferredCharged += b.accrued;
      }
      b.accrued = 0;
    }));

    // Annual fees and ongoing purchases land after this month's payment
    let fees = 0;
    (opts.annualFees || []).forEach((f) => {
      const d = debts.find((x) => x.id === f.debtId);
      if (d && m > 1 && (m - 1) % 12 === 0 && debtBalance(d) > EPS) {
        d.buckets[0].balance += f.amount;
        fees += f.amount;
      }
    });
    (opts.spend || []).forEach((s) => {
      const d = debts.find((x) => x.id === s.debtId);
      if (d && m <= s.months) d.buckets[s.bucket || 0].balance += s.amount;
    });

    const record = {
      m,
      target,
      short,
      interest: sum(rows, (r) => r.interest) + deferredCharged,
      deferredCharged,
      fees,
      paid: sum(rows, (r) => r.pay),
      byDebt: {},
    };
    rows.forEach((r) => {
      record.byDebt[r.d.id] = { interest: r.interest, payment: r.pay, min: r.min, balance: debtBalance(r.d) };
    });
    record.balance = sum(debts, debtBalance);
    return record;
  }

  // ----- Whole run -----
  // opts: { budget, strategy, order, extraPayments: [{month, amount}],
  //         spend: [{debtId, bucket, amount, months, freesCash}], annualFees: [{debtId, amount}],
  //         upfrontFees, maxMonths }
  //
  // Promo-aware runs both ways: pacing promo cards to clear before expiry, and plain
  // avalanche. It keeps pacing only when that costs less overall (always, when deferred
  // interest is at stake), so it never does worse than avalanche.
  function simulate(debts, opts) {
    const options = { budget: 0, upfrontFees: 0, ...opts };
    const strategy = options.strategy || defaultStrategy(debts);
    if (strategy !== "promo") return runOnce(debts, options, strategy);

    const paced = runOnce(debts, options, "promo");
    const avalanche = runOnce(debts, options, "avalanche");
    const pacedWins = (paced.neverPaysOff === avalanche.neverPaysOff)
      ? paced.totalCost <= avalanche.totalCost + EPS
      : !paced.neverPaysOff;
    return { ...(pacedWins ? paced : avalanche), strategy: "promo", pacedPromo: pacedWins };
  }

  function runOnce(debts, options, strategy) {
    const state = { debts: cloneDebts(debts) };
    const maxMonths = options.maxMonths || MAX_MONTHS;
    const lastSpend = Math.max(0, ...(options.spend || []).map((s) => s.months));
    const months = [];
    const payoffMonth = {};
    let short = false;

    const start = { m: 0, balance: sum(state.debts, debtBalance), byDebt: {} };
    state.debts.forEach((d) => { start.byDebt[d.id] = { balance: debtBalance(d), interest: 0, payment: 0, min: 0 }; });

    let monthsToPayoff = null;
    for (let m = 1; m <= maxMonths; m++) {
      const rec = stepMonth(state, m, options, strategy);
      months.push(rec);
      short = short || rec.short;
      state.debts.forEach((d) => {
        if (payoffMonth[d.id] === undefined && debtBalance(d) <= EPS && m >= lastSpend) payoffMonth[d.id] = m;
      });
      if (rec.balance <= EPS && m >= lastSpend) {
        monthsToPayoff = m;
        break;
      }
    }

    const totalInterest = sum(months, (r) => r.interest);
    const fees = options.upfrontFees + sum(months, (r) => r.fees);
    return {
      strategy,
      pacedPromo: false,
      start,
      months,
      monthsToPayoff,
      neverPaysOff: monthsToPayoff === null,
      budgetShort: short,
      payoffMonth,
      totalInterest: round2(totalInterest),
      fees: round2(fees),
      totalCost: round2(totalInterest + fees),
      totalPaid: round2(sum(months, (r) => r.paid)),
    };
  }

  const hasPromo = (debts) => debts.some((d) => d.buckets.some((b) => b.promoMonths > 0 && b.balance > EPS));
  const defaultStrategy = (debts) => (hasPromo(debts) ? "promo" : "avalanche");

  // ----- Moves -----
  const NEW_ID = "new";

  // Largest transfer that fits: T + max(feePct·T, feeMin) ≤ limit
  function maxTransfer(limit, feePct, feeMin) {
    if (!(limit > 0)) return Infinity;
    const pctFirst = limit / (1 + feePct / 100);
    const t = (feePct / 100) * pctFirst >= feeMin ? pctFirst : limit - feeMin;
    return Math.max(0, t);
  }

  const transferFee = (t, feePct, feeMin) => (t > 0 ? Math.max((feePct / 100) * t, feeMin || 0) : 0);

  // Takes `amount` off the chosen debts, highest APR balance first. Returns what was taken.
  function takeBalances(debts, ids, amount) {
    const pieces = [];
    debts.filter((d) => ids.includes(d.id)).forEach((d) => d.buckets.forEach((b) => pieces.push({ d, b })));
    pieces.sort((x, y) => y.b.apr - x.b.apr);
    let left = amount;
    const taken = {};
    pieces.forEach(({ d, b }) => {
      const t = Math.min(b.balance, left);
      if (t <= 0) return;
      b.balance -= t;
      left -= t;
      taken[d.id] = (taken[d.id] || 0) + t;
    });
    return taken;
  }

  function loanPayment(principal, apr, months) {
    const r = apr / 100 / 12;
    if (r === 0) return principal / months;
    return (principal * r) / (1 - (1 + r) ** -months);
  }

  // Turns a move into transformed debts plus simulation options.
  // move.type: "transfer" | "purchase" | "order" | "extra" | "loan"
  function applyMove(debts, move = {}) {
    const next = cloneDebts(debts);
    const opts = {};
    const meta = { type: move.type || "none", warnings: [] };
    let upfront = 0;

    if (move.type === "transfer") {
      const ids = move.moveIds || [];
      const desired = sum(next.filter((d) => ids.includes(d.id)), debtBalance);
      const cap = maxTransfer(move.limit, move.feePct || 0, move.feeMin || 0);
      const amount = Math.min(desired, cap);
      const taken = takeBalances(next, ids, amount);
      const fee = transferFee(amount, move.feePct || 0, move.feeMin || 0);
      const buckets = [{
        balance: amount + fee, apr: move.goToApr, promoApr: move.promoApr || 0,
        promoMonths: move.promoMonths || 0, deferred: Boolean(move.deferred),
      }];
      if (move.spendAmount > 0) {
        buckets.push({ balance: 0, apr: move.purchaseApr ?? move.goToApr });
        opts.spend = [{ debtId: NEW_ID, bucket: 1, amount: move.spendAmount, months: move.promoMonths || 0 }];
      }
      next.push({ id: NEW_ID, name: move.cardName || "New card", kind: "card", limit: move.limit || 0, minRule: DEFAULT_MIN_RULE, buckets: cloneDebts([{ buckets }])[0].buckets });
      upfront = fee;
      Object.assign(meta, {
        desired, amount, taken, fee, cap,
        exceedsLimit: desired - cap > EPS,
        startBalance: amount + fee,
        requiredPayment: move.promoMonths ? (amount + fee) / move.promoMonths : null,
        promoMonths: move.promoMonths || 0,
        goToApr: move.goToApr,
        deferred: Boolean(move.deferred),
      });
    } else if (move.type === "purchase") {
      // Purchases you'd make anyway go on the 0% card; the cash they free goes to your debts
      const months = Math.min(move.promoMonths || 0, move.spendMonths || move.promoMonths || 0);
      const perMonthCap = move.limit > 0 ? move.limit / Math.max(1, months) : Infinity;
      const amount = Math.min(move.spendAmount || 0, perMonthCap);
      next.push({
        id: NEW_ID, name: move.cardName || "New card", kind: "card", limit: move.limit || 0, minRule: DEFAULT_MIN_RULE,
        buckets: cloneDebts([{ buckets: [{ balance: 0, apr: move.goToApr, promoApr: move.promoApr || 0, promoMonths: move.promoMonths || 0, deferred: Boolean(move.deferred) }] }])[0].buckets,
      });
      opts.spend = [{ debtId: NEW_ID, bucket: 0, amount, months, freesCash: true }];
      Object.assign(meta, {
        amount: amount * months, perMonth: amount, fee: 0, promoMonths: move.promoMonths || 0,
        goToApr: move.goToApr, deferred: Boolean(move.deferred),
        requiredPayment: move.promoMonths ? (amount * months) / move.promoMonths : null,
        exceedsLimit: (move.spendAmount || 0) - perMonthCap > EPS,
      });
    } else if (move.type === "order") {
      opts.strategy = move.strategy || "avalanche";
      opts.order = move.order || [];
    } else if (move.type === "extra") {
      opts.extraPayments = [{ month: Math.max(1, Math.round(move.month || 1)), amount: Math.max(0, move.amount || 0) }];
    } else if (move.type === "loan") {
      const ids = move.moveIds || [];
      const amount = sum(next.filter((d) => ids.includes(d.id)), debtBalance);
      takeBalances(next, ids, amount);
      const fee = ((move.feePct || 0) / 100) * amount;
      const principal = amount + fee;
      const term = Math.max(1, Math.round(move.termMonths || 36));
      const payment = loanPayment(principal, move.apr || 0, term);
      next.push({
        id: NEW_ID, name: move.loanName || "Consolidation loan", kind: "loan", limit: 0,
        minRule: { type: "fixed", amount: payment }, buckets: [{ balance: principal, apr: move.apr || 0 }],
      });
      upfront = fee;
      Object.assign(meta, { amount, fee, principal, payment, term });
    }

    if (move.annualFee > 0 && (move.type === "transfer" || move.type === "purchase")) {
      opts.annualFees = [{ debtId: NEW_ID, amount: move.annualFee }];
      upfront += move.annualFee; // first year's fee is due up front
    }
    opts.upfrontFees = upfront;
    return { debts: next.filter((d) => d.id === NEW_ID || debtBalance(d) > EPS || d.kind === "loan"), opts, meta };
  }

  // ----- Outputs -----
  function cumulative(run, key) {
    let total = 0;
    return run.months.map((r) => (total += r[key]));
  }

  // First month where cumulative interest avoided ≥ fees paid
  function breakEvenMonth(baseline, scenario) {
    if (scenario.fees <= EPS) return null;
    const base = cumulative(baseline, "interest");
    const scen = cumulative(scenario, "interest");
    const n = Math.max(base.length, scen.length);
    for (let i = 0; i < n; i++) {
      const b = base[Math.min(i, base.length - 1)] || 0;
      const s = scen[Math.min(i, scen.length - 1)] || 0;
      if (b - s >= scenario.fees - EPS) return i + 1;
    }
    return null;
  }

  // Highest card balances ÷ card limits over the run (cards with a known limit only)
  function peakUtilization(run, debts) {
    const cards = debts.filter((d) => d.kind !== "loan" && d.limit > 0);
    const limit = sum(cards, (d) => d.limit);
    if (!limit) return null;
    const points = [run.start, ...run.months];
    return Math.max(...points.map((p) => sum(cards, (d) => (p.byDebt[d.id] ? p.byDebt[d.id].balance : 0)))) / limit;
  }

  function promoEndBalance(run, debtId, promoMonths) {
    if (!promoMonths) return null;
    const rec = run.months[promoMonths - 1];
    if (!rec) return 0;
    return rec.byDebt[debtId] ? rec.byDebt[debtId].balance : 0;
  }

  // Fee ÷ average balance during promo × (12 ÷ promo months)
  function effectivePromoApr(run, fee, promoMonths) {
    if (!promoMonths || !fee) return null;
    const recs = run.months.slice(0, promoMonths);
    const avg = sum(recs, (r) => (r.byDebt[NEW_ID] ? r.byDebt[NEW_ID].balance : 0)) / promoMonths;
    if (avg <= EPS) return null;
    return (fee / avg) * (12 / promoMonths) * 100;
  }

  // Interest ÷ total payment for one month (drives "Where your payment goes")
  function interestShare(record) {
    return record.paid > EPS ? Math.min(1, record.interest / record.paid) : 0;
  }

  // Smallest monthly budget (rounded up to $5) that pays everything off within 600 months
  function minimumBudgetToPayOff(debts, opts = {}) {
    const runAt = (budget) => simulate(debts, { ...opts, budget, maxMonths: MAX_MONTHS });
    const total = sum(cloneDebts(debts), debtBalance);
    let lo = 0;
    let hi = Math.max(50, total);
    if (runAt(hi).neverPaysOff) return null;
    for (let i = 0; i < 40 && hi - lo > 1; i++) {
      const mid = (lo + hi) / 2;
      if (runAt(mid).neverPaysOff) lo = mid;
      else hi = mid;
    }
    return Math.ceil(hi / 5) * 5;
  }

  // Everything a scenario card or comparison row needs, against the current path
  function analyze(debts, budget, move) {
    const baseline = simulate(debts, { budget });
    const built = applyMove(debts, move);
    const run = simulate(built.debts, { budget, ...built.opts });
    return { baseline, run, ...summarize(baseline, run, built, debts) };
  }

  function summarize(baseline, run, built, originalDebts) {
    const { meta } = built;
    const months = run.monthsToPayoff;
    const promoEnd = meta.promoMonths ? promoEndBalance(run, NEW_ID, meta.promoMonths) : null;
    const allDebts = [...originalDebts, ...built.debts.filter((d) => d.id === NEW_ID)];
    return {
      meta,
      debts: built.debts,
      monthsToPayoff: months,
      monthsSaved: months !== null && baseline.monthsToPayoff !== null ? baseline.monthsToPayoff - months : null,
      totalInterest: run.totalInterest,
      fees: run.fees,
      totalCost: run.totalCost,
      netSaved: round2(baseline.totalInterest - (run.totalInterest + run.fees)),
      breakEven: breakEvenMonth(baseline, run),
      peakUtilization: peakUtilization(run, allDebts),
      balanceAtPromoEnd: promoEnd,
      effectivePromoApr: effectivePromoApr(run, meta.fee || 0, meta.promoMonths),
      requiredPayment: meta.requiredPayment ?? null,
      neverPaysOff: run.neverPaysOff,
      budgetShort: run.budgetShort,
    };
  }

  return {
    MAX_MONTHS,
    NEW_ID,
    DEFAULT_MIN_RULE,
    minimumPayment,
    simulate,
    applyMove,
    analyze,
    summarize,
    breakEvenMonth,
    peakUtilization,
    interestShare,
    minimumBudgetToPayOff,
    maxTransfer,
    transferFee,
    loanPayment,
    defaultStrategy,
  };
});
