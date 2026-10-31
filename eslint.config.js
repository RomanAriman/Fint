// The app is three classic scripts sharing globals (see ADR-001), so the names each
// file borrows from another are listed here. A rename in one file then fails lint.
const js = require("@eslint/js");
const globals = require("globals");

const fromScript = [
  "currency", "compactCurrency", "currentMonth", "addMonths", "isValidMonth", "parseISO", "today", "DAY_MS", "pad",
  "FAMILY", "users", "view", "isFamily", "inView", "userById", "familyMembers",
  "loadJSON", "saveJSON", "noteChange", "download", "CLOSE_ICON", "DEBTS_KEY", "DEBT_PLANS_KEY",
];
const fromDebt = ["cleanDebt", "cleanPlans"];
const readonly = (names) => Object.fromEntries(names.map((n) => [n, "readonly"]));

module.exports = [
  { ignores: ["node_modules/"] },
  js.configs.recommended,
  {
    rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  {
    files: ["script.js", "debt.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, DebtEngine: "readonly" } },
  },
  { files: ["script.js"], languageOptions: { globals: readonly(fromDebt) } },
  { files: ["debt.js"], languageOptions: { globals: readonly(fromScript) } },
  {
    files: ["debt-engine.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, module: "readonly" } },
  },
  {
    files: ["eslint.config.js", "tests/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
];
