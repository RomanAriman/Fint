# Finance Tracker — architecture review

**Date:** 2026-10-31 · **Scope:** spending, people/family, backup & restore, debt planner · **Reviewer:** Claude

**Verdict.** The design fits what the app is: a single-device tool with no account or server, opened straight from disk. The payoff engine is the strongest part — pure, fast, and tested against the spec. The two data-loss risks this review found (saves that fail silently, and two open tabs overwriting each other) were **fixed the same day**; see risks 1 and 2. What's left is mostly maintainability: two large files coupled through ~25 shared global names.

## The app today

| File | Lines | Role |
|---|---|---|
| `index.html` | 679 | All markup: Spending and Debt planner panels, three dialogs |
| `script.js` | 1,655 | Spending, date and month pickers, people and family view, backup & restore, shared helpers |
| `debt-engine.js` | 524 | Payoff simulation: pure functions, no DOM; runs in the browser and in Node |
| `debt.js` | 1,651 | Debt planner screens A–D, charts, calendar export |
| `style.css` / `debt.css` | 2,000 / 1,466 | Styles; shared tokens live in `style.css` |
| `tests/debt-engine.test.js` | 184 | 19 engine tests (`npm test`), including the spec's worked example |

All state is in the browser's `localStorage`, under eight keys: expenses, users, view, family exclusions, debts, debt plans, backup reminder state, and the open tab. Each file loads its keys once at start-up, keeps them in memory, and writes the whole key back on every change.

```
index.html ──loads──▶ script.js ──▶ debt-engine.js ──▶ debt.js
                         ▲   │                            │
                         │   └── "app:render" event ─────▶│ redraws the planner
                         └──── cleanDebt / cleanPlans ◀───┘ (used by restore)
             debt.js reads 25 globals from script.js (users, view, inView, loadJSON, noteChange, …)
```

## What works well

- **The engine is separate and tested.** One month-by-month simulation drives every screen. It reproduces the spec's worked example ($589.89 saved, break-even month 3, $4,500 left at promo end), with 19 tests in total.
- **It's fast enough not to matter.** Measured in Node:

  | Debts | One run | Promo-aware (both orders) | Transfer scenario | "Budget needed" search |
  |---|---|---|---|---|
  | 3 | 0.15 ms | 0.20 ms | 0.44 ms | 7.5 ms |
  | 15 | 0.18 ms | 1.48 ms | 3.18 ms | 47 ms |

  The search only runs when a plan never pays off.
- **Data is checked at the boundary.** `cleanEntry`, `cleanDebt` and `cleanPlans` validate on load and on restore, so a bad backup file can't put malformed data in storage.
- **Restore is all-or-nothing and can be undone.** It writes every key or puts the old values back, and an Undo is offered until the dialog closes.
- **Accessibility is built in.** Real buttons and labels, the ARIA tabs pattern with arrow keys, visible focus rings, and state that never relies on colour alone.

## Risks, most serious first

| # | Risk | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|
| 1 | ~~Saves fail silently~~ **Fixed 2026-10-31** | Was: `saveJSON` caught and ignored errors | Was: full or blocked storage lost changes with no warning | Every write now goes through `saveJSON`, which shows a "Your latest change wasn't saved" banner with a backup button. Tested with storage forced to fail | — |
| 2 | ~~Two open tabs overwrite each other~~ **Fixed 2026-10-31** | Was: no `storage` listener | Was: entries added in one tab disappeared when the other saved | Each tab reloads expenses, people, debts and plans when another tab writes them; the view and open tab stay per window. Tested with two tabs | — |
| 3 | **Data lives in one browser at one address** | `localStorage` is per origin; `file://` and a local server are separate stores. Safari may clear script-written storage for sites not visited in 7 days (verify on the browsers you use) | Clearing site data or switching browser loses everything since the last backup | Keep the backup reminder; consider auto-saving to a chosen file in Chrome/Edge; sync is a separate decision (see Open question) | S–L |
| 4 | **Files are coupled through globals** | `debt.js` reads 25 globals from `script.js`; `script.js` calls `cleanDebt`/`cleanPlans` from `debt.js`; load order matters | Renaming a helper in one file silently breaks the other | Group shared helpers under one namespace object (`window.App`), still as classic scripts | M |
| 5 | **Escaping by convention** | 29 `innerHTML` templates; every user string currently goes through `esc()`, `textContent` or `aria-label` (checked) | One missed `esc()` lets a name from an imported backup file run script | A small `html` tagged template that escapes by default, used for every template | S |
| 6 | **Tests stop at the engine** | Restore parsing and merging, migrations, people rules and the `clean*` checks live in DOM files with no tests | The riskiest data code (restore, migration) has no safety net | Move those pure functions into a DOM-free file like the engine, and test them under Node | M |
| 7 | **No storage schema version** | The `userId` backfill runs inline at start-up; there's no version marker per key | Each new migration adds more ad-hoc start-up code | One schema-version key and an ordered list of migrations | S |
| 8 | **Money is stored as floating-point dollars** | Rounding is spread across 8 places | Cent-level drift in long simulations or totals | Store integer cents the next time the schema changes | M |

## ADR-001: Stay build-step-free and local-first; add a store layer and one namespace

**Status:** Proposed · **Date:** 2026-10-31 · **Deciders:** Roman Surzhko

### Context
The app opens straight from disk (`file://`) with no build step or server, and is now about 8,000 lines across six files. Chrome refuses ES modules loaded from `file://`, so a move to `import`/`export` would also need a dev server or a bundler. Risks 1, 2 and 4 all come from state handling that's spread across both scripts.

### Decision
Keep classic scripts and `localStorage`. Add one small store, and a namespace for shared helpers:
- **One store** (`store.js`) owns every key. It handles load, save with a visible error on failure, schema migrations, and reloading when another tab changes storage.
- **One namespace object** (`App.store`, `App.people`, `App.format`) replaces the cross-file globals.
- **The pure checks** (`clean*`, backup parse and merge) move into a DOM-free file with Node tests, the way the engine already works.

### Options considered

**A. Leave as is**

| Dimension | Assessment |
|---|---|
| Complexity | Low now; grows with every feature |
| Cost | None now |
| Scalability | Poor: every new screen adds more shared globals |
| Fit with how you run it | Opens from disk, as today |

Pros: no work. Cons: risks 1 and 2 stay; coupling keeps growing.

**B. Store layer + namespace, classic scripts (recommended)**

| Dimension | Assessment |
|---|---|
| Complexity | Low–medium: about a day, file by file |
| Cost | No new tools or dependencies |
| Scalability | Good for this size: clear ownership of state |
| Fit with how you run it | Still opens from disk |

Pros: fixes risks 1, 2, 4 and 7 in one place; keeps the zero-setup workflow. Cons: no compiler or type checker; the namespace is a convention, not something the tooling enforces.

**C. ES modules with a bundler (Vite)**

| Dimension | Assessment |
|---|---|
| Complexity | Medium: build step, `npm install`, dev server |
| Cost | Toolchain to maintain |
| Scalability | Best: real imports, optional TypeScript |
| Fit with how you run it | Needs a build before it can run from disk |

Pros: enforced boundaries; type checking is possible. Cons: ends "just open `index.html`"; a big change for this size.

**D. Accounts and a sync server**

| Dimension | Assessment |
|---|---|
| Complexity | High: auth, API, hosting, conflict handling |
| Cost | Ongoing hosting and security work |
| Scalability | Multi-device and real shared family data |
| Fit with how you run it | A different product |

Pros: fixes risk 3; true multi-device families. Cons: outside today's scope (the spec says manual entry, no accounts); worth its own ADR if there's demand.

### Trade-off analysis
B buys most of C's safety (one owner for state, clear boundaries, testable pure code) without giving up the zero-setup workflow that sets the app's constraints. C is worth doing only once the app outgrows one person editing it, or if TypeScript becomes a goal. D answers a product question, not a code-quality one, so it shouldn't drive this decision.

### Consequences
- **Easier:** adding a screen, since state comes from one place; testing restore and migrations; adding a field to stored data safely.
- **Harder:** nothing much. Shared helpers just get a prefix (`App.format.money`).
- **To revisit:** C if the codebase passes roughly 15k lines or gets a second regular contributor; D if family members need the data on their own phones.

### Action items
1. [x] Route every write through one save path that shows an error on failure (risk 1).
2. [x] Reload state when another tab changes storage (risk 2).
3. [ ] Add `store.js` with a schema-version key; move the `userId` backfill into it as migration 1 (risk 7).
4. [ ] Move the `clean*` checks and backup parse/merge into a DOM-free file with Node tests (risk 6).
5. [ ] Put shared helpers under `window.App`, one file at a time (risk 4).
6. [ ] Add an escaping `html` tagged template and switch the existing templates to it (risk 5).
7. [ ] Next schema change: store money as integer cents (risk 8).

## Open question
Do family members need the data on their own devices? If yes, that's option D, and it changes the product (accounts, privacy, hosting). It's worth deciding before investing in further local-only features like the people and family view.
