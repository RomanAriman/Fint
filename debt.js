// ===== Debt planner =====
// Screens A–D of the Debt Strategy & Scenario Planner: diagnose, build, compare, act.
// The math lives in debt-engine.js; people and the current view come from script.js.

const Engine = window.DebtEngine;
const DEBT_NAME_MAX = 30;
const SCENARIO_NAME_MAX = 40;
const MAX_SCENARIOS = 3;
const MAX_EXTRA_BALANCES = 2;
const TIMELINE_MAX = 120;
const PROJECTION_MAX = 240;
const TAB_KEY = "finance-tracker-tab";
const SCENARIO_COLORS = ["#2563eb", "#c2410c", "#7e22ce"];
const BASE_COLOR = "#5d6b7a";
const DEBT_COLORS = ["#2563eb", "#c2410c", "#0f766e", "#7e22ce", "#be185d", "#4d7c0f", "#a16207", "#0369a1"];
const NEW_DEBT_COLOR = "#1f2933";

const MOVE_TYPES = [
  { id: "transfer", name: "Balance transfer", desc: "Move balances to a card with a promo rate" },
  { id: "purchase", name: "0% purchase card", desc: "Put everyday purchases on a 0% card and send the freed cash to debt" },
  { id: "order", name: "Payoff order", desc: "Avalanche, snowball or your own order" },
  { id: "extra", name: "Extra payment", desc: "A one-time lump sum, like a tax refund" },
  { id: "loan", name: "Consolidation loan", desc: "Replace card balances with one fixed-rate loan" },
];
const STRATEGY_NAMES = { avalanche: "Avalanche", snowball: "Snowball", custom: "Custom order", promo: "Promo-aware" };

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (n) => currency.format(n);
const moneyWhole = (n) => usd0.format(Math.round(n));
const aprText = (n) => `${Number(n.toFixed(2))}%`;
const percentText = (n) => `${Math.round(n * 100)}%`;
const shortMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};
const monthsBetween = (a, b) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};
// Plan month m (1 = this month) as "YYYY-MM"
const monthOf = (m, start = currentMonth()) => addMonths(start, m - 1);
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svgIcon = (d, cls = "icon") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  warn: "M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
  info: "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0zM12 11v5M12 8h.01",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  calendar: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  arrow: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
};

// ----- Stored data -----
// debt = { id, userId, name, kind, balances: [{ balance, apr }], limit, dueDay, minRule, promo?: { apr, endMonth, deferred } }
// plan (per view) = { budget, scenarios: [{ id, name, move }], draft, active }

function cleanNumber(v, lo, hi) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

// Used for storage and backups: returns a safe copy, or null
function cleanDebt(raw, userIds) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || !userIds.has(raw.userId)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ").slice(0, DEBT_NAME_MAX) : "";
  const kind = raw.kind === "loan" ? "loan" : "card";
  const balances = (Array.isArray(raw.balances) ? raw.balances : [])
    .slice(0, kind === "loan" ? 1 : 1 + MAX_EXTRA_BALANCES)
    .map((b) => (b && typeof b === "object" ? { balance: cleanNumber(b.balance, 0, 1e9), apr: cleanNumber(b.apr, 0, 99.99) } : null))
    .filter((b) => b && b.balance !== null && b.apr !== null);
  if (!name || !balances.length) return null;

  const debt = {
    id: raw.id, userId: raw.userId, name, kind, balances,
    limit: kind === "card" ? cleanNumber(raw.limit, 0, 1e9) || 0 : 0,
    dueDay: Math.round(cleanNumber(raw.dueDay, 1, 28) || 15),
  };
  const rule = raw.minRule && typeof raw.minRule === "object" ? raw.minRule : {};
  if (kind === "loan") debt.minRule = { type: "fixed", amount: cleanNumber(rule.amount, 0, 1e9) || 0 };
  else if (rule.type === "percent") {
    debt.minRule = { type: "percent", pct: cleanNumber(rule.pct, 0.5, 20) ?? 2, floor: cleanNumber(rule.floor, 0, 1000) ?? 25 };
  } else debt.minRule = { ...Engine.DEFAULT_MIN_RULE };
  const p = raw.promo;
  if (kind === "card" && p && typeof p === "object" && isValidMonth(p.endMonth)) {
    debt.promo = { apr: cleanNumber(p.apr, 0, 99.99) ?? 0, endMonth: p.endMonth, deferred: Boolean(p.deferred) };
  }
  return debt;
}

const MOVE_FIELDS = {
  promoApr: [0, 99.99], promoMonths: [0, 60], feePct: [0, 20], feeMin: [0, 1000], goToApr: [0, 99.99],
  limit: [0, 1e9], limitLow: [0, 1e9], limitHigh: [0, 1e9], annualFee: [0, 10000], spendAmount: [0, 1e6],
  purchaseApr: [0, 99.99], amount: [0, 1e9], month: [1, 600], apr: [0, 99.99], termMonths: [1, 360],
};

function cleanMove(raw) {
  if (!raw || typeof raw !== "object" || !MOVE_TYPES.some((t) => t.id === raw.type)) return null;
  const move = { type: raw.type };
  Object.entries(MOVE_FIELDS).forEach(([k, [lo, hi]]) => {
    if (raw[k] === "" || raw[k] === undefined) return;
    const n = cleanNumber(raw[k], lo, hi);
    if (n !== null) move[k] = n;
  });
  ["unsure", "deferred", "spendOn"].forEach((k) => { if (raw[k]) move[k] = true; });
  if (Array.isArray(raw.moveIds)) move.moveIds = raw.moveIds.filter((id) => typeof id === "string").slice(0, 50);
  if (Array.isArray(raw.order)) move.order = raw.order.filter((id) => typeof id === "string").slice(0, 50);
  if (["avalanche", "snowball", "custom"].includes(raw.strategy)) move.strategy = raw.strategy;
  return move;
}

function cleanPlan(raw) {
  if (!raw || typeof raw !== "object") return null;
  const plan = { budget: cleanNumber(raw.budget, 0, 1e7), scenarios: [], draft: cleanMove(raw.draft), active: null };
  (Array.isArray(raw.scenarios) ? raw.scenarios : []).slice(0, MAX_SCENARIOS).forEach((s) => {
    const move = s && cleanMove(s.move);
    if (!move || typeof s.id !== "string") return;
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, SCENARIO_NAME_MAX) : moveName(move);
    plan.scenarios.push({ id: s.id, name, move });
  });
  const a = raw.active;
  if (a && typeof a === "object" && isValidMonth(a.startMonth)) {
    plan.active = {
      scenarioId: typeof a.scenarioId === "string" ? a.scenarioId : null,
      name: typeof a.name === "string" ? a.name.slice(0, SCENARIO_NAME_MAX) : "My plan",
      move: cleanMove(a.move),
      budget: cleanNumber(a.budget, 0, 1e7) || 0,
      startMonth: a.startMonth,
      applied: Boolean(a.applied),
      newDebtId: typeof a.newDebtId === "string" ? a.newDebtId : null,
      done: a.done && typeof a.done === "object" ? Object.fromEntries(Object.entries(a.done).filter(([, v]) => v === true)) : {},
      projection: Array.isArray(a.projection) ? a.projection.slice(0, PROJECTION_MAX).filter((p) => p && typeof p === "object") : [],
      updates: Array.isArray(a.updates) ? a.updates.filter((u) => u && isValidMonth(u.month)).slice(-120) : [],
    };
  }
  return plan;
}

function cleanPlans(raw, userIds) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.entries(raw).forEach(([key, value]) => {
    if (key !== FAMILY && !userIds.has(key)) return;
    const plan = cleanPlan(value);
    if (plan) out[key] = plan;
  });
  return out;
}

let debts = [];
let debtPlans = {};

function loadDebtState() {
  const ids = new Set(users.map((u) => u.id));
  debts = loadJSON(DEBTS_KEY, []).map((d) => cleanDebt(d, ids)).filter(Boolean);
  debtPlans = cleanPlans(loadJSON(DEBT_PLANS_KEY, {}), ids);
}
loadDebtState();

function saveDebts() {
  saveJSON(DEBTS_KEY, debts);
  noteChange();
}

function savePlans() {
  saveJSON(DEBT_PLANS_KEY, debtPlans);
}

const planKey = () => (isFamily() ? FAMILY : view);
function currentPlan() {
  const key = planKey();
  if (!debtPlans[key]) debtPlans[key] = { budget: null, scenarios: [], draft: null, active: null };
  return debtPlans[key];
}
const viewDebts = () => debts.filter(inView);

// ----- Engine bridge -----
function toEngine(debt) {
  const promoMonths = debt.promo ? monthsBetween(currentMonth(), debt.promo.endMonth) + 1 : 0;
  const buckets = debt.balances.map((b, i) => ({
    balance: b.balance,
    apr: b.apr,
    ...(i === 0 && debt.promo && promoMonths > 0
      ? { promoApr: debt.promo.apr, promoMonths, deferred: debt.promo.deferred } : {}),
  }));
  return { id: debt.id, name: debt.name, kind: debt.kind, limit: debt.limit, minRule: debt.minRule, buckets };
}

const debtTotal = (d) => d.balances.reduce((s, b) => s + b.balance, 0);
const currentApr = (d, i = 0) => (i === 0 && d.promo && monthsBetween(currentMonth(), d.promo.endMonth) >= 0 ? d.promo.apr : d.balances[i].apr);

function minimumsNow(engineDebts) {
  const run = Engine.simulate(engineDebts, { budget: 0, maxMonths: 1 });
  return run.months[0] ? Object.values(run.months[0].byDebt).reduce((s, x) => s + x.min, 0) : 0;
}

// Everything the screens share for the current view, computed once per render
function buildModel() {
  const list = viewDebts();
  const eng = list.map(toEngine);
  const mins = minimumsNow(eng);
  const plan = currentPlan();
  const budget = plan.budget ?? Math.ceil(mins / 10) * 10;
  const baseline = Engine.simulate(eng, { budget });
  const colors = {};
  list.forEach((d, i) => { colors[d.id] = DEBT_COLORS[i % DEBT_COLORS.length]; });
  colors[Engine.NEW_ID] = NEW_DEBT_COLOR;
  const names = Object.fromEntries(list.map((d) => [d.id, d.name]));
  return { list, eng, mins, budget, baseline, plan, colors, names };
}

// A saved or draft move run against the current path
function runMove(M, move, budget = M.budget) {
  const built = Engine.applyMove(M.eng, engineMove(move, M));
  const baseline = budget === M.budget ? M.baseline : Engine.simulate(M.eng, { budget });
  const run = Engine.simulate(built.debts, { budget, ...built.opts });
  return { built, run, baseline, s: Engine.summarize(baseline, run, built, M.eng) };
}

// Fills in what the engine needs: names, defaults, the strategy for "order" moves
function engineMove(move, M) {
  const m = { ...move };
  if (m.type === "order") {
    m.strategy = m.strategy || "avalanche";
    m.order = (m.order || []).filter((id) => M.names[id]);
  }
  if (m.type === "transfer") m.purchaseApr = m.spendOn ? m.purchaseApr ?? m.goToApr : undefined;
  if (m.type === "transfer" && !m.spendOn) m.spendAmount = 0;
  return m;
}

function moveName(move) {
  const t = MOVE_TYPES.find((x) => x.id === move.type);
  if (move.type === "order") return STRATEGY_NAMES[move.strategy || "avalanche"];
  if (move.type === "extra" && move.amount) return `Extra ${moneyWhole(move.amount)}`;
  return t ? t.name : "Scenario";
}

// What's missing before a move can run, or ""
function moveProblem(move, M) {
  if (!M.list.length) return "Add a debt on step 1 first.";
  if (move.type === "transfer" || move.type === "loan") {
    const ids = (move.moveIds || []).filter((id) => M.names[id]);
    if (!ids.length) return move.type === "loan" ? "Choose at least one balance to consolidate." : "Choose at least one balance to move.";
  }
  if (move.type === "transfer" || move.type === "purchase") {
    if (!(move.promoMonths > 0)) return "Enter the promo length in months.";
    if (move.goToApr === undefined) return "Enter the APR after the promo (go-to APR).";
    if (!(move.limit > 0)) return "Enter the credit limit you expect. Not sure? Tick the box and give a low and high guess.";
  }
  if (move.type === "purchase" && !(move.spendAmount > 0)) return "Enter how much you'd put on the card each month.";
  if (move.type === "extra" && !(move.amount > 0)) return "Enter the extra amount.";
  if (move.type === "loan") {
    if (move.apr === undefined) return "Enter the loan's APR.";
    if (!(move.termMonths > 0)) return "Enter the loan term in months.";
  }
  return "";
}

// ----- Tabs -----
let activeTab = loadJSON(TAB_KEY, { tab: "spending", step: "a" });
if (!activeTab || typeof activeTab !== "object") activeTab = { tab: "spending", step: "a" };

const spendingPanel = document.getElementById("spending-panel");
const debtPanel = document.getElementById("debt-panel");
const appTabs = [...document.querySelectorAll(".app-tab")];
const stepTabs = [...document.querySelectorAll(".debt-step")];

function showTab(tab, { focus = false } = {}) {
  activeTab.tab = tab === "debt" ? "debt" : "spending";
  saveJSON(TAB_KEY, activeTab);
  document.body.dataset.tab = activeTab.tab;
  appTabs.forEach((t) => {
    const on = t.dataset.tab === activeTab.tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  spendingPanel.hidden = activeTab.tab !== "spending";
  debtPanel.hidden = activeTab.tab !== "debt";
  if (activeTab.tab === "debt") renderDebt();
}

function showStep(step, { focus = false } = {}) {
  activeTab.step = ["a", "b", "c", "d"].includes(step) ? step : "a";
  saveJSON(TAB_KEY, activeTab);
  stepTabs.forEach((t) => {
    const on = t.dataset.step === activeTab.step;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    if (on && focus) t.focus();
  });
  renderDebt();
}

// Arrow keys move between tabs (WAI-ARIA tabs pattern)
function tabKeys(list, activate) {
  list.forEach((tab, i) => tab.addEventListener("keydown", (e) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: list.length - 1 - i };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = list[(i + moves[e.key] + list.length) % list.length];
    activate(next, true);
  }));
}

appTabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
stepTabs.forEach((t) => t.addEventListener("click", () => showStep(t.dataset.step)));
tabKeys(appTabs, (t, focus) => showTab(t.dataset.tab, { focus }));
tabKeys(stepTabs, (t, focus) => showStep(t.dataset.step, { focus }));

function goToStep(step) {
  showStep(step);
  document.getElementById(`step-${step}`).focus();
  debtPanel.scrollIntoView({ block: "start", behavior: "smooth" });
}

debtPanel.addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) goToStep(go.dataset.goto);
  if (e.target.closest('[data-action="add-debt"]')) openDebtDialog();
});

// ----- Render -----
function renderDebt() {
  if (activeTab.tab !== "debt") return;
  const M = buildModel();
  const empty = !M.list.length;
  document.getElementById("debt-empty").hidden = !empty;
  document.getElementById("debt-a-body").hidden = empty;
  if (activeTab.step === "a" && !empty) renderDiagnosis(M);
  if (activeTab.step === "b") renderBuilder(M);
  if (activeTab.step === "c") renderCompare(M);
  if (activeTab.step === "d") renderPlan(M);
}

function warningChip(text, tone = "warn", detail = "") {
  return `<li class="chip-warn tone-${tone}">${svgIcon(tone === "info" ? ICONS.info : ICONS.warn)}<span><strong>${esc(text)}</strong>${detail ? ` ${esc(detail)}` : ""}</span></li>`;
}

function payoffLabel(months) {
  return months === null ? "Never at this pace" : shortMonth(monthOf(months));
}

// ===== Screen A: Where you stand =====
const aBudget = document.getElementById("a-budget");

function renderDiagnosis(M) {
  const { list, baseline, budget, mins } = M;
  const total = list.reduce((s, d) => s + debtTotal(d), 0);
  const weighted = total > 0
    ? list.reduce((s, d) => s + d.balances.reduce((x, b, i) => x + b.balance * currentApr(d, i), 0), 0) / total : 0;
  const first = baseline.months[0];
  const interestNow = first ? first.interest : 0;

  document.getElementById("hero-stats").innerHTML = [
    ["Total debt", moneyWhole(total), `${list.length} ${list.length === 1 ? "debt" : "debts"}`],
    ["Weighted APR", aprText(weighted), "by balance, at today's rates"],
    ["Interest this month", money(interestNow), first && first.paid ? `${percentText(Engine.interestShare(first))} of this month's payment` : "", "stat-alert"],
    ["Debt-free", payoffLabel(baseline.monthsToPayoff), baseline.neverPaysOff ? `not at ${moneyWhole(budget)}/month` : `at ${moneyWhole(budget)}/month · ${baseline.monthsToPayoff} months`],
  ].map(([label, value, sub, cls = ""]) => `
    <div class="stat ${cls}">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${esc(value)}</span>
      <span class="stat-sub">${esc(sub)}</span>
    </div>`).join("");

  if (document.activeElement !== aBudget) aBudget.value = budget;
  document.getElementById("a-budget-hint").textContent = `Minimum payments add up to ${money(mins)} this month.`;
  document.getElementById("a-warnings").innerHTML = budgetWarnings(M, baseline);

  // Where your payment goes
  document.getElementById("split-month").textContent = shortMonth(currentMonth());
  const rows = list.map((d) => ({ d, ...(first ? first.byDebt[d.id] : { payment: 0, interest: 0 }) }));
  const maxPay = Math.max(1, ...rows.map((r) => Math.max(r.payment, r.interest)));
  document.getElementById("split-lead").textContent = first && first.paid
    ? `This month, ${money(interestNow)} of your ${money(first.paid)} payment goes to interest. Only ${money(Math.max(0, first.paid - interestNow))} pays down what you owe.`
    : "";
  document.getElementById("pay-split").innerHTML = rows.filter((r) => r.payment > 0.005 || r.interest > 0.005).map((r) => {
    const principal = Math.max(0, r.payment - r.interest);
    const short = r.payment + 0.005 < r.interest;
    const width = (Math.max(r.payment, r.interest) / maxPay) * 100;
    return `<li>
      <div class="split-head"><span class="split-name">${esc(r.d.name)}</span>
        <span class="split-total">${money(r.payment)}</span></div>
      <div class="split-track" aria-hidden="true"><div class="split-bar" style="width:${width}%">
        <span class="seg-interest" style="flex:${Math.max(r.interest, 0.0001)}"></span>
        <span class="seg-principal" style="flex:${Math.max(principal, 0.0001)}"></span>
      </div></div>
      <p class="split-text">${short
    ? `<strong class="text-danger">Doesn't cover the ${money(r.interest)} of interest</strong>`
    : `${money(r.interest)} interest · ${money(principal)} principal`}</p>
    </li>`;
  }).join("");

  // Card list, with "Costliest" on the highest dollar interest
  const costliest = rows.reduce((top, r) => (r.interest > (top ? top.interest : 0) ? r : top), null);
  document.getElementById("debt-rows").innerHTML = rows.map((r) => {
    const d = r.d;
    const owner = isFamily() ? userById(d.userId) : null;
    const promoActive = d.promo && monthsBetween(currentMonth(), d.promo.endMonth) >= 0;
    const apr = promoActive ? `${aprText(d.promo.apr)} <span class="muted">→ ${aprText(d.balances[0].apr)}</span>` : d.balances.map((b) => aprText(b.apr)).join(" / ");
    const util = d.kind === "card" && d.limit > 0 ? percentText(debtTotal(d) / d.limit) : "—";
    const tags = [];
    if (costliest && costliest.d.id === d.id && r.interest > 0) tags.push('<span class="badge badge-danger">Costliest</span>');
    if (promoActive) tags.push(`<span class="badge">${d.promo.deferred ? "Deferred " : ""}promo until ${esc(shortMonth(d.promo.endMonth))}</span>`);
    if (d.kind === "loan") tags.push('<span class="badge">Loan</span>');
    return `<tr>
      <th scope="row"><span class="debt-name"><i class="debt-dot" style="background:${M.colors[d.id]}" aria-hidden="true"></i>${esc(d.name)}</span>
        ${owner ? `<span class="debt-owner">${esc(owner.name)}</span>` : ""}${tags.length ? `<span class="debt-tags">${tags.join("")}</span>` : ""}</th>
      <td class="num">${money(debtTotal(d))}</td>
      <td class="num">${apr}</td>
      <td class="num">${money(r.min || 0)}</td>
      <td class="num">${money(r.interest)}</td>
      <td class="num">${util}</td>
      <td class="row-actions">
        <button type="button" class="icon-btn-sm" data-edit="${esc(d.id)}" aria-label="Edit ${esc(d.name)}">${svgIcon(ICONS.edit)}</button>
        <button type="button" class="icon-btn-sm danger" data-delete="${esc(d.id)}" aria-label="Delete ${esc(d.name)}">${svgIcon(ICONS.trash)}</button>
      </td>
    </tr>`;
  }).join("");
}

function budgetWarnings(M, run) {
  const out = [];
  // Minimums can rise later (a promo ends, deferred interest lands), so say when it starts
  const short = run.months.find((r) => r.short);
  if (short) {
    const minsThen = Object.values(short.byDebt).reduce((s, x) => s + x.min, 0);
    out.push(warningChip(short.m === 1
      ? `Your budget is below this month's minimums (${money(M.mins)}).`
      : `From ${shortMonth(monthOf(short.m))}, your minimums (${money(minsThen)}) will be more than ${moneyWhole(M.budget)}.`,
    "danger", "Missing a minimum payment can add fees and penalty rates."));
  }
  if (run.neverPaysOff) {
    const need = Engine.minimumBudgetToPayOff(M.eng);
    out.push(warningChip("Payment doesn't cover interest — this never pays off.", "danger",
      need ? `Paying at least ${moneyWhole(need)}/month would.` : ""));
  }
  const deferred = run.months.find((r) => r.deferredCharged > 0);
  if (deferred) {
    out.push(warningChip(`${money(deferred.deferredCharged)} of deferred interest gets charged in ${shortMonth(monthOf(deferred.m))}.`, "danger",
      "Pay the promo balance to $0 before then to avoid it."));
  }
  return out.join("");
}

aBudget.addEventListener("change", () => setBudget(aBudget.value));

function setBudget(value) {
  const n = cleanNumber(value, 0, 1e7);
  if (n === null) return;
  currentPlan().budget = Math.round(n);
  savePlans();
  renderDebt();
}

document.getElementById("debt-rows").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  if (edit) openDebtDialog(debts.find((d) => d.id === edit.dataset.edit));
  if (del) deleteDebt(del.dataset.delete);
});

function deleteDebt(id) {
  const d = debts.find((x) => x.id === id);
  if (!d || !window.confirm(`Delete ${d.name}? Its balance leaves every scenario and plan.`)) return;
  debts = debts.filter((x) => x.id !== id);
  saveDebts();
  renderDebt();
  document.querySelector('[data-action="add-debt"]:not([hidden])')?.focus();
}

// ----- Add / edit dialog -----
const debtDialog = document.getElementById("debt-dialog");
const debtForm = document.getElementById("debt-form");
const dEl = (id) => document.getElementById(id);
let editingDebtId = null;

function fillDaySelect(select) {
  if (select.options.length) return;
  for (let i = 1; i <= 28; i++) select.append(new Option(`${ordinal(i)} of the month`, String(i)));
}
fillDaySelect(dEl("d-due"));
fillDaySelect(dEl("d-due-loan"));

function debtKind() {
  return debtForm.querySelector('input[name="debt-kind"]:checked').value;
}

function syncDebtForm() {
  const loan = debtKind() === "loan";
  debtForm.querySelector(".card-only").hidden = loan;
  debtForm.querySelector(".loan-only").hidden = !loan;
  dEl("d-min-percent").hidden = dEl("d-min-rule").value !== "percent";
  dEl("d-promo").hidden = !dEl("d-has-promo").checked;
  dEl("d-add-balance").hidden = dEl("d-extra-balances").children.length >= MAX_EXTRA_BALANCES;
}

function extraBalanceRow(b = { balance: "", apr: "" }) {
  const n = dEl("d-extra-balances").children.length + 2;
  const row = document.createElement("div");
  row.className = "field-pair extra-balance";
  row.innerHTML = `
    <div class="field"><label>Balance ${n}</label>
      <div class="amount-field amount-sm"><span aria-hidden="true">$</span><input type="number" class="x-balance" min="0" step="0.01" inputmode="decimal" value="${esc(b.balance)}" aria-label="Balance ${n}"></div></div>
    <div class="field"><label>APR ${n}</label>
      <div class="amount-field amount-sm suffix with-remove"><input type="number" class="x-apr" min="0" max="99" step="0.01" value="${esc(b.apr)}" aria-label="APR ${n}"><span aria-hidden="true">%</span>
      <button type="button" class="icon-btn-sm x-remove" aria-label="Remove balance ${n}">${svgIcon(CLOSE_ICON)}</button></div></div>`;
  row.querySelector(".x-remove").addEventListener("click", () => {
    row.remove();
    syncDebtForm();
    dEl("d-add-balance").focus();
  });
  dEl("d-extra-balances").append(row);
  syncDebtForm();
  return row;
}

function showDebtError(message, field) {
  dEl("debt-error-text").textContent = message;
  dEl("debt-error").hidden = !message;
  debtForm.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
}

function openDebtDialog(debt = null) {
  editingDebtId = debt ? debt.id : null;
  debtForm.reset();
  dEl("d-extra-balances").replaceChildren();
  showDebtError("");
  dEl("debt-dialog-title").textContent = debt ? `Edit ${debt.name}` : "Add a debt";
  dEl("debt-save").textContent = debt ? "Save changes" : "Save debt";

  // Whose debt: only when the family view could mean several people
  const ownerField = dEl("d-owner-field");
  ownerField.hidden = !isFamily();
  if (isFamily()) {
    dEl("d-owner").replaceChildren(...familyMembers().map((u) => new Option(u.name, u.id)));
    dEl("d-owner").value = debt ? debt.userId : familyMembers()[0].id;
  }

  if (debt) {
    debtForm.querySelector(`input[name="debt-kind"][value="${debt.kind}"]`).checked = true;
    dEl("d-name").value = debt.name;
    dEl("d-balance").value = debt.balances[0].balance;
    dEl("d-apr").value = debt.balances[0].apr;
    debt.balances.slice(1).forEach((b) => extraBalanceRow(b));
    dEl("d-limit").value = debt.limit || "";
    dEl("d-due").value = String(debt.dueDay);
    dEl("d-due-loan").value = String(debt.dueDay);
    if (debt.kind === "loan") dEl("d-payment").value = debt.minRule.amount || "";
    dEl("d-min-rule").value = debt.minRule.type === "percent" ? "percent" : "standard";
    if (debt.minRule.type === "percent") {
      dEl("d-min-pct").value = debt.minRule.pct;
      dEl("d-min-floor").value = debt.minRule.floor;
    }
    dEl("d-has-promo").checked = Boolean(debt.promo);
    if (debt.promo) {
      dEl("d-promo-apr").value = debt.promo.apr;
      dEl("d-promo-end").value = debt.promo.endMonth;
      dEl("d-promo-deferred").checked = debt.promo.deferred;
    }
  } else {
    dEl("d-due").value = "15";
    dEl("d-due-loan").value = "15";
  }
  dEl("d-promo-end").min = currentMonth();
  syncDebtForm();
  debtDialog.showModal();
  dEl("d-name").focus();
}

function readDebtForm() {
  const kind = debtKind();
  const name = dEl("d-name").value.trim().replace(/\s+/g, " ");
  if (!name) return showDebtError("Please enter a name.", dEl("d-name"));
  const balance = cleanNumber(dEl("d-balance").value, 0.01, 1e9);
  if (balance === null) return showDebtError("Please enter a balance greater than 0.", dEl("d-balance"));
  const apr = cleanNumber(dEl("d-apr").value, 0, 99.99);
  if (apr === null) return showDebtError("Please enter an APR between 0% and 99.99%.", dEl("d-apr"));

  const debt = {
    id: editingDebtId || `d${Date.now()}`,
    userId: isFamily() ? dEl("d-owner").value : view,
    name: name.slice(0, DEBT_NAME_MAX),
    kind,
    balances: [{ balance, apr }],
  };

  if (kind === "loan") {
    const payment = cleanNumber(dEl("d-payment").value, 0.01, 1e9);
    if (payment === null) return showDebtError("Please enter the loan's monthly payment.", dEl("d-payment"));
    debt.minRule = { type: "fixed", amount: payment };
    debt.dueDay = Number(dEl("d-due-loan").value);
    debt.limit = 0;
    return debt;
  }

  for (const row of dEl("d-extra-balances").children) {
    const b = cleanNumber(row.querySelector(".x-balance").value, 0.01, 1e9);
    if (b === null) return showDebtError("Please enter a balance greater than 0, or remove that row.", row.querySelector(".x-balance"));
    const a = cleanNumber(row.querySelector(".x-apr").value, 0, 99.99);
    if (a === null) return showDebtError("Please enter an APR between 0% and 99.99%.", row.querySelector(".x-apr"));
    debt.balances.push({ balance: b, apr: a });
  }
  const limitRaw = dEl("d-limit").value;
  const limit = limitRaw === "" ? 0 : cleanNumber(limitRaw, 1, 1e9);
  if (limit === null) return showDebtError("Please enter a credit limit above $0, or leave it empty.", dEl("d-limit"));
  debt.limit = limit;
  debt.dueDay = Number(dEl("d-due").value);

  if (dEl("d-min-rule").value === "percent") {
    const pct = cleanNumber(dEl("d-min-pct").value, 0.5, 20);
    if (pct === null) return showDebtError("Please enter a percent between 0.5% and 20%.", dEl("d-min-pct"));
    const floor = cleanNumber(dEl("d-min-floor").value, 0, 1000);
    if (floor === null) return showDebtError("Please enter a minimum dollar amount.", dEl("d-min-floor"));
    debt.minRule = { type: "percent", pct, floor };
  } else {
    debt.minRule = { ...Engine.DEFAULT_MIN_RULE };
  }

  if (dEl("d-has-promo").checked) {
    const promoApr = cleanNumber(dEl("d-promo-apr").value, 0, 99.99);
    if (promoApr === null) return showDebtError("Please enter the promo APR.", dEl("d-promo-apr"));
    const end = dEl("d-promo-end").value;
    if (!isValidMonth(end) || end < currentMonth()) {
      return showDebtError("Please enter the month the promo ends (this month or later).", dEl("d-promo-end"));
    }
    debt.promo = { apr: promoApr, endMonth: end, deferred: dEl("d-promo-deferred").checked };
  }
  return debt;
}

debtForm.addEventListener("change", (e) => {
  if (e.target.matches('input[name="debt-kind"], #d-min-rule, #d-has-promo')) syncDebtForm();
});
dEl("d-add-balance").addEventListener("click", () => extraBalanceRow().querySelector(".x-balance").focus());
dEl("debt-dialog-close").addEventListener("click", () => debtDialog.close());
dEl("debt-cancel").addEventListener("click", () => debtDialog.close());

debtForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const debt = readDebtForm();
  if (!debt) return;
  const i = debts.findIndex((d) => d.id === debt.id);
  if (i === -1) debts.push(debt);
  else debts[i] = debt;
  saveDebts();
  debtDialog.close();
  renderDebt();
});

// ===== Screen B: Scenario builder =====
const builderForm = document.getElementById("builder-form");
const bBudget = document.getElementById("b-budget");
const bBudgetRange = document.getElementById("b-budget-range");
const bName = document.getElementById("b-name");
const moveFields = document.getElementById("move-fields");
let editingScenarioId = null;
let builderFieldsFor = null; // which move type the fields were drawn for

function defaultMove(type, M) {
  const cards = M.list.filter((d) => d.kind === "card");
  const noPromo = cards.filter((d) => !d.promo).map((d) => d.id);
  switch (type) {
    case "transfer":
      return { type, promoApr: 0, promoMonths: 15, feePct: 3, feeMin: 5, goToApr: 24.99, moveIds: noPromo.length ? noPromo : cards.map((d) => d.id) };
    case "purchase":
      return { type, promoApr: 0, promoMonths: 12, goToApr: 24.99, spendAmount: 300 };
    case "order":
      return { type, strategy: "snowball", order: [...M.list].sort((a, b) => debtTotal(a) - debtTotal(b)).map((d) => d.id) };
    case "extra":
      return { type, amount: 1000, month: 1 };
    default:
      return { type: "loan", apr: 11.99, termMonths: 36, feePct: 3, moveIds: cards.map((d) => d.id) };
  }
}

function draftMove(M) {
  const plan = M.plan;
  if (!plan.draft) plan.draft = defaultMove("transfer", M);
  return plan.draft;
}

const val = (v) => (v === undefined || v === null ? "" : esc(v));

function numberField(id, label, value, { prefix = "", suffix = "", step = "0.01", min = 0, max, hint = "" } = {}) {
  return `<div class="field">
    <label for="${id}">${label}</label>
    <div class="amount-field amount-sm${suffix ? " suffix" : ""}">${prefix ? `<span aria-hidden="true">${prefix}</span>` : ""}
      <input type="number" id="${id}" data-key="${id.replace("m-", "")}" min="${min}"${max !== undefined ? ` max="${max}"` : ""} step="${step}" inputmode="decimal" value="${val(value)}">
      ${suffix ? `<span aria-hidden="true">${suffix}</span>` : ""}</div>
    ${hint ? `<span class="field-hint">${hint}</span>` : ""}</div>`;
}

function balanceToggles(M, move, label) {
  const picked = new Set(move.moveIds || []);
  const cards = M.list.filter((d) => d.kind === "card");
  if (!cards.length) return `<p class="field-hint">Add a credit card on step 1 to use this move.</p>`;
  return `<fieldset class="balance-toggles"><legend class="field-label">${label}</legend>
    ${cards.map((d) => `<label class="check-row toggle-row">
      <input type="checkbox" data-move-id="${esc(d.id)}"${picked.has(d.id) ? " checked" : ""}>
      <span>${esc(d.name)}</span><span class="muted">${money(debtTotal(d))} at ${aprText(currentApr(d))}</span></label>`).join("")}
  </fieldset>`;
}

function renderMoveFields(M, move) {
  const termsNote = '<p class="terms-note">Copy these terms from the issuer\'s offer or statement.</p>';
  let html = "";
  if (move.type === "transfer") {
    html = `${termsNote}
      <div class="field-pair">${numberField("m-promoApr", "Promo APR", move.promoApr, { suffix: "%" })}${numberField("m-promoMonths", "Promo length", move.promoMonths, { suffix: "months", step: "1", min: 1, max: 60 })}</div>
      <div class="field-pair">${numberField("m-feePct", "Transfer fee", move.feePct, { suffix: "%" })}${numberField("m-feeMin", "Fee minimum", move.feeMin, { prefix: "$", step: "1" })}</div>
      <div class="field-pair">${numberField("m-goToApr", "APR after promo", move.goToApr, { suffix: "%" })}${numberField("m-limit", "Expected credit limit", move.limit, { prefix: "$", step: "100" })}</div>
      <label class="check-row"><input type="checkbox" data-key="unsure"${move.unsure ? " checked" : ""}> I'm not sure of the limit</label>
      <div class="field-pair" ${move.unsure ? "" : "hidden"}>${numberField("m-limitLow", "Low guess", move.limitLow, { prefix: "$", step: "100" })}${numberField("m-limitHigh", "High guess", move.limitHigh, { prefix: "$", step: "100" })}</div>
      ${numberField("m-annualFee", "Annual fee", move.annualFee, { prefix: "$", step: "1", hint: "Leave empty if there isn't one." })}
      <label class="check-row"><input type="checkbox" data-key="deferred"${move.deferred ? " checked" : ""}> Deferred interest: all interest is charged back if not paid off in time</label>
      ${balanceToggles(M, move, "Balances to move")}
      <label class="check-row"><input type="checkbox" data-key="spendOn"${move.spendOn ? " checked" : ""}> I'll also make purchases on this card</label>
      <div class="field-pair" ${move.spendOn ? "" : "hidden"}>${numberField("m-spendAmount", "Purchases each month", move.spendAmount, { prefix: "$", step: "10" })}${numberField("m-purchaseApr", "APR on purchases", move.purchaseApr ?? move.goToApr, { suffix: "%" })}</div>`;
  } else if (move.type === "purchase") {
    html = `${termsNote}
      <div class="field-pair">${numberField("m-promoApr", "Promo APR", move.promoApr, { suffix: "%" })}${numberField("m-promoMonths", "Promo length", move.promoMonths, { suffix: "months", step: "1", min: 1, max: 60 })}</div>
      <div class="field-pair">${numberField("m-goToApr", "APR after promo", move.goToApr, { suffix: "%" })}${numberField("m-limit", "Expected credit limit", move.limit, { prefix: "$", step: "100" })}</div>
      ${numberField("m-spendAmount", "Purchases you'd move to it each month", move.spendAmount, { prefix: "$", step: "10", hint: "Spending you'd make anyway. The cash it frees goes to your other debts during the promo." })}
      ${numberField("m-annualFee", "Annual fee", move.annualFee, { prefix: "$", step: "1", hint: "Leave empty if there isn't one." })}
      <label class="check-row"><input type="checkbox" data-key="deferred"${move.deferred ? " checked" : ""}> Deferred interest promo</label>`;
  } else if (move.type === "order") {
    const strategy = move.strategy || "avalanche";
    const order = [...(move.order || []).filter((id) => M.names[id]), ...M.list.map((d) => d.id).filter((id) => !(move.order || []).includes(id))];
    html = `<fieldset class="strategy-pick"><legend class="field-label">Order</legend>
      ${[["avalanche", "Avalanche", "Highest APR first. Lowest total interest."],
    ["snowball", "Snowball", "Lowest balance first. Fastest early wins."],
    ["custom", "Custom", "Your own order."]].map(([v, n, d]) => `
        <label class="radio-card"><input type="radio" name="m-strategy" data-key="strategy" value="${v}"${strategy === v ? " checked" : ""}>
          <span><strong>${n}</strong><span>${d}</span></span></label>`).join("")}
      </fieldset>
      ${strategy === "custom" ? `<ol class="order-list" aria-label="Payoff order">${order.map((id, i) => `
        <li><span>${esc(M.names[id])}</span>
          <button type="button" class="icon-btn-sm" data-order-move="${esc(id)}" data-dir="-1" aria-label="Move ${esc(M.names[id])} up"${i === 0 ? " disabled" : ""}>${svgIcon(ICONS.up)}</button>
          <button type="button" class="icon-btn-sm" data-order-move="${esc(id)}" data-dir="1" aria-label="Move ${esc(M.names[id])} down"${i === order.length - 1 ? " disabled" : ""}>${svgIcon(ICONS.down)}</button>
        </li>`).join("")}</ol>` : ""}`;
  } else if (move.type === "extra") {
    const months = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${(move.month || 1) === i + 1 ? " selected" : ""}>${shortMonth(monthOf(i + 1))}</option>`).join("");
    html = `<div class="field-pair">${numberField("m-amount", "Extra amount", move.amount, { prefix: "$", step: "50" })}
      <div class="field"><label for="m-month">Paid in</label><div class="select-wrap"><select id="m-month" data-key="month">${months}</select>${svgIcon("M6 9l6 6 6-6")}</div></div></div>`;
  } else if (move.type === "loan") {
    html = `${termsNote}
      <div class="field-pair">${numberField("m-apr", "Loan APR", move.apr, { suffix: "%" })}${numberField("m-termMonths", "Term", move.termMonths, { suffix: "months", step: "1", min: 1, max: 360 })}</div>
      ${numberField("m-feePct", "Origination fee", move.feePct, { suffix: "%", hint: "Added to the loan amount." })}
      ${balanceToggles(M, move, "Balances to pay off with the loan")}`;
  }
  moveFields.innerHTML = html;
  builderFieldsFor = move.type;
}

// Reads the move fields back into the draft
function readMoveFields(move) {
  const next = { type: move.type };
  if (move.type === "order") {
    next.strategy = builderForm.querySelector('input[name="m-strategy"]:checked')?.value || "avalanche";
    next.order = move.order || [];
  }
  moveFields.querySelectorAll("input[data-key]:not([type=radio]), select[data-key]").forEach((el) => {
    const key = el.dataset.key;
    if (el.type === "checkbox") next[key] = el.checked;
    else if (el.value !== "") next[key] = Number(el.value);
  });
  const ids = [...moveFields.querySelectorAll("input[data-move-id]")];
  if (ids.length) next.moveIds = ids.filter((el) => el.checked).map((el) => el.dataset.moveId);
  return cleanMove(next) || move;
}

function renderBuilder(M) {
  const plan = M.plan;
  const move = draftMove(M);

  // Saved scenarios
  const chips = plan.scenarios.map((s, i) => `
    <button type="button" class="scenario-chip" data-scenario="${esc(s.id)}" aria-pressed="${s.id === editingScenarioId}">
      <i class="series-swatch" style="background:${SCENARIO_COLORS[i]}" aria-hidden="true"></i>${esc(s.name)}</button>`).join("");
  document.getElementById("scenario-bar").innerHTML = `
    <span class="scenario-count">${plan.scenarios.length} of ${MAX_SCENARIOS} saved</span>${chips}
    <button type="button" class="scenario-chip new" data-scenario="" aria-pressed="${editingScenarioId === null}">${svgIcon(ICONS.plus, "icon icon-sm")}New scenario</button>`;

  // Budget slider: from the minimums to a generous ceiling
  const lo = Math.max(0, Math.floor(M.mins / 10) * 10);
  const hi = Math.max(lo + 100, Math.ceil(Math.max(M.budget * 2.5, M.mins * 4, 500) / 50) * 50);
  bBudgetRange.min = lo;
  bBudgetRange.max = hi;
  bBudgetRange.step = 10;
  bBudgetRange.value = M.budget;
  bBudgetRange.setAttribute("aria-valuetext", `${moneyWhole(M.budget)} per month`);
  if (document.activeElement !== bBudget) bBudget.value = M.budget;

  document.getElementById("move-types").innerHTML = MOVE_TYPES.map((t) => `
    <label class="radio-card"><input type="radio" name="move-type" value="${t.id}"${move.type === t.id ? " checked" : ""}>
      <span><strong>${t.name}</strong><span>${t.desc}</span></span></label>`).join("");

  if (builderFieldsFor !== move.type || !moveFields.contains(document.activeElement)) renderMoveFields(M, move);
  if (document.activeElement !== bName) bName.value = editingScenarioId ? plan.scenarios.find((s) => s.id === editingScenarioId)?.name || "" : "";
  bName.placeholder = moveName(move);

  const editing = Boolean(editingScenarioId);
  document.getElementById("b-save").textContent = editing ? "Update scenario" : "Save scenario";
  document.getElementById("b-delete").hidden = !editing;
  const full = !editing && plan.scenarios.length >= MAX_SCENARIOS;
  document.getElementById("b-save").disabled = full;
  document.getElementById("b-save-hint").textContent = full
    ? "You can compare up to 3 scenarios. Delete one to save another."
    : "Saved scenarios appear side by side on step 3.";

  renderResults(M, move);
}

function renderResults(M, move) {
  const body = document.getElementById("results-body");
  const problem = moveProblem(move, M);
  if (problem) {
    body.innerHTML = `<p class="results-empty">${esc(problem)}</p>`;
    return;
  }

  const { s, run, baseline } = runMove(M, rangeMove(move, "expected"));
  const months = s.monthsToPayoff;
  const saved = s.netSaved;
  const lossy = saved < -0.5;
  const promo = move.type === "transfer" || move.type === "purchase";

  // Unknown credit limit: show the result across the low and high guess
  let range = "";
  if (move.type === "transfer" && move.unsure && move.limitLow > 0 && move.limitHigh > 0) {
    const a = runMove(M, rangeMove(move, "low")).s.netSaved;
    const b = runMove(M, rangeMove(move, "high")).s.netSaved;
    range = `<p class="results-range">Between ${moneySigned(Math.min(a, b))} and ${moneySigned(Math.max(a, b))} depending on the limit you get (${moneyWhole(Math.min(move.limitLow, move.limitHigh))}–${moneyWhole(Math.max(move.limitLow, move.limitHigh))}).</p>`;
  }

  const tiles = [
    ["Break-even", s.breakEven ? `Month ${s.breakEven}` : s.fees > 0 ? "Never" : "No fees", s.breakEven ? shortMonth(monthOf(s.breakEven)) : s.fees > 0 ? "Fees outweigh the savings" : "Saves from month 1"],
    ["Debt-free", payoffLabel(months), monthsDiff(s.monthsSaved)],
    ["Interest + fees", money(s.totalCost), `vs ${money(baseline.totalInterest)} now`],
  ];
  if (promo && s.requiredPayment) {
    tiles.push(["To clear before the promo ends", `${money(s.requiredPayment)}/mo`, `for ${s.meta.promoMonths} months`]);
  }

  // Snowball: how much sooner the first debt goes, and what it costs vs. avalanche
  let snowball = "";
  if (move.type === "order" && (move.strategy || "avalanche") === "snowball") {
    const av = Engine.simulate(M.eng, { budget: M.budget, strategy: "avalanche" });
    const firstOf = (r) => Math.min(...Object.values(r.payoffMonth));
    const sooner = firstOf(av) - firstOf(run);
    const extra = run.totalInterest - av.totalInterest;
    snowball = `<p class="results-note">${sooner > 0 ? `Your first debt is gone ${sooner} ${sooner === 1 ? "month" : "months"} sooner than with avalanche, ` : "No faster first payoff than avalanche, "}for ${money(Math.max(0, extra))} more interest.</p>`;
  }

  // Promo-aware picks whichever order costs less; say which, when there's a choice to make
  if (run.strategy === "promo" && s.debts.length > 1) {
    snowball += `<p class="results-note">${run.pacedPromo
      ? "Payoff order: the promo card gets enough each month to clear before the promo ends, because that costs less here."
      : "Payoff order: your highest-APR debt gets the extra money first, because that costs less here than clearing the promo card early."}</p>`;
  }

  body.innerHTML = `
    <div class="results-hero ${lossy ? "loss" : ""}">
      <span class="stat-label">${lossy ? "This move costs you" : "Net savings"}</span>
      <span class="results-value">${lossy ? money(-saved) : money(Math.max(0, saved))}</span>
      <span class="stat-sub">${lossy ? "more than your current path. Not recommended." : "less interest and fees than your current path"}</span>
    </div>
    ${range}
    <dl class="results-grid">${tiles.map(([k, v, sub]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd><dd class="sub">${esc(sub)}</dd></div>`).join("")}</dl>
    ${snowball}
    <ul class="debt-warnings">${scenarioWarnings(M, move, s, run)}</ul>`;
}

const moneySigned = (n) => (n < 0 ? `−${money(-n)}` : money(n));
function monthsDiff(n) {
  if (n === null || n === undefined) return "";
  if (n === 0) return "same as now";
  return n > 0 ? `${n} ${n === 1 ? "month" : "months"} sooner` : `${-n} ${n === -1 ? "month" : "months"} later`;
}

// The move with the limit to use for this run: expected, or the low/high guess
function rangeMove(move, which) {
  if (move.type !== "transfer") return move;
  const limit = which === "low" ? move.limitLow : which === "high" ? move.limitHigh : move.limit;
  return { ...move, limit: limit || move.limit };
}

function scenarioWarnings(M, move, s, run) {
  const out = [];
  const meta = s.meta;
  if (s.balanceAtPromoEnd > 0.5) {
    out.push(warningChip(`${moneyWhole(s.balanceAtPromoEnd)} will remain when the promo ends, at ${aprText(meta.goToApr)}`, "warn",
      s.requiredPayment ? `Paying ${money(s.requiredPayment)}/month clears it in time.` : ""));
  }
  if (meta.deferred) {
    const charged = run.months.reduce((t, r) => t + r.deferredCharged, 0);
    out.push(warningChip(charged > 0 ? `Deferred interest: ${money(charged)} gets charged back when the promo ends` : "Deferred interest promo",
      "danger", "If even $1 is left at the end, all the interest since day one is added."));
  }
  if (meta.exceedsLimit) {
    out.push(warningChip("Transfer exceeds likely credit limit", "warn",
      move.type === "transfer" ? `Only ${moneyWhole(meta.amount)} fits once the fee is added. The rest stays where it is.` : "Your purchases are capped at the limit."));
  }
  if (s.netSaved < -0.5 && s.fees > 0) out.push(warningChip("Fee is higher than interest avoided — this move loses money", "danger"));
  if (run.neverPaysOff) out.push(warningChip("Payment doesn't cover interest — this never pays off", "danger"));
  else if (run.budgetShort) out.push(warningChip("Your budget is below the minimums for this plan", "danger"));
  if (move.type === "transfer" || move.type === "purchase" || move.type === "loan") {
    out.push(warningChip("Credit score", "info", "A new account and using more of your limit can lower your score for a while. We don't predict scores."));
  }
  return out.join("");
}

// Builder events
builderForm.addEventListener("input", (e) => {
  const M = buildModel();
  if (e.target === bBudgetRange || e.target === bBudget) {
    const v = Number(e.target.value);
    if (e.target === bBudgetRange) bBudget.value = v;
    else bBudgetRange.value = v;
    if (Number.isFinite(v) && v >= 0) {
      currentPlan().budget = Math.round(v);
      savePlans();
      renderResults(buildModel(), draftMove(M));
    }
    return;
  }
  if (e.target.name === "move-type") {
    M.plan.draft = defaultMove(e.target.value, M);
    savePlans();
    renderBuilder(buildModel());
    return;
  }
  if (e.target === bName) return;
  M.plan.draft = readMoveFields(draftMove(M));
  savePlans();
  if (e.target.matches('[data-key="unsure"], [data-key="spendOn"], [name="m-strategy"]')) renderMoveFields(M, M.plan.draft);
  renderResults(M, M.plan.draft);
});

builderForm.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-order-move]");
  if (!btn) return;
  const M = buildModel();
  const move = draftMove(M);
  const order = [...(move.order || []).filter((id) => M.names[id]), ...M.list.map((d) => d.id).filter((id) => !(move.order || []).includes(id))];
  const i = order.indexOf(btn.dataset.orderMove);
  const j = i + Number(btn.dataset.dir);
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  move.order = order;
  savePlans();
  renderMoveFields(M, move);
  renderResults(M, move);
  // Keep focus on the same button after the list redraws
  const again = moveFields.querySelector(`[data-order-move="${CSS.escape(btn.dataset.orderMove)}"][data-dir="${btn.dataset.dir}"]`);
  (again && !again.disabled ? again : moveFields.querySelector(`[data-order-move="${CSS.escape(btn.dataset.orderMove)}"]:not([disabled])`))?.focus();
});

function showBuilderError(message) {
  document.getElementById("builder-error-text").textContent = message;
  document.getElementById("builder-error").hidden = !message;
}

builderForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const M = buildModel();
  const move = draftMove(M);
  const problem = moveProblem(move, M);
  if (problem) return showBuilderError(problem);
  showBuilderError("");
  const name = (bName.value.trim() || moveName(move)).slice(0, SCENARIO_NAME_MAX);
  const plan = M.plan;
  if (editingScenarioId) {
    const s = plan.scenarios.find((x) => x.id === editingScenarioId);
    if (s) Object.assign(s, { name, move: { ...move } });
  } else {
    if (plan.scenarios.length >= MAX_SCENARIOS) return showBuilderError("You can compare up to 3 scenarios. Delete one first.");
    const id = `s${Date.now()}`;
    plan.scenarios.push({ id, name, move: { ...move } });
    editingScenarioId = id;
  }
  savePlans();
  noteChange();
  renderBuilder(buildModel());
  document.getElementById("b-save-hint").textContent = `Saved “${name}”. Compare it on step 3.`;
});

document.getElementById("b-delete").addEventListener("click", () => {
  const plan = currentPlan();
  const s = plan.scenarios.find((x) => x.id === editingScenarioId);
  if (!s) return;
  plan.scenarios = plan.scenarios.filter((x) => x.id !== editingScenarioId);
  editingScenarioId = null;
  savePlans();
  noteChange();
  renderBuilder(buildModel());
  document.querySelector('.scenario-chip.new')?.focus();
});

document.getElementById("scenario-bar").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-scenario]");
  if (!chip) return;
  const M = buildModel();
  const s = M.plan.scenarios.find((x) => x.id === chip.dataset.scenario);
  editingScenarioId = s ? s.id : null;
  M.plan.draft = s ? { ...s.move } : defaultMove("transfer", M);
  savePlans();
  showBuilderError("");
  builderFieldsFor = null;
  renderBuilder(buildModel());
  document.querySelector(`[data-scenario="${CSS.escape(chip.dataset.scenario)}"]`)?.focus();
});

// ===== Screen C: Roadmap & compare =====
function compareRows(M) {
  const rows = [{ id: null, name: "Current path", color: BASE_COLOR, dash: "6 4", run: M.baseline, s: null }];
  M.plan.scenarios.forEach((sc, i) => {
    if (moveProblem(sc.move, M)) return;
    const r = runMove(M, sc.move);
    rows.push({ id: sc.id, name: sc.name, color: SCENARIO_COLORS[i], dash: "", run: r.run, s: r.s, built: r.built, move: sc.move });
  });
  return rows;
}

function rowStats(M, row) {
  if (!row.s) {
    const util = Engine.peakUtilization(M.baseline, M.eng);
    return {
      months: M.baseline.monthsToPayoff, interest: M.baseline.totalInterest, fees: M.baseline.fees,
      cost: M.baseline.totalCost, saved: null, util, fits: !M.baseline.neverPaysOff && !M.baseline.budgetShort,
    };
  }
  return {
    months: row.s.monthsToPayoff, interest: row.s.totalInterest, fees: row.s.fees, cost: row.s.totalCost,
    saved: row.s.netSaved, util: row.s.peakUtilization, fits: !row.s.neverPaysOff && !row.s.budgetShort,
  };
}

function renderCompare(M) {
  const rows = compareRows(M);
  const stats = rows.map((r) => rowStats(M, r));
  document.getElementById("compare-budget").textContent = `at ${moneyWhole(M.budget)}/month`;

  // "Recommended": lowest total cost that fits the budget
  let best = -1;
  stats.forEach((st, i) => { if (st.fits && (best === -1 || st.cost < stats[best].cost - 0.5)) best = i; });
  const active = M.plan.active;
  const activeKey = active ? active.scenarioId || "current" : null;

  const table = document.getElementById("compare-table");
  if (!M.list.length) {
    table.innerHTML = '<tbody><tr><td class="results-empty">Add a debt on step 1 to compare plans.</td></tr></tbody>';
  } else {
    table.innerHTML = `
      <thead><tr>
        <th scope="col">Plan</th><th scope="col" class="num">Months to payoff</th><th scope="col" class="num">Total interest</th>
        <th scope="col" class="num">Fees</th><th scope="col" class="num">Total cost</th><th scope="col" class="num">Net saved</th>
        <th scope="col" class="num">Peak utilization</th><th scope="col"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>${rows.map((r, i) => {
    const st = stats[i];
    const key = r.id || "current";
    const tags = [];
    if (i === best) tags.push('<span class="badge badge-good">Recommended</span>');
    if (activeKey === key) tags.push('<span class="badge">Your plan</span>');
    if (!st.fits) tags.push('<span class="badge badge-danger">Doesn\'t fit budget</span>');
    return `<tr>
          <th scope="row"><span class="debt-name"><i class="series-swatch${r.dash ? " dashed" : ""}" style="--c:${r.color}" aria-hidden="true"></i>${esc(r.name)}</span>
            ${tags.length ? `<span class="debt-tags">${tags.join("")}</span>` : ""}</th>
          <td class="num">${st.months === null ? "Never" : st.months}</td>
          <td class="num">${money(st.interest)}</td>
          <td class="num">${money(st.fees)}</td>
          <td class="num"><strong>${money(st.cost)}</strong></td>
          <td class="num ${st.saved !== null && st.saved < -0.5 ? "text-danger" : ""}">${st.saved === null ? "—" : moneySigned(st.saved)}</td>
          <td class="num">${st.util === null ? "—" : percentText(st.util)}</td>
          <td class="row-actions">${activeKey === key ? '<span class="muted">Active</span>'
    : `<button type="button" class="btn-secondary btn-sm" data-commit="${esc(key)}"${st.fits ? "" : " disabled"}>Make this my plan</button>`}</td>
        </tr>`;
  }).join("")}</tbody>`;
  }

  // Balance over time
  const bands = [];
  rows.forEach((r) => {
    if (r.s && r.s.meta.promoMonths) bands.push({ from: 0, to: r.s.meta.promoMonths, color: r.color, label: `${r.name} promo` });
  });
  M.list.forEach((d) => {
    if (d.promo) {
      const months = monthsBetween(currentMonth(), d.promo.endMonth) + 1;
      if (months > 0) bands.push({ from: 0, to: months, color: BASE_COLOR, label: `${d.name} promo` });
    }
  });
  const series = rows.map((r) => ({
    name: r.name, color: r.color, dash: r.dash,
    values: [r.run.start.balance, ...r.run.months.map((x) => x.balance)],
    done: r.run.monthsToPayoff,
    promoEnd: r.s && r.s.meta.promoMonths ? r.s.meta.promoMonths : null,
  }));
  document.getElementById("balance-chart").innerHTML = M.list.length ? lineChart({
    series, bands,
    label: `Balance over time. ${rows.map((r, i) => `${r.name}: debt-free ${stats[i].months === null ? "never" : `in ${stats[i].months} months`}`).join(". ")}.`,
  }) : "";
  document.getElementById("balance-legend").innerHTML = rows.map((r, i) => `
    <li><i class="series-swatch${r.dash ? " dashed" : ""}" style="--c:${r.color}" aria-hidden="true"></i>${esc(r.name)}
      <span class="muted">${stats[i].months === null ? "never pays off" : `debt-free ${shortMonth(monthOf(stats[i].months))}`}</span></li>`).join("")
    + (bands.length ? '<li><i class="band-swatch" aria-hidden="true"></i>Promo window <span class="muted">◆ promo ends · ● debt-free</span></li>' : "");

  // Cumulative interest + fees, with break-even
  const cost = rows.map((r) => {
    let total = r.s ? r.s.fees - r.run.months.reduce((t, x) => t + x.fees, 0) : 0; // up-front fees at month 0
    const values = [total];
    r.run.months.forEach((x) => { total += x.interest + x.fees; values.push(total); });
    return { name: r.name, color: r.color, dash: r.dash, values, breakEven: r.s ? r.s.breakEven : null };
  });
  document.getElementById("cost-chart").innerHTML = M.list.length ? lineChart({
    series: cost, flatAfterEnd: true,
    label: `Interest and fees paid so far. ${rows.map((r, i) => `${r.name}: ${money(stats[i].cost)} in total`).join(". ")}.`,
  }) : "";
  const notes = rows.filter((r) => r.s).map((r) => (r.s.breakEven
    ? `${r.name} breaks even in month ${r.s.breakEven} (${shortMonth(monthOf(r.s.breakEven))}), where its line crosses below the current path.`
    : r.s.fees > 0 ? `${r.name} never makes back its fees.` : `${r.name} has no fees, so it's ahead from month 1.`));
  document.getElementById("cost-note").textContent = notes.length ? notes.join(" ") : "Save a scenario on step 2 to compare it here.";

  renderTimeline(M, rows);
}

document.getElementById("compare-table").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-commit]");
  if (btn) commitPlan(btn.dataset.commit);
});

// ----- Charts (inline SVG) -----
const CHART = { w: 640, h: 260, left: 64, right: 16, top: 16, bottom: 32 };

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= v);
}

function lineChart({ series, bands = [], label, flatAfterEnd = false }) {
  const { w, h, left, right, top, bottom } = CHART;
  const lastMonth = Math.max(6, ...series.map((s) => (s.done ?? s.values.length - 1)));
  const maxX = Math.min(lastMonth, PROJECTION_MAX);
  const maxY = niceMax(Math.max(...series.map((s) => Math.max(...s.values.slice(0, maxX + 1)))));
  const x = (m) => left + (m / maxX) * (w - left - right);
  const y = (v) => top + (1 - v / maxY) * (h - top - bottom);
  const stepX = [3, 6, 12, 24, 36, 60, 120].find((s) => maxX / s <= 6) || 120;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = maxY * f;
    return `<line x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${left - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${v >= 1000 ? compactCurrency.format(v) : moneyWhole(v)}</text>`;
  }).join("");
  const ticks = [];
  for (let m = 0; m <= maxX; m += stepX) {
    ticks.push(`<text x="${x(m)}" y="${h - 10}" text-anchor="middle" class="tick">${m === 0 ? "Now" : shortMonth(monthOf(m)).replace(/ (\d\d)(\d\d)$/, " ’$2")}</text>`);
  }
  const bandEls = bands.map((b) => `<rect x="${x(b.from)}" y="${top}" width="${Math.max(0, x(Math.min(b.to, maxX)) - x(b.from))}" height="${h - top - bottom}" fill="${b.color}" opacity="0.07"><title>${esc(b.label)}</title></rect>`).join("");
  const lines = series.map((s) => {
    const end = flatAfterEnd ? maxX : Math.min(s.done ?? s.values.length - 1, maxX);
    const pts = [];
    for (let m = 0; m <= end; m++) {
      const v = s.values[Math.min(m, s.values.length - 1)];
      pts.push(`${x(m).toFixed(1)},${y(v).toFixed(1)}`);
    }
    let marks = "";
    if (!flatAfterEnd && s.done !== null && s.done !== undefined && s.done <= maxX) {
      marks += `<circle cx="${x(s.done)}" cy="${y(0)}" r="4.5" fill="${s.color}" stroke="#fff" stroke-width="1.5"><title>${esc(s.name)}: debt-free ${shortMonth(monthOf(s.done))}</title></circle>`;
    }
    if (s.promoEnd && s.promoEnd <= maxX) {
      const v = s.values[Math.min(s.promoEnd, s.values.length - 1)];
      marks += `<rect x="${x(s.promoEnd) - 4}" y="${y(v) - 4}" width="8" height="8" transform="rotate(45 ${x(s.promoEnd)} ${y(v)})" fill="${s.color}" stroke="#fff" stroke-width="1.5"><title>${esc(s.name)}: promo ends with ${moneyWhole(v)} left</title></rect>`;
    }
    if (flatAfterEnd && s.breakEven && s.breakEven <= maxX) {
      const v = s.values[Math.min(s.breakEven, s.values.length - 1)];
      marks += `<circle cx="${x(s.breakEven)}" cy="${y(v)}" r="5" fill="#fff" stroke="${s.color}" stroke-width="2.5"><title>${esc(s.name)}: breaks even in month ${s.breakEven}</title></circle>`;
    }
    return `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>${marks}`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">
    ${bandEls}${grid}${ticks.join("")}<line x1="${left}" x2="${w - right}" y1="${y(0)}" y2="${y(0)}" class="axis"/>${lines}</svg>`;
}

// ----- Payoff timeline -----
const timelinePick = document.getElementById("timeline-pick");
let timelineKey = "current";
let timelineMonth = null;

function renderTimeline(M, rows) {
  timelinePick.replaceChildren(...rows.map((r) => new Option(r.name, r.id || "current")));
  if (!rows.some((r) => (r.id || "current") === timelineKey)) timelineKey = "current";
  timelinePick.value = timelineKey;
  const row = rows.find((r) => (r.id || "current") === timelineKey);
  const run = row.run;
  const names = { ...M.names, [Engine.NEW_ID]: row.built ? row.built.debts.find((d) => d.id === Engine.NEW_ID)?.name || "New card" : "New card" };
  const months = run.months.slice(0, TIMELINE_MAX);
  const paidIn = {};
  Object.entries(run.payoffMonth).forEach(([id, m]) => { (paidIn[m] ||= []).push(id); });

  const el = document.getElementById("timeline");
  if (!months.length) {
    el.innerHTML = "";
    document.getElementById("amort").innerHTML = "";
    return;
  }
  el.innerHTML = `<ol class="timeline-strip">${months.map((r) => {
    const ym = monthOf(r.m);
    const target = r.target ? names[r.target] : null;
    const paid = (paidIn[r.m] || []).map((id) => names[id]);
    const labelText = `${shortMonth(ym)}: ${target ? `extra goes to ${target}` : "minimums only"}${paid.length ? `. ${paid.join(" and ")} paid off` : ""}`;
    return `<li><button type="button" class="tl-month${paid.length ? " paid" : ""}" data-month="${r.m}" aria-pressed="${timelineMonth === r.m}"
      aria-label="${esc(labelText)}" style="--c:${r.target ? M.colors[r.target] || NEW_DEBT_COLOR : "#c5ccd6"}">
      <span class="tl-label">${ym.endsWith("-01") || r.m === 1 ? shortMonth(ym).replace(" ", "<br>") : esc(shortMonth(ym).slice(0, 3))}</span>
      ${paid.length ? svgIcon(ICONS.check, "icon tl-check") : ""}</button></li>`;
  }).join("")}</ol>
  ${run.months.length > TIMELINE_MAX ? `<p class="field-hint">Showing the first ${TIMELINE_MAX} months.</p>` : ""}
  <ul class="tl-legend">${Object.keys(run.months[0].byDebt).map((id) => `<li><i class="debt-dot" style="background:${M.colors[id] || NEW_DEBT_COLOR}" aria-hidden="true"></i>${esc(names[id])}${run.payoffMonth[id] ? ` <span class="muted">paid off ${shortMonth(monthOf(run.payoffMonth[id]))}</span>` : ""}</li>`).join("")}</ul>`;
  renderAmortization(run, names);
}

function renderAmortization(run, names) {
  const el = document.getElementById("amort");
  const r = timelineMonth ? run.months[timelineMonth - 1] : null;
  if (!r) {
    el.innerHTML = "";
    return;
  }
  const prev = r.m === 1 ? run.start : run.months[r.m - 2];
  el.innerHTML = `<h3 class="ledger-title">${shortMonth(monthOf(r.m))} · month ${r.m}</h3>
    <div class="table-scroll"><table class="debt-table amort-table">
      <thead><tr><th scope="col">Debt</th><th scope="col" class="num">Start</th><th scope="col" class="num">Interest</th><th scope="col" class="num">Payment</th><th scope="col" class="num">End</th></tr></thead>
      <tbody>${Object.entries(r.byDebt).map(([id, x]) => `<tr${r.target === id ? ' class="is-target"' : ""}>
        <th scope="row">${esc(names[id])}${r.target === id ? ' <span class="badge">Target</span>' : ""}</th>
        <td class="num">${money(prev.byDebt[id] ? prev.byDebt[id].balance : 0)}</td>
        <td class="num">${money(x.interest)}</td><td class="num">${money(x.payment)}</td><td class="num">${money(x.balance)}</td></tr>`).join("")}
      </tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num">${money(prev.balance)}</td><td class="num">${money(r.interest)}</td><td class="num">${money(r.paid)}</td><td class="num">${money(r.balance)}</td></tr></tfoot>
    </table></div>`;
}

timelinePick.addEventListener("change", () => {
  timelineKey = timelinePick.value;
  timelineMonth = null;
  renderDebt();
});

document.getElementById("timeline").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-month]");
  if (!btn) return;
  const m = Number(btn.dataset.month);
  timelineMonth = timelineMonth === m ? null : m;
  renderDebt();
  document.querySelector(`.tl-month[data-month="${m}"]`)?.focus();
});

// ===== Screen D: Action plan =====
function commitPlan(key) {
  const M = buildModel();
  const sc = key === "current" ? null : M.plan.scenarios.find((s) => s.id === key);
  if (key !== "current" && !sc) return;
  const move = sc ? sc.move : null;
  const run = move ? runMove(M, move).run : M.baseline;
  M.plan.active = {
    scenarioId: sc ? sc.id : null,
    name: sc ? sc.name : "Current path",
    move: move ? { ...move } : null,
    budget: M.budget,
    startMonth: currentMonth(),
    applied: !move || move.type === "order" || move.type === "extra",
    newDebtId: null,
    done: {},
    // projection[k] = balances at the start of plan month k + 1 (projection[0] = today)
    projection: [run.start, ...run.months].slice(0, PROJECTION_MAX).map((r) => ({
      m: r.m,
      balances: Object.fromEntries(Object.entries(r.byDebt).map(([id, x]) => [id, Math.round(x.balance * 100) / 100])),
    })),
    updates: [],
  };
  savePlans();
  noteChange();
  goToStep("d");
}

// The live run for the active plan: the move until it's been carried out, then the real debts
function planRun(M, active) {
  if (active.move && !active.applied) return runMove(M, active.move, M.budget);
  const strategy = active.move && active.move.type === "order" ? engineMove(active.move, M) : null;
  const extra = active.move && active.move.type === "extra" && active.move.month >= planMonthIndex(active)
    ? [{ month: active.move.month - planMonthIndex(active) + 1, amount: active.move.amount }] : [];
  const run = Engine.simulate(M.eng, {
    budget: M.budget,
    ...(strategy ? { strategy: strategy.strategy, order: strategy.order } : {}),
    extraPayments: extra,
  });
  return { run, built: { debts: M.eng }, s: null };
}

const planMonthIndex = (active) => Math.max(1, monthsBetween(active.startMonth, currentMonth()) + 1);

function planSteps(M, active, live) {
  const move = active.move;
  const steps = [];
  const due = (id) => {
    const d = M.list.find((x) => x.id === id);
    return d ? ` by the ${ordinal(d.dueDay)}` : "";
  };
  const first = live.run.months[0];
  const targetId = first ? first.target : null;
  const targetName = targetId ? (M.names[targetId] || "the new card") : null;

  if (move && move.type === "transfer") {
    const meta = live.s ? live.s.meta : null;
    steps.push({ key: "apply", text: `Apply for the new card: ${aprText(move.promoApr || 0)} for ${move.promoMonths} months, ${aprText(move.feePct || 0)} transfer fee, then ${aprText(move.goToApr)}.` });
    if (meta) {
      const from = Object.entries(meta.taken || {}).map(([id, amt]) => `${M.names[id]} (${money(amt)})`).join(" and ");
      steps.push({ key: "transfer", text: `Request a transfer of ${money(meta.amount)} from ${from}.` });
    }
    steps.push({ key: "record", text: "When the transfer posts, record it so your debts match.", action: "record" });
  } else if (move && move.type === "purchase") {
    steps.push({ key: "apply", text: `Apply for a ${aprText(move.promoApr || 0)} purchase card (${move.promoMonths} months, then ${aprText(move.goToApr)}).` });
    steps.push({ key: "spend", text: `Put about ${money(move.spendAmount)} of everyday purchases on it each month until ${shortMonth(monthOf(move.promoMonths, active.startMonth))}, and send the cash you save to your debts.` });
    steps.push({ key: "record", text: "Once the card is open, add it to your debts.", action: "record" });
  } else if (move && move.type === "loan") {
    const meta = live.s ? live.s.meta : null;
    steps.push({ key: "apply", text: `Apply for a ${meta ? money(meta.principal) : ""} loan at ${aprText(move.apr)} over ${move.termMonths} months${meta ? ` (about ${money(meta.payment)}/month)` : ""}.` });
    steps.push({ key: "payoff", text: `Use it to pay off ${(move.moveIds || []).map((id) => M.names[id]).filter(Boolean).join(", ")}.` });
    steps.push({ key: "record", text: "When the cards are paid, record the loan so your debts match.", action: "record" });
  } else if (move && move.type === "extra") {
    steps.push({ key: "extra", text: `Pay an extra ${money(move.amount)} in ${shortMonth(monthOf(move.month, active.startMonth))}.` });
  }
  if (targetName) {
    const pay = first.byDebt[targetId].payment;
    steps.push({ key: `pay-${active.startMonth}`, text: `Pay ${money(pay)} to ${targetName}${due(targetId)}, and the minimum on everything else.` });
  }
  steps.push({ key: "update", text: "After each statement closes, update your balances below." });
  return steps;
}

function renderPlan(M) {
  const el = document.getElementById("plan-body");
  const active = M.plan.active;
  if (!active) {
    el.innerHTML = `<div class="card debt-empty">
      <h2>No plan yet</h2>
      <p>Compare your options, then choose “Make this my plan”. You'll get the steps, a payment for each debt, and reminders.</p>
      <button type="button" class="btn-primary" data-goto="c">Compare plans ${svgIcon(ICONS.arrow)}</button></div>`;
    return;
  }

  const live = planRun(M, active);
  const run = live.run;
  const k = planMonthIndex(active);
  const first = run.months[0];
  const names = { ...M.names, [Engine.NEW_ID]: active.move && active.move.type === "loan" ? "Consolidation loan" : "New card" };

  // Promo countdown: alerts at 60 and 30 days if a balance is projected to remain
  let countdown = "";
  const promo = promoCountdown(M, active, run);
  if (promo) {
    const alert = promo.days <= 60 && promo.remaining > 0.5;
    countdown = `<section class="card promo-countdown${alert ? " alert" : ""}" ${alert ? 'role="alert"' : ""}>
      <div class="countdown-num"><span>${Math.max(0, promo.days)}</span><span>days</span></div>
      <div><h3>${esc(promo.name)} promo ends ${esc(promo.dateText)}</h3>
      <p>${promo.remaining > 0.5
    ? `${alert ? `<strong>${promo.days <= 30 ? "30-day" : "60-day"} alert:</strong> ` : ""}About ${moneyWhole(promo.remaining)} is projected to remain, then ${aprText(promo.goToApr)} applies${promo.deferred ? " — plus all deferred interest" : ""}.`
    : "On track to be paid off before it ends."}</p></div></section>`;
  }

  const steps = planSteps(M, active, live);
  const stepsHtml = `<section class="card" aria-labelledby="steps-heading"><h2 id="steps-heading">Steps</h2>
    <ol class="plan-steps">${steps.map((st) => `<li>
      <label class="check-row"><input type="checkbox" data-step-key="${esc(st.key)}"${active.done[st.key] ? " checked" : ""}><span>${esc(st.text)}</span></label>
      ${st.action === "record" && !active.applied ? `<button type="button" class="btn-secondary btn-sm" data-record>Record it</button>` : ""}
      ${st.action === "record" && active.applied ? '<span class="badge badge-good">Recorded</span>' : ""}
    </li>`).join("")}</ol></section>`;

  // This month's payments
  const payRows = first ? Object.entries(first.byDebt).filter(([, x]) => x.payment > 0.005) : [];
  const payments = `<section class="card" aria-labelledby="pay-heading">
    <div class="card-head"><h2 id="pay-heading">Payments for ${esc(shortMonth(currentMonth()))}</h2>
      <button type="button" class="btn-secondary btn-sm" data-ics>${svgIcon(ICONS.calendar, "icon icon-sm")}Add reminders to calendar</button></div>
    ${payRows.length ? `<div class="table-scroll"><table class="debt-table"><thead><tr><th scope="col">Debt</th><th scope="col" class="num">Pay</th><th scope="col">Due</th></tr></thead>
    <tbody>${payRows.map(([id, x]) => {
    const d = M.list.find((y) => y.id === id);
    const extra = first.target === id;
    return `<tr><th scope="row"><span class="debt-name"><i class="debt-dot" style="background:${M.colors[id] || NEW_DEBT_COLOR}" aria-hidden="true"></i>${esc(names[id] || "New card")}</span>${extra ? '<span class="debt-tags"><span class="badge">Gets the extra</span></span>' : ""}</th>
        <td class="num"><strong>${money(x.payment)}</strong></td>
        <td>${d ? `${esc(shortMonth(currentMonth()).split(" ")[0])} ${d.dueDay}` : "After the card opens"}</td></tr>`;
  }).join("")}</tbody></table></div>` : '<p class="results-empty">Nothing to pay. You\'re debt-free.</p>'}
    <p class="field-hint">The calendar file has a reminder for each payment over the next 12 months${promo ? ", plus 60- and 30-day alerts before the promo ends" : ""}.</p></section>`;

  // Monthly balance update and drift from the plan: compared with where the plan
  // expected each balance at the start of this month (before this month's payment)
  const projected = active.projection[k - 1];
  const update = active.updates.find((u) => u.month === currentMonth());
  const drift = projected ? M.list.map((d) => {
    const key = d.id === active.newDebtId ? Engine.NEW_ID : d.id;
    const plannedBal = projected.balances[key] ?? projected.balances[d.id];
    return plannedBal === undefined ? null : { d, planned: plannedBal, actual: debtTotal(d), diff: debtTotal(d) - plannedBal };
  }).filter(Boolean) : [];
  const behind = drift.filter((x) => x.diff > Math.max(10, x.planned * 0.02));
  const driftHtml = update && drift.length ? `<div class="drift ${behind.length ? "behind" : "on-track"}" role="status">
      ${svgIcon(behind.length ? ICONS.warn : ICONS.check)}
      <span>${behind.length
    ? `<strong>Off plan:</strong> ${behind.map((x) => `${esc(x.d.name)} is ${money(x.diff)} above where the plan expected`).join("; ")}. Your diagnosis and payments above are updated.`
    : "<strong>On track.</strong> Your balances are where the plan expected, or better."}</span></div>` : "";

  const updateHtml = `<section class="card" aria-labelledby="update-heading">
    <div class="card-head"><h2 id="update-heading">Update balances</h2><span>${update ? `Updated ${shortMonth(update.month)}` : `Month ${k} of your plan`}</span></div>
    ${update ? "" : '<p class="update-prompt">Your statements have closed? Enter each new balance so the plan stays accurate.</p>'}
    ${driftHtml}
    <form id="update-form" class="update-form" novalidate>
      ${M.list.map((d) => `<div class="field update-row">
        <label for="u-${esc(d.id)}">${esc(d.name)}</label>
        <div class="amount-field amount-sm"><span aria-hidden="true">$</span>
          <input type="number" id="u-${esc(d.id)}" data-debt="${esc(d.id)}" min="0" step="0.01" inputmode="decimal" value="${debtTotal(d).toFixed(2)}"></div>
        ${projected && projected.balances[d.id === active.newDebtId ? Engine.NEW_ID : d.id] !== undefined
    ? `<span class="field-hint">Plan: ${money(projected.balances[d.id === active.newDebtId ? Engine.NEW_ID : d.id])}</span>` : ""}
      </div>`).join("")}
      <p class="error" id="update-error" role="alert" hidden></p>
      <button type="submit" class="btn-primary btn-inline">Save balances</button>
    </form></section>`;

  el.innerHTML = `
    <section class="card plan-head">
      <div><span class="stat-label">Your plan</span><h2>${esc(active.name)}</h2>
        <p class="muted">Started ${esc(shortMonth(active.startMonth))} · month ${k} · ${moneyWhole(M.budget)}/month</p></div>
      <div class="plan-head-stats">
        <div><span class="stat-label">Debt-free</span><strong>${esc(payoffLabel(run.monthsToPayoff))}</strong></div>
        <div><span class="stat-label">Interest left</span><strong>${money(run.totalInterest)}</strong></div>
      </div>
      <button type="button" class="btn-ghost" data-goto="c">Change plan</button>
    </section>
    ${countdown}
    <div class="plan-grid">${stepsHtml}${payments}</div>
    ${updateHtml}`;
}

// The soonest promo on the plan's new card or on an existing debt
function promoCountdown(M, active, run) {
  const options = [];
  const move = active.move;
  if (move && (move.type === "transfer" || move.type === "purchase") && !active.applied) {
    const endYm = monthOf(move.promoMonths, active.startMonth);
    const rec = run.months[move.promoMonths - planMonthIndex(active)];
    options.push({ name: "New card", endYm, goToApr: move.goToApr, deferred: move.deferred, remaining: rec && rec.byDebt[Engine.NEW_ID] ? rec.byDebt[Engine.NEW_ID].balance : 0 });
  }
  M.list.forEach((d) => {
    if (!d.promo) return;
    const months = monthsBetween(currentMonth(), d.promo.endMonth) + 1;
    if (months < 1) return;
    const rec = run.months[months - 1];
    options.push({ name: d.name, endYm: d.promo.endMonth, goToApr: d.balances[0].apr, deferred: d.promo.deferred, remaining: rec && rec.byDebt[d.id] ? rec.byDebt[d.id].balance : 0 });
  });
  if (!options.length) return null;
  options.sort((a, b) => a.endYm.localeCompare(b.endYm));
  const p = options[0];
  // A promo runs through the last day of its final month
  const [y, m] = p.endYm.split("-").map(Number);
  const end = new Date(y, m, 0);
  const days = Math.ceil((end - parseISO(today())) / DAY_MS);
  return { ...p, days, dateText: end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) };
}

// Carries out the plan's move on the stored debts: the new card or loan becomes a real debt
function recordMove() {
  const M = buildModel();
  const active = M.plan.active;
  if (!active || !active.move || active.applied) return;
  const { built } = runMove(M, active.move, M.budget);
  const userId = isFamily() ? (M.list.find((d) => (active.move.moveIds || []).includes(d.id)) || M.list[0] || { userId: familyMembers()[0].id }).userId : view;

  // Balances that moved come off the old debts. A card moved in full stays listed at $0
  // (its limit still counts toward utilization); delete it on step 1 if it's closed.
  const after = new Map(built.debts.map((bd) => [bd.id, bd]));
  (active.move.moveIds || []).forEach((id) => {
    const d = debts.find((x) => x.id === id && inView(x));
    if (!d) return;
    const bd = after.get(id);
    d.balances = d.balances.map((b, i) => ({
      ...b,
      balance: bd && bd.buckets[i] ? Math.round(bd.buckets[i].balance * 100) / 100 : 0,
    }));
  });

  const nd = built.debts.find((d) => d.id === Engine.NEW_ID);
  if (nd) {
    const id = `d${Date.now()}`;
    const m = active.move;
    const debt = {
      id, userId, kind: nd.kind,
      name: nd.kind === "loan" ? "Consolidation loan" : "New card",
      balances: [{ balance: Math.round(nd.buckets[0].balance * 100) / 100, apr: nd.buckets[0].apr }],
      limit: nd.kind === "card" ? m.limit || 0 : 0,
      dueDay: 15,
      minRule: nd.kind === "loan" ? { type: "fixed", amount: Math.round(nd.minRule.amount * 100) / 100 } : { ...Engine.DEFAULT_MIN_RULE },
    };
    if (nd.kind === "card" && m.promoMonths) {
      debt.promo = { apr: m.promoApr || 0, endMonth: monthOf(m.promoMonths, active.startMonth), deferred: Boolean(m.deferred) };
    }
    debts.push(debt);
    active.newDebtId = id;
  }
  active.applied = true;
  active.done.record = true;
  saveDebts();
  savePlans();
  renderDebt();
  document.getElementById("steps-heading")?.focus();
}

document.getElementById("plan-body").addEventListener("click", (e) => {
  if (e.target.closest("[data-record]")) recordMove();
  if (e.target.closest("[data-ics]")) downloadReminders();
});

document.getElementById("plan-body").addEventListener("change", (e) => {
  const box = e.target.closest("[data-step-key]");
  if (!box) return;
  const active = currentPlan().active;
  if (!active) return;
  if (box.checked) active.done[box.dataset.stepKey] = true;
  else delete active.done[box.dataset.stepKey];
  savePlans();
});

document.getElementById("plan-body").addEventListener("submit", (e) => {
  if (e.target.id !== "update-form") return;
  e.preventDefault();
  const form = e.target;
  const values = [];
  for (const input of form.querySelectorAll("input[data-debt]")) {
    const v = cleanNumber(input.value, 0, 1e9);
    if (v === null) {
      const err = form.querySelector("#update-error");
      err.textContent = "Please enter each balance as a number, or 0 if it's paid off.";
      err.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    values.push([input.dataset.debt, v]);
  }
  // Each debt keeps its APR split; the new total is spread across its balances
  values.forEach(([id, total]) => {
    const d = debts.find((x) => x.id === id);
    if (!d) return;
    const old = debtTotal(d);
    d.balances = d.balances.map((b, i) => ({
      ...b,
      balance: Math.round((old > 0 ? (b.balance / old) * total : i === 0 ? total : 0) * 100) / 100,
    }));
  });
  const active = currentPlan().active;
  if (active) {
    active.updates = active.updates.filter((u) => u.month !== currentMonth());
    active.updates.push({ month: currentMonth(), balances: Object.fromEntries(values) });
    active.done.update = true;
  }
  saveDebts();
  savePlans();
  renderDebt();
  document.getElementById("update-heading")?.focus();
});

// ----- Calendar reminders (.ics) -----
function icsText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function downloadReminders() {
  const M = buildModel();
  const active = M.plan.active;
  if (!active) return;
  const live = planRun(M, active);
  const names = { ...M.names, [Engine.NEW_ID]: "New card" };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = [];
  const ymd = (ym, day) => `${ym.replace("-", "")}${pad(day)}`;

  live.run.months.slice(0, 12).forEach((r) => {
    Object.entries(r.byDebt).forEach(([id, x]) => {
      if (x.payment <= 0.005) return;
      const d = M.list.find((y) => y.id === id);
      const day = d ? d.dueDay : 15;
      const ym = monthOf(r.m);
      events.push([
        "BEGIN:VEVENT",
        `UID:${id}-${ym}@finance-tracker`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(ym, day)}`,
        `SUMMARY:${icsText(`Pay ${money(x.payment)} to ${names[id] || "New card"}`)}`,
        `DESCRIPTION:${icsText(`Debt plan "${active.name}", month ${r.m}. Then update the balance in Finance Tracker.`)}`,
        "BEGIN:VALARM", "TRIGGER:-P2D", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`Payment due to ${names[id] || "New card"}`)}`, "END:VALARM",
        "END:VEVENT",
      ].join("\r\n"));
    });
  });

  const promo = promoCountdown(M, active, live.run);
  if (promo) {
    const [y, m] = promo.endYm.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    events.push([
      "BEGIN:VEVENT",
      `UID:promo-${promo.endYm}@finance-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(promo.endYm, lastDay)}`,
      `SUMMARY:${icsText(`${promo.name} promo ends`)}`,
      `DESCRIPTION:${icsText(`After today ${aprText(promo.goToApr)} applies to any balance left.`)}`,
      "BEGIN:VALARM", "TRIGGER:-P60D", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`${promo.name} promo ends in 60 days`)}`, "END:VALARM",
      "BEGIN:VALARM", "TRIGGER:-P30D", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`${promo.name} promo ends in 30 days`)}`, "END:VALARM",
      "END:VEVENT",
    ].join("\r\n"));
  }

  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Finance Tracker//Debt plan//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n");
  download(`debt-plan-reminders-${today()}.ics`, ics, "text/calendar");
}

// ----- Wiring -----
document.addEventListener("app:render", () => {
  // The view changed (person or family): leave any half-edited scenario behind
  if (renderDebt.lastKey !== planKey()) {
    editingScenarioId = null;
    builderFieldsFor = null;
    timelineMonth = null;
    renderDebt.lastKey = planKey();
  }
  renderDebt();
});
document.addEventListener("app:reload", loadDebtState);

renderDebt.lastKey = planKey();
showStep(activeTab.step);
showTab(activeTab.tab);
