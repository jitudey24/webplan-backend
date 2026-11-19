# AGENTS.md

WedPlan Server — Express 5 + MongoDB (Atlas) backend for a wedding-service marketplace.
ES Modules (`"type": "module"`), plain JavaScript, no TypeScript build. All relative
imports must include the `.js` extension.

## Entrypoint (only one is real)

- **`index.js` is the only entrypoint** (`npm start` / `npm run dev`).
- The old duplicate servers `server.js` and `routes/index.js` were removed during the
  CommonJS → ESM migration (both were broken and would have bound the same port).
- Actual route modules live in `src/routes/` and are mounted inside `index.js`
  (there is no `src/app.js`). Startup order matters:
  `connectDB()` → `initAuth(db, client)` → mount `/api/auth/*splat` → `express.json()`
  → `ensureIndexes(db)` → mount API routes → 404 + error handler.
  The Better Auth handler **must** precede `express.json()` (it parses its own body),
  and the path must stay Express 5 splat syntax: `app.all("/api/auth/*splat", ...)`.
- `README.md` is partly aspirational: its structure tree, endpoint tables, and env
  example don't match the code. Trust the code.

## Commands

```bash
npm run dev            # nodemon index.js (port 5000 or PORT)
npm start              # node index.js
npm run create-admin   # one-time admin from .env ADMIN_NAME/ADMIN_EMAIL/ADMIN_PASSWORD
npm run smoke-test     # ONLY test suite — needs a running server first
node scripts/sync-services.js   # seed/repair demo services (not in package.json scripts)
```

- **No lint, format, typecheck, or unit-test framework exists.** `npm test` is a
  placeholder that exits 1 — don't run it as verification.
- Verification = start the server, then `npm run smoke-test` (21 checks: auth, roles,
  services, bookings, JWT, Google OAuth). It **writes real users/services/bookings to
  the connected DB** — use a dev database. It requires `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  in `.env` and hard-asserts the DB name is `WedPlan`, so a custom `DB_NAME` fails it.

## Environment (`.env`, gitignored)

Required at startup (validated; server exits with a clear error if missing):

- `DB_URI`, `DB_USER`, `DB_PASSWORD` — `DB_URI` may be an Atlas template containing
  `<db_username>`/`<db_password>` placeholders (filled from user/password), a full
  credential-bearing URI, or a bare URI (credentials injected). `DB_NAME` defaults to `WedPlan`.
  **README's `MONGODB_URI` does not exist — the code uses `DB_URI`.**
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  — `BETTER_AUTH_SECRET` must differ from `GOOGLE_CLIENT_SECRET` (explicitly rejected).
- `FRONTEND_URL` (CORS + trusted origin; frontend runs on `http://localhost:3000`).

Optional: `PORT`, `STRIPE_SECRET_KEY` (subscription routes return 503 without it),
`ADMIN_NAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD` (scripts only).

## Auth & authorization

- Better Auth runs on the **shared** Mongo connection (`src/lib/auth.js` → `initAuth`);
  never create a second `MongoClient`. Singleton — `initAuth` ignores later args.
- Roles: `customer` (default) | `vendor` | `admin`. Roles and `vendorApproved` are
  **always read from the DB** in `src/middleware/auth.js`, never from the request body.
  Sensitive user fields are declared `input: false` in `src/lib/auth.js` so clients
  cannot set them (mass-assignment protection) — keep that pattern for new fields.
- Middleware exports (arrays, spread into routes): `requireAuth`, `requireCustomer`,
  `requireVendor` (role + `vendorApproved === true`), `requireAdmin`.
  Vendors must be admin-approved or every vendor route 403s.
- Sessions (cookies) are preferred; Bearer JWTs are verified via JWKS at
  `BETTER_AUTH_URL/api/auth/jwks` — so `BETTER_AUTH_URL` must point at this server.
- First admin only via `npm run create-admin` (Better Auth server API), not via any HTTP route.

## Data quirks

- Collections: `user`, `session`, `account` (Better Auth-managed), plus `services`,
  `bookings`, `planner`. Indexes created at boot in `src/config/indexes.js`.
- **ID mismatch is the #1 bug source**: Better Auth stores user `_id` as `ObjectId`
  (exposed as string `id`), while `services.vendorId` / `bookings.customerId` store
  **plain strings**. Always convert with `toId()` (`src/utils/helpers.js`) and follow
  the existing `$or: [{ _id: toId(x) }, { id: x }]` query pattern when touching `user`.
- Demo services seeded by `scripts/sync-services.js` use **string** `_id`s
  (e.g. `"venue-rosewood"`), so service `_id` is not always an ObjectId.
- API responses use `{ success, message, ... }`; return users through `sanitizeUser`.

## Business rules to preserve

- Free plan: max **3 active services** (enforced in `src/routes/services.js`);
  Premium (`premium_monthly` / `premium_yearly`): unlimited. Premium is activated only
  after the server retrieves the Stripe session and confirms `payment_status === "paid"`
  with matching `metadata.vendorId` — never trust a client-supplied plan/session string.
- **No Stripe webhook is implemented** despite the README — activation is via
  `/api/v1/subscription/verify-stripe-session` and `/pay`.
- Don't pass `payment_method_types` to Stripe Checkout (Dashboard-managed; 400s).
- Services router is mounted twice: `/api/v1/services` **and** legacy `/services` —
  keep both in sync if you change mount-level behavior.
- Only approved vendors' available services appear in the public list;
  admin review endpoints live under `/api/v1/admin` (`requireAdmin`).
