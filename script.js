// ===== Config =====
const STORAGE_KEY = "finance-tracker-expenses";
const CATEGORIES = ["Housing", "Food", "Transport", "Utilities", "Entertainment", "Other"];

// One stroke path per category, drawn in a 24×24 box
const CATEGORY_ICONS = {
  Housing: "M3 10.5 12 3l9 7.5M5 9v12h14V9M10 21v-6h4v6",
  Food: "M7 3v18M4 3v5a3 3 0 0 0 6 0V3M17 21V3c-2.2 0-4 2.5-4 6v5h4",
  Transport: "M7 3h10a2 2 0 0 1 2 2v12H5V5a2 2 0 0 1 2-2zM5 11h14M8 17v3M16 17v3M8.5 14h.01M15.5 14h.01",
  Utilities: "M13 2 4 14h7l-1 8 9-12h-7z",
  Entertainment: "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0zM10 8.5v7l6-3.5z",
  Other: "M3 3h8l10 10-8 8L3 11zM7.5 7.5h.01",
};
const CLOSE_ICON = "M6 6l12 12M18 6 6 18";
const INCOME_ICON = "M12 19V5M5 12l7-7 7 7";

// Entries are expenses unless type is "income" (older saved data has no type)
const INCOME = "Income";
const NEW_CATEGORY = "__new__";
const CUSTOM_NAME_MAX = 24;
// [background, foreground] tints for user-named categories, picked by name
const CUSTOM_TINTS = [
  ["#fce7f3", "#be185d"],
  ["#e0f2fe", "#0369a1"],
  ["#ecfccb", "#4d7c0f"],
  ["#e0e7ff", "#4338ca"],
];

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
});

// ===== DOM =====
const form = document.getElementById("expense-form");
const amountInput = document.getElementById("amount");
const dateInput = document.getElementById("date");
const descInput = document.getElementById("description");
const categoryInput = document.getElementById("category");
const formError = document.getElementById("form-error");
const formErrorText = document.getElementById("form-error-text");
const descCount = document.getElementById("desc-count");
const addHeading = document.getElementById("add-heading");
const submitLabel = document.getElementById("submit-label");
const typeBtns = document.querySelectorAll(".type-btn");
const categoryField = document.getElementById("category-field");
const customCatField = document.getElementById("custom-cat-field");
const customCatInput = document.getElementById("custom-category");
const sumIncome = document.getElementById("sum-income");
const sumSpent = document.getElementById("sum-spent");
const sumBalance = document.getElementById("sum-balance");
const balanceLabel = document.getElementById("balance-label");
const meter = document.getElementById("meter");
const meterFill = document.getElementById("meter-fill");
const ledgerNote = document.getElementById("ledger-note");
const personField = document.getElementById("person-field");
const personInput = document.getElementById("person");
const personLabel = document.getElementById("person-label");
const byPerson = document.getElementById("by-person");
const byPersonList = document.getElementById("by-person-list");
const byCategoryHeading = document.getElementById("by-category-heading");
const familyBar = document.getElementById("family-bar");
const familyChips = document.getElementById("family-chips");
const monthFilter = document.getElementById("month-filter");
const txList = document.getElementById("transaction-list");
const emptyState = document.getElementById("empty-state");
const summaryMonth = document.getElementById("summary-month");
const summaryTotal = document.getElementById("summary-total");
const summaryCount = document.getElementById("summary-count");
const breakdownList = document.getElementById("category-breakdown");

// ===== Icons =====
const SVG_NS = "http://www.w3.org/2000/svg";

function icon(d) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

// Colours come from the nearest .cat[data-cat] ancestor (see style.css)
function categoryTile(category) {
  const tile = document.createElement("span");
  tile.className = "cat-tile";
  const d = category === INCOME ? INCOME_ICON : CATEGORY_ICONS[category] || CATEGORY_ICONS.Other;
  tile.appendChild(icon(d));
  return tile;
}

// Marks el as a category container; custom names get a stable tint from the palette
function applyCategory(el, category) {
  el.classList.add("cat");
  el.dataset.cat = category;
  if (category === INCOME || CATEGORIES.includes(category)) return;
  const hash = [...category].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const [bg, fg] = CUSTOM_TINTS[hash % CUSTOM_TINTS.length];
  el.style.setProperty("--cat-bg", bg);
  el.style.setProperty("--cat-fg", fg);
}

// ===== Storage =====
function loadExpenses() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveExpenses() {
  saveJSON(STORAGE_KEY, expenses);
}

let expenses = loadExpenses();

// People share this device. "view" is a person's id, or FAMILY for everyone not excluded.
const USERS_KEY = "finance-tracker-users";
const VIEW_KEY = "finance-tracker-view";
const EXCLUDED_KEY = "finance-tracker-family-excluded";
// Debt planner (debt.js): debts per person, and planner state per view
const DEBTS_KEY = "finance-tracker-debts";
const DEBT_PLANS_KEY = "finance-tracker-debt-plans";
const FAMILY = "family";
const PERSON_NAME_MAX = 20;
const PERSON_COLORS = ["#2563eb", "#c2410c", "#0f766e", "#7e22ce", "#be185d", "#4d7c0f"];

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

// Every write goes through here, so a failed save is never silent.
// Returns false when the browser refused it (storage full or blocked).
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    reportSaveFailure();
    return false;
  }
}

// Looks its elements up on each call: this can run during start-up, before the
// rest of the file has defined anything.
function reportSaveFailure() {
  const banner = document.getElementById("save-error");
  if (!banner) return;
  banner.hidden = false;
}

let users = loadJSON(USERS_KEY, []);
if (!users.length) {
  users = [{ id: `u${Date.now()}`, name: "Me", color: PERSON_COLORS[0] }];
  saveJSON(USERS_KEY, users);
}

// Entries saved before people existed belong to the first person
if (expenses.some((e) => !e.userId)) {
  expenses.forEach((e) => { e.userId ||= users[0].id; });
  saveJSON(STORAGE_KEY, expenses);
}

let excluded = new Set(loadJSON(EXCLUDED_KEY, []));
let view = loadJSON(VIEW_KEY, users[0].id);

const userById = (id) => users.find((u) => u.id === id);
const isFamily = () => view === FAMILY;
const familyMembers = () => users.filter((u) => !excluded.has(u.id));

// Is this entry part of what's on screen?
function inView(e) {
  return isFamily() ? !excluded.has(e.userId) : e.userId === view;
}

// Keeps view and the family selection pointing at people who exist
function normalizeView() {
  excluded = new Set([...excluded].filter((id) => userById(id)));
  if (!familyMembers().length) excluded.clear();
  if (isFamily() ? users.length < 2 : !userById(view)) view = users[0].id;
}
normalizeView();

// ===== Date & month helpers =====
// Days are "YYYY-MM-DD" and months are "YYYY-MM", both in local time.
// These strings sort correctly, so plain < and > comparisons work.
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isValidMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function today() {
  return toISO(new Date());
}

function currentMonth() {
  return today().slice(0, 7);
}

function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function addMonths(yyyyMm, n) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// "Fri, Oct 30", plus the year when it isn't this year
function formatDate(isoDate) {
  const d = parseISO(isoDate);
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

function formatMonth(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ===== Data queries =====
function expensesForMonth(month) {
  return expenses
    .filter((e) => inView(e) && e.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

const isIncome = (e) => e.type === "income";

// User-named expense categories, taken from saved expenses (deleting the last one removes it)
function customCategories() {
  const names = new Set(expenses.filter((e) => !isIncome(e)).map((e) => e.category));
  CATEGORIES.forEach((c) => names.delete(c));
  return [...names].sort((a, b) => a.localeCompare(b));
}

// Reuses an existing category's spelling when the typed name matches it
function matchCategory(name) {
  const lower = name.toLowerCase();
  return [...CATEGORIES, ...customCategories()].find((c) => c.toLowerCase() === lower) || name;
}

// Spending per month (income isn't counted)
function monthTotals() {
  const totals = {};
  expenses.filter((e) => inView(e) && !isIncome(e)).forEach((e) => {
    const key = e.date.slice(0, 7);
    totals[key] = (totals[key] || 0) + e.amount;
  });
  return totals;
}

// Months you can navigate to: the past 10 years (or your earliest expense, if older)
// up to next month (for planned bills) or your latest expense.
const YEARS_BACK = 10;

function monthRange() {
  const cur = currentMonth();
  const months = expenses.map((e) => e.date.slice(0, 7));
  months.push(addMonths(cur, -12 * YEARS_BACK), addMonths(cur, 1));
  if (monthFilter.value) months.push(monthFilter.value);
  months.sort();
  return { min: months[0], max: months[months.length - 1] };
}

function clampMonth(month) {
  const { min, max } = monthRange();
  return month < min ? min : month > max ? max : month;
}

// ===== Rendering =====
function renderTransactions(list) {
  txList.innerHTML = "";
  emptyState.hidden = list.length > 0;

  list.forEach((exp) => {
    const li = document.createElement("li");
    const income = isIncome(exp);
    li.className = "transaction";
    applyCategory(li, income ? INCOME : exp.category);

    const info = document.createElement("div");
    info.className = "tx-info";

    const desc = document.createElement("div");
    desc.className = "tx-desc";
    desc.textContent = exp.description; // textContent prevents HTML injection

    const meta = document.createElement("div");
    meta.className = "tx-meta";
    meta.textContent = `${income ? INCOME : exp.category} · ${formatDate(exp.date)}`;
    const owner = userById(exp.userId);
    if (isFamily() && owner) {
      const who = document.createElement("span");
      who.className = "tx-person";
      who.append(avatar(owner, "xs"), owner.name);
      meta.append(" · ", who);
    }

    info.append(desc, meta);

    const amount = document.createElement("span");
    amount.className = income ? "tx-amount income" : "tx-amount";
    amount.textContent = (income ? "+" : "") + currency.format(exp.amount);

    const del = document.createElement("button");
    del.className = "btn-delete";
    del.type = "button";
    del.title = "Delete";
    del.setAttribute("aria-label", `Delete ${exp.description}`);
    del.appendChild(icon(CLOSE_ICON));
    del.addEventListener("click", () => deleteExpense(exp.id));

    li.append(categoryTile(income ? INCOME : exp.category), info, amount, del);
    txList.appendChild(li);
  });
}

function renderSummary(entries, month) {
  const list = entries.filter((e) => !isIncome(e));
  const incomeTotal = entries.filter(isIncome).reduce((sum, e) => sum + e.amount, 0);
  const total = list.reduce((sum, e) => sum + e.amount, 0);
  const whose = isFamily() ? " · Family" : users.length > 1 ? ` · ${userById(view).name}` : "";
  summaryMonth.textContent = `Total spent · ${formatMonth(month)}${whose}`;
  summaryTotal.textContent = currency.format(total);
  summaryTotal.classList.toggle("zero", total === 0);
  summaryCount.textContent = list.length === 0 ? "No expenses yet"
    : `${list.length} ${list.length === 1 ? "expense" : "expenses"}`;

  renderLedger(incomeTotal, total, month);
  renderByPerson(entries, total);

  // Built-in categories always show; custom ones only in months they were used
  const monthCustom = [...new Set(list.map((e) => e.category))].filter((c) => !CATEGORIES.includes(c));
  breakdownList.innerHTML = "";
  [...CATEGORIES, ...monthCustom].forEach((cat) => {
    const catTotal = list
      .filter((e) => e.category === cat)
      .reduce((sum, e) => sum + e.amount, 0);
    const pct = total > 0 ? (catTotal / total) * 100 : 0;

    const li = document.createElement("li");
    applyCategory(li, cat);
    li.classList.toggle("empty-cat", catTotal === 0);
    li.innerHTML = `
      <span class="breakdown-name"></span>
      <span class="breakdown-values">
        <span class="breakdown-amount">${currency.format(catTotal)}</span>
        <span class="breakdown-pct">${pct.toFixed(0)}%</span>
      </span>
      <span class="bar"><span class="bar-fill" style="display:block;width:${pct}%"></span></span>
    `;
    li.querySelector(".breakdown-name").textContent = cat; // custom names are user input
    li.prepend(categoryTile(cat));
    breakdownList.appendChild(li);
  });
}

// Family view only: each included person's spending, share of the total, and income
function renderByPerson(entries, familySpent) {
  byPerson.hidden = !isFamily();
  byCategoryHeading.hidden = !isFamily();
  if (!isFamily()) return;

  byPersonList.innerHTML = "";
  familyMembers().forEach((user) => {
    const mine = entries.filter((e) => e.userId === user.id);
    const spent = mine.filter((e) => !isIncome(e)).reduce((sum, e) => sum + e.amount, 0);
    const earned = mine.filter(isIncome).reduce((sum, e) => sum + e.amount, 0);
    const pct = familySpent > 0 ? (spent / familySpent) * 100 : 0;

    const li = document.createElement("li");
    li.style.setProperty("--person", user.color);
    li.innerHTML = `
      <span class="by-person-name"></span>
      <span class="breakdown-values">
        <span class="breakdown-amount">${currency.format(spent)}</span>
        <span class="breakdown-pct">${pct.toFixed(0)}%</span>
      </span>
      <span class="by-person-sub">
        <span class="bar"><span class="bar-fill" style="display:block;width:${pct}%"></span></span>
        <span>Income ${currency.format(earned)}</span>
      </span>
    `;
    li.querySelector(".by-person-name").textContent = user.name;
    li.prepend(avatar(user));
    byPersonList.appendChild(li);
  });
}

// Income − Spent = Left over, plus how much of the income was used
function renderLedger(income, spent, month) {
  const balance = income - spent;
  sumIncome.textContent = currency.format(income);
  sumSpent.textContent = `−${currency.format(spent)}`;
  sumBalance.textContent = balance < 0 ? `−${currency.format(-balance)}` : currency.format(balance);
  sumBalance.classList.toggle("negative", balance < 0);
  balanceLabel.textContent = balance < 0 ? "Overspent" : "Left over";

  meter.hidden = income === 0;
  const used = income > 0 ? spent / income : 0;
  meterFill.style.width = `${Math.min(used, 1) * 100}%`;
  meterFill.classList.toggle("over", used > 1);

  const monthName = formatMonth(month).split(" ")[0];
  if (income === 0) {
    ledgerNote.textContent = `No income logged for ${monthName} yet.`;
  } else if (balance >= 0) {
    ledgerNote.textContent = `${Math.round(used * 100)}% of income spent · you kept ${Math.round((1 - used) * 100)}%.`;
  } else {
    ledgerNote.textContent = `You spent ${currency.format(-balance)} more than you earned.`;
  }
}

function renderMonthControls() {
  const month = monthFilter.value;
  const { min, max } = monthRange();

  monthDisplay.textContent = formatMonth(month);
  monthPrev.disabled = month <= min;
  monthNext.disabled = month >= max;
  monthPrev.title = monthPrev.disabled ? "No earlier months" : "Previous month";
  monthNext.title = monthNext.disabled ? "No later months" : "Next month";
  monthCurrentBtn.hidden = month === currentMonth();
}

function render() {
  const month = monthFilter.value;
  const list = expensesForMonth(month);
  renderPeople();
  renderMonthControls();
  renderCategoryOptions();
  renderTransactions(list);
  renderSummary(list, month);
  renderBackupReminder();
  document.dispatchEvent(new Event("app:render")); // the debt planner redraws for the current view
}

// ===== Actions =====
function addExpense(event) {
  event.preventDefault();

  const amount = parseFloat(amountInput.value);
  const date = dateInput.value;
  const description = descInput.value.trim();
  const income = entryType === "income";
  let category = income ? INCOME : categoryInput.value;

  if (!amount || amount <= 0) return showError("Please enter an amount greater than 0.", amountInput);
  if (!date) return showError("Please choose a date.", dateTrigger);
  if (!description) return showError("Please enter a description.", descInput);

  if (category === NEW_CATEGORY) {
    const name = customCatInput.value.trim().replace(/\s+/g, " ");
    if (!name) return showError("Please name your new category.", customCatInput);
    if (name.toLowerCase() === INCOME.toLowerCase()) {
      return showError("“Income” is reserved. Please pick another name.", customCatInput);
    }
    category = matchCategory(name);
  }

  const entry = {
    id: Date.now(),
    amount: Math.round(amount * 100) / 100,
    date,
    description,
    category,
  };
  if (income) entry.type = "income";
  entry.userId = isFamily() ? personInput.value : view;
  expenses.push(entry);
  saveExpenses();
  noteChange();

  form.reset();
  customCatField.hidden = true;
  setDate(date); // keep the chosen date (and entry type) for quick multi-entry
  updateDescCount();
  showError("");
  amountInput.focus();

  // Jump to the month of the new entry so the user sees it
  setMonth(date.slice(0, 7));
}

function deleteExpense(id) {
  expenses = expenses.filter((e) => e.id !== id);
  saveExpenses();
  noteChange();
  render();
}

// Shows one inline error (or clears it) and marks the offending field invalid
function showError(message, field) {
  formErrorText.textContent = message;
  formError.hidden = !message;
  [amountInput, dateTrigger, descInput, customCatInput].forEach((el) => {
    if (el === field) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  });
  field?.focus();
}

function updateDescCount() {
  descCount.textContent = `${descInput.value.length} / ${descInput.maxLength}`;
}

// ===== Entry type & categories =====
let entryType = "expense";

function setEntryType(type) {
  entryType = type;
  const income = type === "income";
  typeBtns.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.type === type)));
  addHeading.textContent = income ? "Add Income" : "Add Expense";
  submitLabel.textContent = income ? "Add Income" : "Add Expense";
  descInput.placeholder = income ? "e.g. Salary" : "e.g. Groceries";
  categoryField.hidden = income;
  personLabel.textContent = income ? "Received by" : "Paid by";
  showError("");
}

// Built-ins, then the user's own categories, then "New category…"
function renderCategoryOptions() {
  const current = categoryInput.value;
  const builtIn = CATEGORIES.map((c) => new Option(c, c));
  const custom = customCategories();
  const children = [...builtIn];
  if (custom.length) {
    const group = document.createElement("optgroup");
    group.label = "Your categories";
    group.append(...custom.map((c) => new Option(c, c)));
    children.push(group);
  }
  children.push(new Option("+ New category…", NEW_CATEGORY));
  categoryInput.replaceChildren(...children);
  if ([...categoryInput.options].some((o) => o.value === current)) categoryInput.value = current;
  customCatField.hidden = categoryInput.value !== NEW_CATEGORY;
}

function onCategoryChange() {
  const isNew = categoryInput.value === NEW_CATEGORY;
  customCatField.hidden = !isNew;
  if (isNew) customCatInput.focus();
  else if (customCatInput.hasAttribute("aria-invalid")) showError("");
}

// ===== Shared popover behaviour =====
// Handles open/close, aria-expanded, Esc, and closing on outside click or tab-away.
function createPopover({ root, trigger, panel, onOpen }) {
  const isOpen = () => !panel.hidden;

  function open() {
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    onOpen();
  }

  function close(returnFocus = true) {
    if (!isOpen()) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) trigger.focus();
  }

  trigger.addEventListener("click", () => (isOpen() ? close() : open()));

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      e.preventDefault();
      close();
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!root.contains(e.target)) close(false);
  });

  root.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !root.contains(e.relatedTarget)) close(false);
  });

  return { open, close, isOpen };
}

// ===== Date picker =====
const datePickerEl = document.getElementById("datepicker");
const dateTrigger = document.getElementById("date-trigger");
const dateDisplay = document.getElementById("date-display");
const calendar = document.getElementById("calendar");
const calTitle = document.getElementById("cal-title");
const calGrid = document.getElementById("cal-grid");
const shortcutBtns = document.querySelectorAll("[data-day-offset]");

let viewYear, viewMonth; // month currently shown in the calendar
let focusDate;           // day that has keyboard focus

function setDate(iso) {
  dateInput.value = iso;

  const t = today();
  const d = parseISO(iso);
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";

  const label = d.toLocaleDateString("en-US", opts);
  const prefix = iso === t ? "Today" : iso === addDays(t, -1) ? "Yesterday" : "";
  if (prefix) {
    const strong = document.createElement("strong");
    strong.textContent = prefix;
    dateDisplay.replaceChildren(strong, ` · ${label}`);
  } else {
    dateDisplay.textContent = label;
  }

  shortcutBtns.forEach((btn) => {
    const active = addDays(t, Number(btn.dataset.dayOffset)) === iso;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function showMonthOf(iso) {
  const d = parseISO(iso);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
}

function renderCalendar() {
  const first = new Date(viewYear, viewMonth, 1);
  calTitle.textContent = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const t = today();
  const loggedDays = new Set(expenses.filter((e) => inView(e) && !isIncome(e)).map((e) => e.date));
  const startOffset = first.getDay(); // grid starts on the Sunday before the 1st

  calGrid.innerHTML = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(viewYear, viewMonth, 1 - startOffset + i);
    const iso = toISO(d);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-day";
    btn.textContent = d.getDate();
    btn.dataset.date = iso;
    btn.tabIndex = iso === focusDate ? 0 : -1;
    btn.setAttribute("aria-label", d.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    }));

    if (d.getMonth() !== viewMonth) btn.classList.add("outside");
    if (iso === t) btn.classList.add("today");
    if (loggedDays.has(iso)) btn.classList.add("has-expense");
    if (iso === dateInput.value) {
      btn.classList.add("selected");
      btn.setAttribute("aria-pressed", "true");
    }
    calGrid.appendChild(btn);
  }
}

function focusDay() {
  calGrid.querySelector(`[data-date="${focusDate}"]`)?.focus();
}

const datePopover = createPopover({
  root: datePickerEl,
  trigger: dateTrigger,
  panel: calendar,
  onOpen() {
    focusDate = dateInput.value || today();
    showMonthOf(focusDate);
    renderCalendar();
    focusDay();
  },
});

function changeCalendarMonth(delta) {
  const target = new Date(viewYear, viewMonth + delta, 1);
  viewYear = target.getFullYear();
  viewMonth = target.getMonth();

  // Keep the same day-of-month focused (clamped to month length)
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  const day = Math.min(parseISO(focusDate).getDate(), lastDay);
  focusDate = toISO(new Date(viewYear, viewMonth, day));
  renderCalendar();
}

function selectDate(iso) {
  setDate(iso);
  datePopover.close();
}

document.getElementById("cal-prev").addEventListener("click", () => changeCalendarMonth(-1));
document.getElementById("cal-next").addEventListener("click", () => changeCalendarMonth(1));
document.getElementById("cal-today").addEventListener("click", () => selectDate(today()));

calGrid.addEventListener("click", (e) => {
  const day = e.target.closest(".cal-day");
  if (day) selectDate(day.dataset.date);
});

// Arrows move by day/week, PageUp/PageDown by month
const DAY_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
calGrid.addEventListener("keydown", (e) => {
  if (e.key in DAY_STEPS) {
    e.preventDefault();
    focusDate = addDays(focusDate, DAY_STEPS[e.key]);
    showMonthOf(focusDate);
    renderCalendar();
    focusDay();
  } else if (e.key === "PageUp" || e.key === "PageDown") {
    e.preventDefault();
    changeCalendarMonth(e.key === "PageUp" ? -1 : 1);
    focusDay();
  }
});

shortcutBtns.forEach((btn) => {
  btn.addEventListener("click", () => setDate(addDays(today(), Number(btn.dataset.dayOffset))));
});

// ===== Month picker =====
const monthPickerEl = document.getElementById("monthpicker");
const monthTrigger = document.getElementById("month-trigger");
const monthDisplay = document.getElementById("month-display");
const monthPrev = document.getElementById("month-prev");
const monthNext = document.getElementById("month-next");
const monthCurrentBtn = document.getElementById("month-current");
const monthPanel = document.getElementById("month-popover");
const mpTitle = document.getElementById("mp-title");
const mpPrevYear = document.getElementById("mp-prev-year");
const mpNextYear = document.getElementById("mp-next-year");
const mpGrid = document.getElementById("mp-grid");
const mpYearTotal = document.getElementById("mp-year-total");

let mpYear;  // year shown in the month grid
let mpFocus; // "YYYY-MM" with keyboard focus

// The selected month lives in the URL (#2026-10): refresh keeps it, Back/Forward work.
function setMonth(month, { push = true } = {}) {
  month = clampMonth(month);
  if (location.hash !== `#${month}`) updateUrl(month, push);
  monthFilter.value = month;
  render();
}

function updateUrl(month, push) {
  try {
    history[push ? "pushState" : "replaceState"](null, "", `#${month}`);
  } catch {
    // Some sandboxed previews block history changes; the app still works without it.
  }
}

function monthFromHash() {
  const m = location.hash.slice(1);
  return isValidMonth(m) ? m : null;
}

function renderMonthGrid() {
  const { min, max } = monthRange();
  const totals = monthTotals();
  const cur = currentMonth();
  let yearTotal = 0;

  mpTitle.textContent = mpYear;
  mpPrevYear.disabled = `${mpYear - 1}-12` < min;
  mpNextYear.disabled = `${mpYear + 1}-01` > max;

  mpGrid.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const ym = `${mpYear}-${pad(i + 1)}`;
    const total = totals[ym] || 0;
    yearTotal += total;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mg-cell";
    btn.dataset.month = ym;
    btn.disabled = ym < min || ym > max;
    btn.tabIndex = ym === mpFocus ? 0 : -1;
    btn.setAttribute("aria-label",
      `${formatMonth(ym)}, ${total ? currency.format(total) + " spent" : "no expenses"}`);

    const name = document.createElement("span");
    name.className = "mg-name";
    name.textContent = new Date(mpYear, i, 1).toLocaleDateString("en-US", { month: "short" });

    const sub = document.createElement("span");
    sub.className = "mg-total";
    sub.textContent = total ? compactCurrency.format(total) : "—";

    if (!total) btn.classList.add("no-data");
    if (ym === cur) {
      btn.classList.add("current");
      btn.setAttribute("aria-current", "date");
    }
    if (ym === monthFilter.value) {
      btn.classList.add("selected");
      btn.setAttribute("aria-pressed", "true");
    }

    btn.append(name, sub);
    mpGrid.appendChild(btn);
  }

  const strong = document.createElement("strong");
  strong.textContent = currency.format(yearTotal);
  mpYearTotal.replaceChildren(`${mpYear} total · `, strong);
}

function focusMonth() {
  mpGrid.querySelector(`[data-month="${mpFocus}"]`)?.focus();
}

const monthPopover = createPopover({
  root: monthPickerEl,
  trigger: monthTrigger,
  panel: monthPanel,
  onOpen() {
    mpFocus = monthFilter.value;
    mpYear = Number(mpFocus.slice(0, 4));
    renderMonthGrid();
    focusMonth();
  },
});

function changeGridYear(delta) {
  mpYear += delta;
  mpFocus = clampMonth(`${mpYear}-${mpFocus.slice(5)}`);
  renderMonthGrid();
}

function selectMonth(month) {
  setMonth(month);
  monthPopover.close();
}

monthPrev.addEventListener("click", () => {
  monthPopover.close(false);
  setMonth(addMonths(monthFilter.value, -1));
});
monthNext.addEventListener("click", () => {
  monthPopover.close(false);
  setMonth(addMonths(monthFilter.value, 1));
});
monthCurrentBtn.addEventListener("click", () => {
  monthPopover.close(false);
  setMonth(currentMonth());
});

mpPrevYear.addEventListener("click", () => changeGridYear(-1));
mpNextYear.addEventListener("click", () => changeGridYear(1));
document.getElementById("mp-this-month").addEventListener("click", () => selectMonth(currentMonth()));

mpGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".mg-cell");
  if (cell && !cell.disabled) selectMonth(cell.dataset.month);
});

// Arrows move by month/row, PageUp/PageDown by year (stays within range)
const MONTH_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4, PageUp: -12, PageDown: 12 };
mpGrid.addEventListener("keydown", (e) => {
  const step = MONTH_STEPS[e.key];
  if (!step) return;
  e.preventDefault();
  mpFocus = clampMonth(addMonths(mpFocus, step));
  mpYear = Number(mpFocus.slice(0, 4));
  renderMonthGrid();
  focusMonth();
});

window.addEventListener("popstate", () => {
  monthPopover.close(false);
  setMonth(monthFromHash() || currentMonth(), { push: false });
});

// ===== People =====
const peoplePickerEl = document.getElementById("peoplepicker");
const peopleTrigger = document.getElementById("people-trigger");
const peopleAvatar = document.getElementById("people-avatar");
const peopleName = document.getElementById("people-name");
const peoplePanel = document.getElementById("people-popover");
const peopleList = document.getElementById("people-list");
const peopleDialog = document.getElementById("people-dialog");
const manageList = document.getElementById("manage-list");
const addPersonForm = document.getElementById("add-person-form");
const personNameInput = document.getElementById("person-name");
const personError = document.getElementById("person-error");
const CHECK_ICON = "M5 12.5l4.5 4.5L19 7";

const initial = (name) => name.trim().charAt(0).toUpperCase();
const cleanName = (name) => name.trim().replace(/\s+/g, " ").slice(0, PERSON_NAME_MAX);

function avatar(user, size) {
  const el = document.createElement("span");
  el.className = size ? `avatar avatar-${size}` : "avatar";
  el.style.setProperty("--person", user.color);
  el.setAttribute("aria-hidden", "true");
  el.textContent = initial(user.name);
  return el;
}

function avatarStack(list) {
  const stack = document.createElement("span");
  stack.className = "avatar-stack";
  list.slice(0, 3).forEach((u) => stack.append(avatar(u, "sm")));
  return stack;
}

function smallIcon(d, extraClass) {
  const svg = icon(d);
  svg.classList.add("icon-sm");
  if (extraClass) svg.classList.add(extraClass);
  return svg;
}

function saveUsers() {
  saveJSON(USERS_KEY, users);
}

function saveView() {
  saveJSON(VIEW_KEY, view);
  saveJSON(EXCLUDED_KEY, [...excluded]);
}

function setView(next) {
  view = next;
  normalizeView();
  saveView();
  render();
}

// Header switcher, family chips and the form's "Paid by" field
function renderPeople() {
  const family = isFamily();
  if (family) {
    peopleAvatar.replaceChildren(avatarStack(familyMembers()));
    peopleName.textContent = "Family";
  } else {
    const user = userById(view);
    peopleAvatar.replaceChildren(avatar(user));
    peopleName.textContent = user.name;
  }

  familyBar.hidden = !family;
  if (family) {
    const includedCount = familyMembers().length;
    familyChips.replaceChildren(...users.map((user) => {
      const on = !excluded.has(user.id);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "person-chip";
      chip.dataset.user = user.id;
      chip.setAttribute("aria-pressed", String(on));
      chip.disabled = on && includedCount === 1; // the family always keeps one person
      chip.append(avatar(user, "sm"), user.name, smallIcon(CHECK_ICON));
      return chip;
    }));
  }

  personField.hidden = !family;
  if (family) {
    const current = personInput.value;
    personInput.replaceChildren(...familyMembers().map((u) => new Option(u.name, u.id)));
    if (familyMembers().some((u) => u.id === current)) personInput.value = current;
  }
}

function toggleFamilyMember(id) {
  if (excluded.has(id)) excluded.delete(id);
  else excluded.add(id);
  saveView();
  render();
  familyChips.querySelector(`[data-user="${id}"]`)?.focus();
}

// Popover: Family first (with 2+ people), then each person
function renderPeopleList() {
  const options = [];
  if (users.length > 1) {
    const included = familyMembers().length;
    options.push({
      id: FAMILY,
      name: "Family",
      sub: included === users.length ? "Everyone combined" : `${included} of ${users.length} people combined`,
      pic: avatarStack(familyMembers()),
    });
  }
  users.forEach((u) => options.push({ id: u.id, name: u.name, pic: avatar(u) }));

  peopleList.replaceChildren(...options.map((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "people-option";
    btn.dataset.view = opt.id;
    btn.setAttribute("aria-pressed", String(opt.id === view));

    const text = document.createElement("span");
    text.className = "people-option-text";
    const name = document.createElement("span");
    name.className = "people-option-name";
    name.textContent = opt.name;
    text.append(name);
    if (opt.sub) {
      const sub = document.createElement("span");
      sub.className = "people-option-sub";
      sub.textContent = opt.sub;
      text.append(sub);
    }

    btn.append(opt.pic, text, smallIcon(CHECK_ICON, "check"));
    return btn;
  }));

  if (users.length > 1) {
    const divider = document.createElement("div");
    divider.className = "people-divider";
    peopleList.firstElementChild.after(divider);
  }
}

const peoplePopover = createPopover({
  root: peoplePickerEl,
  trigger: peopleTrigger,
  panel: peoplePanel,
  onOpen() {
    renderPeopleList();
    (peopleList.querySelector('[aria-pressed="true"]') || peopleList.querySelector("button")).focus();
  },
});

peopleList.addEventListener("click", (e) => {
  const option = e.target.closest(".people-option");
  if (!option) return;
  setView(option.dataset.view);
  peoplePopover.close();
});

// Up/Down move between options
peopleList.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const options = [...peopleList.querySelectorAll(".people-option")];
  const i = options.indexOf(document.activeElement);
  const next = options[(i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length];
  next.focus();
});

familyChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".person-chip");
  if (chip && !chip.disabled) toggleFamilyMember(chip.dataset.user);
});

// ----- Manage people dialog -----
function nameError(name, exceptId) {
  if (!name) return "Please enter a name.";
  const taken = users.some((u) => u.id !== exceptId && u.name.toLowerCase() === name.toLowerCase());
  return taken ? "Someone already has that name." : "";
}

function renderManageList() {
  manageList.replaceChildren(...users.map((user) => {
    const count = expenses.filter((e) => e.userId === user.id).length;
    const debtCount = loadJSON(DEBTS_KEY, []).filter((d) => d.userId === user.id).length;
    const li = document.createElement("li");

    const nameWrap = document.createElement("div");
    nameWrap.className = "manage-name";
    const input = document.createElement("input");
    input.type = "text";
    input.value = user.name;
    input.maxLength = PERSON_NAME_MAX;
    input.setAttribute("aria-label", `Name for ${user.name}`);
    input.addEventListener("change", () => renamePerson(user, input));
    const sub = document.createElement("span");
    sub.className = "manage-count";
    const parts = [];
    if (count) parts.push(`${count} ${count === 1 ? "entry" : "entries"}`);
    if (debtCount) parts.push(`${debtCount} ${debtCount === 1 ? "debt" : "debts"}`);
    sub.textContent = parts.length ? parts.join(" · ") : "No entries";
    nameWrap.append(input, sub);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-delete";
    del.setAttribute("aria-label", `Remove ${user.name}`);
    del.disabled = count + debtCount > 0 || users.length === 1;
    del.appendChild(icon(CLOSE_ICON));
    del.addEventListener("click", () => removePerson(user.id));

    li.append(avatar(user), nameWrap, del);
    return li;
  }));
}

function renamePerson(user, input) {
  const name = cleanName(input.value);
  const error = nameError(name, user.id);
  if (error) {
    input.value = user.name;
    personError.textContent = error;
    return;
  }
  user.name = name;
  input.value = name;
  input.setAttribute("aria-label", `Name for ${name}`);
  input.closest("li").querySelector(".avatar").textContent = initial(name);
  personError.textContent = "";
  saveUsers();
  noteChange();
  render();
}

function removePerson(id) {
  users = users.filter((u) => u.id !== id);
  excluded.delete(id);
  normalizeView();
  saveUsers();
  saveView();
  noteChange();
  renderManageList();
  render();
  personNameInput.focus();
}

function openPeopleDialog() {
  renderManageList();
  personError.textContent = "";
  peopleDialog.showModal();
  personNameInput.focus();
}

addPersonForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = cleanName(personNameInput.value);
  const error = nameError(name);
  if (error) {
    personError.textContent = error;
    personNameInput.setAttribute("aria-invalid", "true");
    personNameInput.focus();
    return;
  }
  const used = new Set(users.map((u) => u.color));
  const color = PERSON_COLORS.find((c) => !used.has(c)) || PERSON_COLORS[users.length % PERSON_COLORS.length];
  users.push({ id: `u${Date.now()}`, name, color });
  saveUsers();
  noteChange();

  personNameInput.value = "";
  personNameInput.removeAttribute("aria-invalid");
  personError.textContent = "";
  renderManageList();
  render();
  personNameInput.focus();
});

document.getElementById("manage-people").addEventListener("click", () => {
  peoplePopover.close(false);
  openPeopleDialog();
});
document.getElementById("people-dialog-close").addEventListener("click", () => peopleDialog.close());
peopleDialog.addEventListener("close", () => peopleTrigger.focus());

// ===== Backup & restore =====
// A backup is one JSON file with everything this app keeps in localStorage:
// { app, schemaVersion, exportedAt, data: { users, expenses, view, excluded, debts?, debtPlans? } }
// debts and debtPlans are optional, so files from before the debt planner still restore.
const BACKUP_APP = "finance-tracker";
const BACKUP_VERSION = 1;
const BACKUP_META_KEY = "finance-tracker-backup";
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const DESC_MAX = 80;

// Reminder rules: nag after this many changes (or fewer for a first backup),
// or when changes are this many days old. "Later" snoozes for SNOOZE_DAYS.
const REMIND_AFTER_CHANGES = 20;
const REMIND_FIRST_BACKUP_AFTER = 10;
const REMIND_AFTER_DAYS = 14;
const SNOOZE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const backupOpenBtn = document.getElementById("backup-open");
const backupDot = document.getElementById("backup-dot");
const backupBanner = document.getElementById("backup-banner");
const backupBannerMsg = document.getElementById("backup-banner-msg");
const backupDialog = document.getElementById("backup-dialog");
const backupStatus = document.getElementById("backup-status");
const importFile = document.getElementById("import-file");
const importChoose = document.getElementById("import-choose");
const importPreview = document.getElementById("import-preview");
const importFileName = document.getElementById("import-file-name");
const importSummary = document.getElementById("import-summary");
const importReplaceNote = document.getElementById("import-replace-note");
const importConfirm = document.getElementById("import-confirm");
const importError = document.getElementById("import-error");
const importErrorText = document.getElementById("import-error-text");
const importDone = document.getElementById("import-done");
const importDoneText = document.getElementById("import-done-text");
const importUndo = document.getElementById("import-undo");

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const isValidDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s;
const isValidTime = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));

// ----- Reminder state: { lastBackupAt, changes, snoozedUntil } -----
function loadBackupMeta() {
  const m = loadJSON(BACKUP_META_KEY, null);
  if (m && typeof m === "object" && Number.isFinite(m.changes)) return m;
  // First run with backups: everything already saved counts as not backed up
  return { lastBackupAt: null, changes: expenses.length, snoozedUntil: null };
}

let backupMeta = loadBackupMeta();
saveJSON(BACKUP_META_KEY, backupMeta);

function setBackupMeta(next) {
  backupMeta = { ...backupMeta, ...next };
  saveJSON(BACKUP_META_KEY, backupMeta);
}

// Called after every add, delete or people edit
function noteChange(n = 1) {
  setBackupMeta({ changes: backupMeta.changes + n });
}

function backupDue({ ignoreSnooze = false } = {}) {
  const { lastBackupAt, changes, snoozedUntil } = backupMeta;
  const now = Date.now();
  if (!changes) return false;
  if (!ignoreSnooze && isValidTime(snoozedUntil) && now < Date.parse(snoozedUntil)) return false;
  if (!isValidTime(lastBackupAt)) return changes >= REMIND_FIRST_BACKUP_AFTER;
  return changes >= REMIND_AFTER_CHANGES || now - Date.parse(lastBackupAt) >= REMIND_AFTER_DAYS * DAY_MS;
}

function renderBackupReminder() {
  const due = backupDue();
  backupBanner.hidden = !due;
  backupDot.hidden = !backupDue({ ignoreSnooze: true });
  backupOpenBtn.setAttribute("aria-label", backupDot.hidden ? "Backup and restore" : "Backup and restore (backup due)");
  if (!due) return;
  const { lastBackupAt, changes } = backupMeta;
  backupBannerMsg.textContent = isValidTime(lastBackupAt)
    ? `${plural(changes, "change")} since your last backup on ${shortDate(lastBackupAt)}. Download a fresh copy so nothing is lost if this browser's data is cleared.`
    : `Nothing here has been backed up yet. If this browser's data is cleared, your entries are gone. A backup file takes a second.`;
}

function renderBackupStatus() {
  const { lastBackupAt, changes } = backupMeta;
  if (!isValidTime(lastBackupAt)) {
    backupStatus.textContent = changes ? `No backup yet · ${plural(changes, "change")} not backed up.` : "No backup yet.";
  } else {
    backupStatus.textContent = `Last backup ${shortDate(lastBackupAt)} · `
      + (changes ? `${plural(changes, "change")} since then.` : "up to date.");
  }
  backupStatus.classList.toggle("due", backupDue({ ignoreSnooze: true }));
}

function snoozeBackup() {
  setBackupMeta({ snoozedUntil: new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString() });
  renderBackupReminder();
  backupOpenBtn.focus();
}

// ----- Export -----
function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const file = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      users, expenses, view, excluded: [...excluded],
      debts: loadJSON(DEBTS_KEY, []), debtPlans: loadJSON(DEBT_PLANS_KEY, {}),
    },
  };
  download(`finance-tracker-backup-${today()}.json`, JSON.stringify(file, null, 2), "application/json");
  // We can't see whether the file was saved, so starting the download counts as a backup
  setBackupMeta({ lastBackupAt: file.exportedAt, changes: 0, snoozedUntil: null });
  renderBackupReminder();
  renderBackupStatus();
}

// ----- Import: read and check a file -----
class ImportError extends Error {}
const NOT_A_BACKUP = "This file isn't a Finance Tracker backup.";

// Returns a cleaned copy of one entry, or null if it can't be used
function cleanEntry(e, userIds) {
  if (!e || typeof e !== "object") return null;
  const income = e.type === "income";
  const amount = Number(e.amount);
  const description = typeof e.description === "string" ? e.description.trim().slice(0, DESC_MAX) : "";
  const category = income ? INCOME
    : typeof e.category === "string" ? e.category.trim().replace(/\s+/g, " ").slice(0, CUSTOM_NAME_MAX) : "";

  if (!Number.isFinite(e.id)) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) return null;
  if (!isValidDay(e.date) || !description || !category || !userIds.has(e.userId)) return null;
  if (!income && category.toLowerCase() === INCOME.toLowerCase()) return null;

  const entry = { id: e.id, amount: Math.round(amount * 100) / 100, date: e.date, description, category };
  if (income) entry.type = "income";
  entry.userId = e.userId;
  return entry;
}

function parseBackup(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new ImportError(`${NOT_A_BACKUP} It isn't valid JSON.`);
  }
  if (!file || typeof file !== "object" || file.app !== BACKUP_APP || !file.data || typeof file.data !== "object") {
    throw new ImportError(NOT_A_BACKUP);
  }
  if (!Number.isInteger(file.schemaVersion) || file.schemaVersion < 1) throw new ImportError(NOT_A_BACKUP);
  if (file.schemaVersion > BACKUP_VERSION) {
    throw new ImportError("This backup was made by a newer version of Finance Tracker. Update the app, then try again.");
  }

  const {
    users: rawUsers, expenses: rawExpenses, view: rawView, excluded: rawExcluded,
    debts: rawDebts, debtPlans: rawPlans,
  } = file.data;
  if (!Array.isArray(rawUsers) || !Array.isArray(rawExpenses)) throw new ImportError(NOT_A_BACKUP);

  const people = [];
  const ids = new Set();
  const names = new Set();
  rawUsers.forEach((u) => {
    if (!u || typeof u.id !== "string" || !u.id || ids.has(u.id)) return;
    const name = typeof u.name === "string" ? cleanName(u.name) : "";
    if (!name || names.has(name.toLowerCase())) return;
    const color = typeof u.color === "string" && /^#[0-9a-f]{6}$/i.test(u.color)
      ? u.color : PERSON_COLORS[people.length % PERSON_COLORS.length];
    ids.add(u.id);
    names.add(name.toLowerCase());
    people.push({ id: u.id, name, color });
  });
  if (!people.length) throw new ImportError("This backup has no people in it, so there's nothing to restore.");

  const entries = [];
  const entryIds = new Set();
  let skipped = 0;
  rawExpenses.forEach((raw) => {
    const entry = cleanEntry(raw, ids);
    if (!entry || entryIds.has(entry.id)) { skipped++; return; }
    entryIds.add(entry.id);
    entries.push(entry);
  });

  // Debts and plans are checked by debt.js, which owns their shape
  const debts = [];
  const debtIds = new Set();
  (Array.isArray(rawDebts) ? rawDebts : []).forEach((raw) => {
    const debt = cleanDebt(raw, ids);
    if (!debt || debtIds.has(debt.id)) { skipped++; return; }
    debtIds.add(debt.id);
    debts.push(debt);
  });

  return {
    exportedAt: isValidTime(file.exportedAt) ? file.exportedAt : null,
    users: people,
    expenses: entries,
    debts,
    debtPlans: cleanPlans(rawPlans, ids),
    view: typeof rawView === "string" ? rawView : people[0].id,
    excluded: Array.isArray(rawExcluded) ? rawExcluded.filter((id) => typeof id === "string") : [],
    skipped,
  };
}

function describeBackup(b) {
  const lines = [`${plural(b.users.length, "person", "people")} · ${plural(b.expenses.length, "entry", "entries")}`
    + (b.debts.length ? ` · ${plural(b.debts.length, "debt")}` : "")];
  if (b.expenses.length) {
    const days = b.expenses.map((e) => e.date).sort();
    const first = formatMonth(days[0].slice(0, 7));
    const last = formatMonth(days[days.length - 1].slice(0, 7));
    lines[0] += ` · ${first === last ? first : `${first} – ${last}`}`;
  }
  if (b.exportedAt) lines.push(`Backed up ${new Date(b.exportedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`);
  if (b.skipped) lines.push(`${plural(b.skipped, "entry", "entries")} in the file ${b.skipped === 1 ? "is" : "are"} incomplete and will be skipped.`);
  return lines.join("\n");
}

// ----- Import: combine with what's here -----
// People match by id, then by name (ignoring case). Entries match by id; an entry
// with the same id and the same details is already here and is skipped.
function mergeBackup(b) {
  const nextUsers = users.map((u) => ({ ...u }));
  const userMap = new Map();
  let addedPeople = 0;
  b.users.forEach((u) => {
    const match = nextUsers.find((x) => x.id === u.id)
      || nextUsers.find((x) => x.name.toLowerCase() === u.name.toLowerCase());
    if (match) {
      userMap.set(u.id, match.id);
      return;
    }
    const used = new Set(nextUsers.map((x) => x.color));
    const color = used.has(u.color) ? PERSON_COLORS.find((c) => !used.has(c)) || u.color : u.color;
    nextUsers.push({ ...u, color });
    userMap.set(u.id, u.id);
    addedPeople++;
  });

  // Reuse this device's spelling of a category ("pets" → "Pets")
  const spelling = new Map([...CATEGORIES, ...customCategories()].map((c) => [c.toLowerCase(), c]));
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const same = (a, x) => a.date === x.date && a.amount === x.amount && a.description === x.description
    && a.category === x.category && (a.type || "") === (x.type || "") && a.userId === x.userId;
  let nextId = expenses.reduce((max, e) => Math.max(max, e.id), Date.now()) + 1;

  const nextExpenses = [...expenses];
  let added = 0;
  let duplicates = 0;
  b.expenses.forEach((e) => {
    const entry = { ...e, userId: userMap.get(e.userId) };
    if (!isIncome(entry)) entry.category = spelling.get(entry.category.toLowerCase()) || entry.category;
    const existing = byId.get(entry.id);
    if (existing && same(existing, entry)) { duplicates++; return; }
    if (existing) entry.id = nextId++; // a different entry that happens to share an id
    byId.set(entry.id, entry);
    nextExpenses.push(entry);
    added++;
  });

  // Debts match by id; plans for a view that has none here are added
  const nextDebts = loadJSON(DEBTS_KEY, []);
  const debtIds = new Set(nextDebts.map((d) => d.id));
  b.debts.forEach((d) => {
    if (debtIds.has(d.id)) return;
    nextDebts.push({ ...d, userId: userMap.get(d.userId) });
    added++;
  });
  const nextPlans = loadJSON(DEBT_PLANS_KEY, {});
  Object.entries(b.debtPlans).forEach(([key, plan]) => {
    const mapped = key === FAMILY ? key : userMap.get(key);
    if (mapped && !nextPlans[mapped]) nextPlans[mapped] = plan;
  });

  return {
    state: {
      users: nextUsers, expenses: nextExpenses, view, excluded: [...excluded],
      debts: nextDebts, debtPlans: nextPlans,
    },
    added, duplicates, addedPeople,
  };
}

// ----- Import: save -----
const STATE_KEYS = [STORAGE_KEY, USERS_KEY, VIEW_KEY, EXCLUDED_KEY, DEBTS_KEY, DEBT_PLANS_KEY];

function readRawState() {
  return Object.fromEntries(STATE_KEYS.map((k) => [k, localStorage.getItem(k)]));
}

function writeRawState(raw) {
  STATE_KEYS.forEach((k) => (raw[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, raw[k])));
}

// Reloads the in-memory state from storage and redraws
function reloadState() {
  expenses = loadExpenses();
  users = loadJSON(USERS_KEY, users);
  excluded = new Set(loadJSON(EXCLUDED_KEY, []));
  view = loadJSON(VIEW_KEY, users[0].id);
  normalizeView();
  saveView();
  document.dispatchEvent(new Event("app:reload")); // debt.js re-reads its keys
  setMonth(monthFilter.value, { push: false });
}

// Saves every key, or none: on failure the previous values are put back
function saveState(state) {
  const before = readRawState();
  try {
    writeRawState({
      [STORAGE_KEY]: JSON.stringify(state.expenses),
      [USERS_KEY]: JSON.stringify(state.users),
      [VIEW_KEY]: JSON.stringify(state.view),
      [EXCLUDED_KEY]: JSON.stringify(state.excluded),
      [DEBTS_KEY]: JSON.stringify(state.debts || []),
      [DEBT_PLANS_KEY]: JSON.stringify(state.debtPlans || {}),
    });
  } catch {
    try { writeRawState(before); } catch { /* nothing more we can do */ }
    throw new ImportError("Couldn't save. This browser's storage is full or blocked, so nothing was changed.");
  }
  return before;
}

// The state from before the last import. Undo is offered until the dialog closes,
// so it can't wipe entries added afterwards.
let undoImport = null;
let pendingImport = null;

function showImportError(message) {
  importErrorText.textContent = message;
  importError.hidden = !message;
}

function resetImport() {
  pendingImport = null;
  importPreview.hidden = true;
  importFile.value = "";
}

async function onImportFile() {
  const file = importFile.files[0];
  if (!file) return;
  resetImport();
  importDone.hidden = true;
  showImportError("");
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError("That file is too large to be a Finance Tracker backup.");
    pendingImport = parseBackup(await file.text());
  } catch (err) {
    showImportError(err instanceof ImportError ? err.message : "Couldn't read that file.");
    importChoose.focus();
    return;
  }
  importFileName.textContent = file.name;
  importSummary.textContent = describeBackup(pendingImport);
  importReplaceNote.textContent = expenses.length
    ? `Deletes the ${plural(expenses.length, "entry", "entries")} on this device and restores the file.`
    : "Restores the file onto this device.";
  backupDialog.querySelector('input[name="import-mode"][value="merge"]').checked = true;
  importPreview.hidden = false;
  importConfirm.focus();
}

function confirmImport() {
  if (!pendingImport) return;
  const mode = backupDialog.querySelector('input[name="import-mode"]:checked').value;
  const backup = pendingImport;
  const metaBefore = { ...backupMeta };
  let message;
  let changed = true;

  try {
    if (mode === "replace") {
      const { exportedAt, skipped, ...state } = backup;
      undoImport = { raw: saveState(state), meta: metaBefore };
      // This device now matches a backup file, so nothing is waiting to be backed up
      setBackupMeta({ changes: 0, snoozedUntil: null, lastBackupAt: exportedAt || backupMeta.lastBackupAt });
      message = `Restored ${plural(state.expenses.length, "entry", "entries")} and ${plural(state.users.length, "person", "people")}.`;
    } else {
      const result = mergeBackup(backup);
      changed = result.added + result.addedPeople > 0;
      if (changed) {
        undoImport = { raw: saveState(result.state), meta: metaBefore };
        noteChange(result.added + result.addedPeople);
        const parts = [plural(result.added, "entry", "entries")];
        if (result.addedPeople) parts.push(plural(result.addedPeople, "person", "people"));
        message = `Added ${parts.join(" and ")}.`
          + (result.duplicates ? ` ${plural(result.duplicates, "entry", "entries")} ${result.duplicates === 1 ? "was" : "were"} already here.` : "");
      } else {
        message = "Nothing new. Everything in this file is already here.";
      }
    }
  } catch (err) {
    showImportError(err instanceof ImportError ? err.message : "Something went wrong. Nothing was changed.");
    return;
  }

  resetImport();
  if (changed) reloadState();
  renderBackupStatus();
  importDoneText.textContent = message;
  importUndo.hidden = !changed;
  importDone.hidden = false;
  (changed ? importUndo : importChoose).focus();
}

function undoLastImport() {
  if (!undoImport) return;
  try {
    writeRawState(undoImport.raw);
  } catch {
    showImportError("Couldn't undo. This browser's storage is full or blocked.");
    return;
  }
  setBackupMeta(undoImport.meta);
  undoImport = null;
  reloadState();
  renderBackupStatus();
  importDone.hidden = true;
  showImportError("");
  importChoose.focus();
}

function openBackupDialog() {
  renderBackupStatus();
  showImportError("");
  resetImport();
  importDone.hidden = true;
  backupDialog.showModal();
}

backupOpenBtn.addEventListener("click", openBackupDialog);
document.getElementById("backup-dialog-close").addEventListener("click", () => backupDialog.close());
backupDialog.addEventListener("close", () => {
  undoImport = null;
  backupOpenBtn.focus();
});
document.getElementById("backup-export").addEventListener("click", exportBackup);
document.getElementById("backup-banner-export").addEventListener("click", () => {
  exportBackup();
  backupOpenBtn.focus();
});
document.getElementById("backup-banner-later").addEventListener("click", snoozeBackup);
importChoose.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", onImportFile);
importConfirm.addEventListener("click", confirmImport);
document.getElementById("import-cancel").addEventListener("click", () => {
  resetImport();
  importChoose.focus();
});
importUndo.addEventListener("click", undoLastImport);

// The save-failed banner stays until dismissed: a later save working doesn't bring back the lost one
document.getElementById("save-error-export").addEventListener("click", exportBackup);
document.getElementById("save-error-dismiss").addEventListener("click", () => {
  document.getElementById("save-error").hidden = true;
  backupOpenBtn.focus();
});

// ===== Other tabs =====
// Each tab keeps its data in memory and saves whole keys, so without this a second
// open tab would overwrite what the first one saved. The browser fires "storage" in
// every other tab when one tab writes; reload the data from it then.
// View, family selection and the open tab are per-window choices and stay as they are.
const SHARED_DATA_KEYS = [STORAGE_KEY, USERS_KEY, DEBTS_KEY, DEBT_PLANS_KEY];

window.addEventListener("storage", (e) => {
  if (e.storageArea !== localStorage) return;
  if (e.key === BACKUP_META_KEY) {
    backupMeta = loadBackupMeta();
    renderBackupReminder();
    return;
  }
  if (e.key !== null && !SHARED_DATA_KEYS.includes(e.key)) return; // null = storage was cleared

  expenses = loadExpenses();
  const storedUsers = loadJSON(USERS_KEY, null);
  if (Array.isArray(storedUsers) && storedUsers.length) users = storedUsers; // keep at least one person
  normalizeView();
  document.dispatchEvent(new Event("app:reload")); // debt.js re-reads its keys
  setMonth(monthFilter.value, { push: false });
  if (peopleDialog.open) renderManageList();
});

// ===== Init =====
form.addEventListener("submit", addExpense);
descInput.addEventListener("input", updateDescCount);
categoryInput.addEventListener("change", onCategoryChange);
typeBtns.forEach((btn) => btn.addEventListener("click", () => setEntryType(btn.dataset.type)));
setDate(today());

setMonth(monthFromHash() || currentMonth(), { push: false });
