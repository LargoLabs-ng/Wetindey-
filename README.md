# Wetin Dey

University event discovery and ticketing for the Nigerian campus market.

Students find what's happening around them; organisers sell tickets, take money
out, and run the door. Ticketing is the infrastructure — the product is the
discovery and community layer on top of it.

Formerly "Ticket Buddy"; you will still find that name in older commits and in
one or two asset filenames.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind v4 |
| Database | Neon Postgres via Drizzle ORM |
| Auth | Auth.js v5 (beta), JWT sessions, credentials + Google |
| Payments | Paystack |
| Email | Resend (or SMTP/SendGrid — see `EMAIL_PROVIDER`) |
| File storage | Vercel Blob |
| Tests | Vitest |

Route params are `Promise<{...}>` — this is Next 16, not 15.

---

## Running it

```bash
npm install
cp .env.example .env.local   # then fill it in — see below
npm run dev
```

### Environment

`.env.local` is gitignored and has never been committed. You need your own.

**Required to boot:**

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `AUTH_SECRET` | Any long random string (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` in dev; the real origin in production |

**Required for the parts that matter:**

| Variable | What breaks without it |
|---|---|
| `PAYSTACK_SECRET_KEY` | Checkout. Use a test key in dev |
| `RESEND_API_KEY` + `EMAIL_FROM` | Tickets, QR codes, all notifications |
| `BLOB_READ_WRITE_TOKEN` | Image uploads (cover art, logos, sponsors) |
| `ADMIN_EMAILS` | Comma-separated. Who can reach `/admin` |

**Optional:** `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (Google sign-in),
`NEXT_PUBLIC_SUPPORT_EMAIL`, `EMAIL_PROVIDER` with `SMTP_*` or
`SENDGRID_API_KEY` if you'd rather not use Resend.

### Paystack webhook

Point it at `POST /api/webhooks/paystack`. Signature is verified with
HMAC-SHA512 against `PAYSTACK_SECRET_KEY`.

The webhook is **not** the only thing that completes a purchase. The buyer's
own return to the site calls the same `finalizeOrder()`, so a dropped or
delayed webhook doesn't leave somebody paid-but-ticketless. Both paths claim
the order with a conditional `UPDATE ... WHERE status = X RETURNING`, so
whichever arrives second is a no-op rather than a double-send.

---

## Migrations — read this before touching the database

**There is no `drizzle-kit migrate` or `push` in this project, deliberately.**

`migrate` replays from a journal this repo doesn't keep (the early migrations
were applied by hand), and `push` diffs the live database against `schema.ts`
and decides for itself what to run. Neither is acceptable against a database
holding real orders.

Instead: migrations are **hand-written SQL** in `drizzle/`, applied one at a
time by a script that runs exactly the reviewed text and nothing else.

```bash
node apply-migration.mjs drizzle/0013_commission_snapshot.sql
```

Every migration is written to be safe to run twice — `IF NOT EXISTS`
throughout, `DO $$ ... EXCEPTION WHEN duplicate_object` around new enum types.

To find out what the database actually has:

```bash
node check-schema.mjs
```

It reads `information_schema`, writes nothing, and prints OK / NOT RUN /
PARTIAL per migration, naming the missing column or table and the command to
fix it. **Run it after pulling.** `tsc` passing only proves the code agrees
with `schema.ts`; it says nothing about what Postgres has.

When you add a migration, add its markers to the `EXPECT` list in
`check-schema.mjs`.

The SQL files carry the reasoning for each decision in comments. They are
worth reading before changing the tables they touch — several of them explain
a choice that looks wrong until you know what went wrong before it.

---

## Checks

```bash
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run lint
node check-schema.mjs
```

`next dev` transpiles without type-checking, so **a page rendering cleanly
proves syntax and nothing else.** Run `typecheck` before you believe anything.

---

## Where the real decisions live

Most of this codebase is ordinary. These files are not, and each one explains
itself at the top:

| File | Why it's worth reading |
|---|---|
| `src/lib/fees.ts` | Who pays what. Paystack's gross-up is reverse-solved so the page and the charge always agree; verified against a live test charge |
| `src/lib/permissions.ts` | Four assignable roles plus an orthogonal "can see the money" switch, and why it isn't six roles |
| `src/lib/earnings.ts` | The single source of truth for what an organisation is owed. Documents one known simplification in the organiser's favour |
| `src/lib/registration.ts` | Custom checkout questions. Built around "a bad answer must never cost a sale that isn't the buyer's fault" |
| `src/lib/notify-change.ts` | What counts as a change worth emailing ticket-holders about — and why a provisional date never leaks into an inbox |
| `src/lib/promo.ts` | Discount vs refer-to-earn: identical at checkout, opposite in the ledger |
| `src/lib/media.ts` | YouTube URL parsing, and `isSafeHttpUrl` — the check that `z.string().url()` is not |
| `src/lib/cancel-event.ts` | Split in two on purpose: telling people is urgent and reversible, moving money is neither |
| `src/app/globals.css` | The theming. CSS custom properties resolve where **declared**, not where used — the `.wd-night` block re-declares the compat names for that reason |

### Two conventions worth knowing

**Snapshot, don't join, for anything that records what happened.** A payout
copies the bank details it was requested against. A registration answer copies
the question label it was asked under. An order stores the discount and
commission in naira. In every case the configuration can change tomorrow and
the record must not change with it.

**URLs are scheme-checked, not just parse-checked.** `z.string().url()`
accepts `javascript:alert(1)`. Every URL field goes through `isSafeHttpUrl`
on the way in, and every render site calls `safeHttpUrl()` on the way out.

---

## What isn't built

Stated plainly so nobody discovers it in production:

- **Payouts don't move money.** A withdrawal request queues a row for a human
  to action. There is no bank transfer integration.
- **Promoter commissions are a record, not a payment.** The codes screen shows
  what an organiser owes; it is not deducted from their balance and we do not
  pay promoters.
- **Refunds retained on a buyer's change of mind** aren't deducted in
  `earnings.ts` — about ₦125 on a ₦5,000 ticket, always in the organiser's
  favour. Doing it properly needs a `kind` column on `refunds`. Documented
  in-file.
- **A provisional date is real data nobody is meant to see.** Anything that
  displays a date must check `dateTbd` first. Three places do: the event page,
  the cards, and the change-notification email.
- **`organizations.fee_percent`** exists in the schema and nothing reads it.
  `PLATFORM_FEE_RATE` in `src/lib/fees.ts` is the only source of truth. Wire
  one up or drop the other; don't add a third.
