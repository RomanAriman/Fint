# Finance Tracker

[![CI](https://github.com/RomanAriman/Fint/actions/workflows/ci.yml/badge.svg)](https://github.com/RomanAriman/Fint/actions/workflows/ci.yml)

A personal finance app that runs entirely in your browser: log spending and income, see where the month's money went, combine a household's numbers, and plan how to pay off credit card debt. There's no account and no server. Your data stays in the browser on this computer.

## Quick start

Open `index.html` in a browser (double-click it). That's it: no install and no build step.

To run the tests, you need [Node.js](https://nodejs.org) 22 or later:

```bash
npm test
```

## What it does

| Area | What you can do |
|---|---|
| **Spending** | Add expenses and income in seconds; pick the date with Today / Yesterday chips or a calendar; name your own categories; step through months or jump with the month picker |
| **Monthly summary** | Total spent, income − spent = left over, and a breakdown by category |
| **People & Family view** | Add people who share this device; each entry belongs to someone; Family view adds up the people you include, with a by-person breakdown |
| **Debt planner** | Four steps: **Where you stand** (what your debt costs each month), **Build scenarios** (balance transfer, 0% purchase card, payoff order, extra payment, consolidation loan), **Compare** (charts, table, payoff timeline), **Action plan** (steps, payments, calendar reminders, monthly balance updates) |
| **Backup & restore** | Download everything as one `.json` file; restore by adding to what's here or replacing it, with Undo |

The debt planner implements the Debt Strategy & Scenario Planner spec (kept outside this repo). Its results are estimates for education, not financial advice; the app shows the full disclaimers.

## Your data

Everything is saved in the browser's `localStorage`. Three things follow from that:

- **It belongs to one browser at one address.** Opening `index.html` from disk and opening it through a local server are two separate stores, and so are Chrome and Safari.
- **Clearing browsing data deletes it.** Keep backups: the download button is in the header, and the app reminds you when a backup is due.
- **Two open tabs stay in sync.** Each tab reloads when another one saves. If the browser ever refuses a save, a red banner says so and offers a backup.

| Key | Holds |
|---|---|
| `finance-tracker-expenses` | Expenses and income (`type: "income"`), each with a `userId` |
| `finance-tracker-users` | People: `{ id, name, color }` |
| `finance-tracker-debts` | Debts: balances and APRs, limit, minimum-payment rule, promo, due day |
| `finance-tracker-debt-plans` | Per person (or `family`): budget, up to 3 scenarios, the active plan |
| `finance-tracker-view`, `finance-tracker-family-excluded` | Whose money you're looking at, and who's left out of Family |
| `finance-tracker-backup`, `finance-tracker-tab` | Backup reminder state, and the open tab |

A backup file is `{ app, schemaVersion: 1, exportedAt, data: { users, expenses, view, excluded, debts, debtPlans } }`. `debts` and `debtPlans` are optional, so backups made before the debt planner still restore.

## Project layout

```
index.html          All markup: Spending and Debt planner panels, dialogs
style.css           Design tokens and the Spending / people / backup styles
script.js           Spending, pickers, people & family, backup & restore, shared helpers
debt-engine.js      Payoff simulation: pure functions, no DOM (browser + Node)
debt.js             Debt planner screens, charts, calendar (.ics) export
debt.css            Debt planner styles
tests/              Node tests for the engine (19, including the spec's worked example)
docs/               Architecture review and ADR-001
```

### How the pieces fit

- **Load order matters.** The scripts are plain (not modules), loaded in this order: `script.js` → `debt-engine.js` → `debt.js`. `debt.js` uses helpers and state that `script.js` defines globally (`users`, `view`, `inView`, `saveJSON`, `noteChange`, …). They stay plain scripts on purpose: Chrome won't load ES modules from a file opened from disk. See [ADR-001](docs/architecture-review.md#adr-001-stay-build-step-free-and-local-first-add-a-store-layer-and-one-namespace).
- **`script.js` tells the planner to redraw.** Its `render()` fires an `app:render` event after every change, and the debt planner redraws for the current view. After a restore, or a change from another tab, it fires `app:reload` and the planner re-reads its keys.
- **All the money math is in `debt-engine.js`.** `simulate()` runs one debt plan month by month (up to 600 months); `applyMove()` turns a scenario into changed debts and options; `summarize()` produces net savings, break-even month, peak utilization and the other comparison figures. The engine has no access to the page, so it can be tested directly under Node.

## Making changes

- **Adding a stored field:** update the matching clean-up function (`cleanEntry` in `script.js`; `cleanDebt`, `cleanMove` and `cleanPlan` in `debt.js`), or it will be dropped on load and on restore.
- **Changing the payoff math:** add a test in `tests/debt-engine.test.js` first, and keep the worked-example tests passing. They pin the spec's numbers: $589.89 saved, break-even in month 3, $4,500 left when the promo ends.
- **Putting text on the page:** anything a person typed (names, descriptions) must go through `textContent` or `esc()` before it reaches `innerHTML`.
- **Previewing through a local server:**

  ```bash
  python3 -m http.server 8766 --bind 127.0.0.1
  ```

  Then open http://127.0.0.1:8766. This address has its own separate data.

## Security

- **No secrets, no configuration.** There's no server, API key or environment variable, so the repo has no `.env` file and doesn't need one.
- **Your data never leaves the browser.** Never commit an exported backup (`finance-tracker-backup*.json`): it holds real financial data. `.gitignore` excludes the default file name.

## Contributing

- `main` always works. Branch off it with `feat/…`, `fix/…`, `docs/…` or `chore/…`, open a pull request, and squash-merge once CI is green.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(debt): …`, `fix: …`).
- CI runs `npm test` on Node 22, 24 and 26 for every push to `main` and every pull request.

## Known limitations

- No sync between devices or browsers. Backups are the only way to move data.
- Debt results assume fixed APRs, on-time payments and monthly compounding (APR ÷ 12).
- USD only.

Open design questions and the remaining clean-up items are in [docs/architecture-review.md](docs/architecture-review.md).
