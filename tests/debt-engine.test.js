// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../debt-engine.js");

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ≈${expected}, got ${actual}`);
};

// Spec "Worked example": $6,000 at 24.99%, $300/month; transfer at 0% for 6 months, 5% fee, then 24.99%
const visa = { id: "visa", name: "Visa", kind: "card", limit: 8000, buckets: [{ balance: 6000, apr: 24.99 }] };
const transfer = {
  type: "transfer", moveIds: ["visa"], promoApr: 0, promoMonths: 6,
  feePct: 5, feeMin: 0, goToApr: 24.99, limit: 10000,
};

test("worked example: current path costs about $1,841 in interest", () => {
  const run = E.simulate([visa], { budget: 300 });
  near(run.totalInterest, 1841, 2, "baseline interest");
  assert.equal(run.neverPaysOff, false);
});

test("worked example: transfer costs about $952 interest + $300 fee and saves about $590", () => {
  const r = E.analyze([visa], 300, transfer);
  near(r.meta.fee, 300, 0.01, "transfer fee");
  near(r.totalInterest, 952, 2, "scenario interest");
  near(r.totalCost, 1252, 2, "total cost");
  near(r.netSaved, 590, 3, "net saved");
  assert.equal(r.monthsSaved, 2, "months saved");
});

test("worked example: break-even month 3, $4,500 left at promo end, $1,050 to clear in time", () => {
  const r = E.analyze([visa], 300, transfer);
  assert.equal(r.breakEven, 3);
  near(r.balanceAtPromoEnd, 4500, 0.01, "balance at promo end");
  near(r.requiredPayment, 1050, 0.01, "required payment");
  // About $364 of interest avoided by month 3, more than the $300 fee
  const avoided = r.baseline.months.slice(0, 3).reduce((s, x) => s + x.interest, 0)
    - r.run.months.slice(0, 3).reduce((s, x) => s + x.interest, 0);
  near(avoided, 364, 2, "interest avoided by month 3");
});

test("worked example: paying $1,050/month clears the promo balance with no interest", () => {
  const r = E.analyze([visa], 1050, transfer);
  assert.equal(r.balanceAtPromoEnd, 0);
  near(r.totalInterest, 0, 0.01, "interest");
});

test("effective promo APR: a 5% fee over 6 months is roughly 10% APR or more", () => {
  const r = E.analyze([visa], 1050, transfer);
  assert.ok(r.effectivePromoApr > 9 && r.effectivePromoApr < 25, `got ${r.effectivePromoApr}`);
});

test("default minimum: greater of $35 or 1% of balance + interest, capped at what's owed", () => {
  near(E.minimumPayment(undefined, 6000, 124.95), 184.95, 0.001, "1% + interest");
  near(E.minimumPayment(undefined, 500, 5), 35, 0.001, "$35 floor");
  near(E.minimumPayment(undefined, 20, 0.5), 20.5, 0.001, "capped at balance");
  near(E.minimumPayment({ type: "percent", pct: 2, floor: 25 }, 6000, 100), 120, 0.001, "2% rule");
});

test("transfer is capped at the credit limit minus the fee, and flagged", () => {
  const r = E.analyze([visa], 300, { ...transfer, limit: 4200 });
  near(r.meta.amount + r.meta.fee, 4200, 0.01, "new balance equals limit");
  assert.equal(r.meta.exceedsLimit, true);
  // The rest stays on the old card
  const old = r.debts.find((d) => d.id === "visa");
  near(old.buckets[0].balance, 6000 - r.meta.amount, 0.01, "left on Visa");
});

test("payment below interest never pays off and the needed budget is found", () => {
  const run = E.simulate([visa], { budget: 100 });
  assert.equal(run.budgetShort, true);
  const big = { ...visa, buckets: [{ balance: 20000, apr: 29.99 }] };
  const stuck = E.simulate([big], { budget: 400, strategy: "avalanche" });
  assert.equal(stuck.neverPaysOff, true);
  const needed = E.minimumBudgetToPayOff([big]);
  assert.ok(needed > 499 && needed < 700, `needed ${needed}`);
  assert.equal(E.simulate([big], { budget: needed }).neverPaysOff, false);
});

const cards = [
  { id: "a", name: "Big low APR", kind: "card", buckets: [{ balance: 5000, apr: 12 }] },
  { id: "b", name: "Small high APR", kind: "card", buckets: [{ balance: 800, apr: 29.99 }] },
  { id: "c", name: "Small mid APR", kind: "card", buckets: [{ balance: 400, apr: 18 }] },
];

test("avalanche targets the highest APR; snowball the lowest balance", () => {
  const av = E.simulate(cards, { budget: 400, strategy: "avalanche" });
  const sb = E.simulate(cards, { budget: 400, strategy: "snowball" });
  assert.equal(av.months[0].target, "b");
  assert.equal(sb.months[0].target, "c");
  assert.ok(sb.totalInterest >= av.totalInterest, "snowball never beats avalanche on interest");
  assert.ok(sb.payoffMonth.c < av.payoffMonth.c, "snowball clears the small card sooner");
});

test("custom order follows the user's list", () => {
  const run = E.simulate(cards, { budget: 400, strategy: "custom", order: ["a", "c", "b"] });
  assert.equal(run.months[0].target, "a");
});

test("deferred interest is charged back when the promo balance isn't cleared", () => {
  const store = { id: "s", name: "Store card", kind: "card", buckets: [{ balance: 2000, apr: 26.99, promoApr: 0, promoMonths: 6, deferred: true }] };
  const late = E.simulate([store], { budget: 200 });
  assert.ok(late.months[5].deferredCharged > 150, "back-charged at month 6");
  const onTime = E.simulate([store], { budget: 400 });
  assert.equal(onTime.monthsToPayoff <= 6, true);
  assert.equal(onTime.months.reduce((s, x) => s + x.deferredCharged, 0), 0);
});

const promoPair = (goToApr, deferred = false) => [
  { id: "hi", name: "High", kind: "card", buckets: [{ balance: 3000, apr: 27 }] },
  { id: "p", name: "Promo", kind: "card", buckets: [{ balance: 3000, apr: goToApr, promoApr: 0, promoMonths: 6, deferred }] },
];

// Avalanche already moves to a promo card once its rate jumps, so pacing only pays off
// when the jump is steep and the budget tight (or with deferred interest, below)
test("promo-aware paces a promo card when that saves interest", () => {
  const debts = promoPair(45);
  const promo = E.simulate(debts, { budget: 500 });
  const avalanche = E.simulate(debts, { budget: 500, strategy: "avalanche" });
  assert.equal(promo.pacedPromo, true);
  assert.ok(promo.months[5].byDebt.p.balance < avalanche.months[5].byDebt.p.balance, "less left at expiry");
  assert.ok(promo.totalInterest < avalanche.totalInterest, "and less interest overall");
});

test("promo-aware paces a deferred-interest promo card", () => {
  const debts = promoPair(26, true);
  const promo = E.simulate(debts, { budget: 800 });
  const avalanche = E.simulate(debts, { budget: 800, strategy: "avalanche" });
  assert.equal(promo.pacedPromo, true);
  assert.ok(promo.totalInterest < avalanche.totalInterest, "avoids the back-charge");
});

test("promo-aware falls back to avalanche when pacing would cost more", () => {
  // The promo card's go-to APR (26%) is below the other card's 27%
  const debts = promoPair(26);
  const promo = E.simulate(debts, { budget: 700 });
  const avalanche = E.simulate(debts, { budget: 700, strategy: "avalanche" });
  assert.equal(promo.strategy, "promo");
  assert.equal(promo.pacedPromo, false);
  assert.equal(promo.totalInterest, avalanche.totalInterest);
});

test("promo-aware pays full-APR cards first when the promo card clears anyway", () => {
  const debts = [
    { id: "hi", name: "High", kind: "card", buckets: [{ balance: 1000, apr: 27 }] },
    { id: "p", name: "Promo", kind: "card", buckets: [{ balance: 600, apr: 22, promoApr: 0, promoMonths: 12 }] },
  ];
  const run = E.simulate(debts, { budget: 500 });
  assert.equal(run.strategy, "promo");
  assert.equal(run.months[0].target, "hi");
  assert.ok(run.payoffMonth.p <= 12, "promo card cleared before expiry");
  assert.ok(run.payoffMonth.hi < run.payoffMonth.p, "full-APR card cleared first");
});

test("mixed-APR card: payments above the minimum go to the highest-APR balance first", () => {
  const mixed = { id: "m", name: "Mixed", kind: "card", buckets: [{ balance: 1000, apr: 10 }, { balance: 1000, apr: 30 }] };
  const E2 = E.applyMove([mixed], {});
  const run = E.simulate(E2.debts, { budget: 600, maxMonths: 1 });
  assert.ok(run.months[0].byDebt.m.balance < 2000);
  // Re-run by hand: the 30% bucket should drop much more than the 10% one
  const state = E.applyMove([mixed], {}).debts;
  E.simulate(state, { budget: 600, maxMonths: 1 });
  // simulate clones, so check through a 2-month run instead
  const two = E.simulate([mixed], { budget: 600, maxMonths: 2 });
  assert.ok(two.months[1].interest < two.months[0].interest * 0.8, "high-APR portion paid down first");
});

test("consolidation loan pays a fixed amortized amount", () => {
  const r = E.analyze(cards, 400, { type: "loan", moveIds: ["a", "b", "c"], apr: 11, termMonths: 36, feePct: 3 });
  near(r.meta.principal, 6200 * 1.03, 0.01, "principal with fee");
  near(r.meta.payment, E.loanPayment(6386, 11, 36), 0.01, "payment");
  assert.equal(r.monthsToPayoff <= 36, true);
});

test("extra one-time payment shortens payoff", () => {
  const r = E.analyze([visa], 300, { type: "extra", amount: 1000, month: 1 });
  assert.ok(r.monthsSaved > 0 && r.netSaved > 0);
});

test("0% purchase card frees cash for high-APR debt", () => {
  const r = E.analyze([visa], 300, { type: "purchase", promoApr: 0, promoMonths: 12, goToApr: 22, limit: 3000, spendAmount: 200 });
  assert.ok(r.netSaved > 0, `net ${r.netSaved}`);
});
