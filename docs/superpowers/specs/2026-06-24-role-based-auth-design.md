# Role-Based Authentication with Better Auth — Design Spec

**Date:** 2026-06-24
**Status:** Draft, awaiting user approval
**Scope:** Single implementation plan

## Purpose

Add role-based authentication to the existing Next.js 16 + Prisma 7 + PostgreSQL
template. Users are either `candidate` (default) or `employer`. Employers get a
companion `Employer` row carrying a single distinguishing field (`companyName`).
Better Auth handles credential storage, sessions, and the `/api/auth/*` surface.
The implementation also ships two reusable guards — `requireAuth` and
`requireRole` — and three mock GET endpoints that exercise them, so the team
has a working reference for future role-locked routes.

## Decisions Locked During Brainstorming

| Decision | Choice |
|---|---|
| Differentiator field on Employer | `companyName` |
| Employer relation to User | Separate 1-to-1 table |
| Role assigned at sign-up | In the sign-up body, Employer row created in a post-create hook |
| Mock endpoints to ship | `/api/me`, `/api/candidate/profile`, `/api/employer/profile` (read-only) |
| Sign-in methods | Email + password only |
| Role guard style | Two composable helpers: `requireAuth` and `requireRole` |

## Data Model

`prisma/schema.prisma` is extended. `UserRole` is a new enum. The `User` model
gains a `role` column with default `candidate`. A new `Employer` model has a
1-to-1 relation to `User` and a required `companyName`. The standard Better
Auth tables (`Session`, `Account`, `Verification`) are appended by the Better
Auth CLI and the `User` model gains the `emailVerified` and `image` columns
the CLI requires.

```prisma
enum UserRole {
  candidate
  employer
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  emailVerified Boolean   @default(false)
  image         String?
  role          UserRole  @default(candidate)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  employer      Employer?
  sessions      Session[]
  accounts      Account[]

  @@map("user")
}

model Employer {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyName String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("employer")
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@map("verification")
}
```

`role` is also registered with Better Auth through `user.additionalFields` so
it appears on the session user payload without an extra DB roundtrip in most
handlers.

## Module Layout

New files:

```
src/lib/auth.ts                          # Better Auth server config
src/lib/auth-client.ts                   # Better Auth React client
src/lib/auth-guard.ts                    # requireAuth, requireRole, HttpError
src/lib/with-auth-errors.ts              # Response wrapper
src/app/api/auth/[...all]/route.ts       # Better Auth catch-all
src/app/api/me/route.ts                  # any authenticated user
src/app/api/candidate/profile/route.ts   # candidate-only
src/app/api/employer/profile/route.ts    # employer-only
```

Modified files:

```
prisma/schema.prisma        # schema additions
prisma/seed.ts              # seed a candidate and an employer
.env                        # + BETTER_AUTH_SECRET, + BETTER_AUTH_URL
package.json                # + better-auth
```

`src/app/page.tsx` and the rest of the UI are not modified. The starter page
keeps working since `User` retains the fields it already exposes.

## Better Auth Server Config

`src/lib/auth.ts` exports `auth` (the `betterAuth()` instance). The
`/api/auth/[...all]/route.ts` catch-all exposes every Better Auth endpoint
using the stock configurations — we do **not** add a custom route handler for
sign-up. Key points (verified against current Better Auth docs):

- `database: prismaAdapter(prisma, { provider: "postgresql" })` from
  `better-auth/adapters/prisma`. The `PrismaClient` is imported from the
  project's existing generator output: `from "../generated/prisma/client"`
  (relative to `src/lib/auth.ts`). Prisma 7 requires the explicit `output`
  path in `schema.prisma` and the corresponding import — `@prisma/client`
  no longer works for projects using `prisma-client` generator.
- `emailAndPassword: { enabled: true }`.
- `user.additionalFields.role`:
  - `type: ["candidate", "employer"]` — the array form is Better Auth's
    enum support; the value is constrained to one of the listed strings at
    the Better Auth layer (in addition to the `UserRole` DB enum).
  - `defaultValue: "candidate"` — JS-layer default applied when the client
    omits `role` on sign-up. (The Prisma `@default(candidate)` is the
    DB-layer default; both work together.)
  - `required: false`.
  - `input` left at its default of `true` so the client can set it on
    sign-up.
- `databaseHooks.user.create.before` — signature is
  `(user, ctx) => Promise<{data} | void>`:
  - The `user` argument is the prepared user data and already contains
    `role` (because `role` is an `additionalField`). We validate it
    directly on `user.role`.
  - `companyName` is **not** in `additionalFields`, so it's not in `user`.
    We read it from `ctx.body` — the parsed request body. The
    `signUpEmail` body schema is `z.object({...}).and(z.record(z.string(), z.any()))`,
    so unknown fields like `companyName` are accepted and reach the hook.
  - Normalises `role`: if missing, default to `"candidate"`; if not in
    `{ "candidate", "employer" }`, throw
    `new APIError("BAD_REQUEST", { message: "Invalid role" })`.
  - If `role === "employer"`, requires non-empty `companyName`. Otherwise
    throw
    `new APIError("BAD_REQUEST", { message: "companyName is required for employer sign-up" })`.
  - Stashes `companyName` in a module-scoped
    `WeakMap<Request, string>` keyed by `ctx.request` so the `after` hook
    can read it. The `Request` object is stable across the `before` and
    `after` hooks for a single sign-up; the entry is garbage-collected
    when the request finishes.
- `databaseHooks.user.create.after` — signature is `(user, ctx) => Promise<void>`:
  - `user` is the created user (has `.id` and `.role`).
  - If `user.role === "employer"`, looks up the stashed `companyName` via
    `companyNameByRequest.get(ctx.request)` and calls
    `prisma.employer.create({ data: { userId: user.id, companyName } })`.
  - If the create throws, Better Auth surfaces a 500. Acceptable for the
    demo.
- **APIError import:** `import { APIError } from "better-auth/api";` — the
  first arg is a string status code (`"BAD_REQUEST"`, `"UNAUTHORIZED"`,
  `"FORBIDDEN"`, etc.), not a number.
- **React client (`src/lib/auth-client.ts`):**
  `createAuthClient` from `better-auth/react` with
  `baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL`. Exports
  `authClient` with `signUp`, `signIn`, `signOut`, `useSession`, `getSession`.
- **Catch-all route (`src/app/api/auth/[...all]/route.ts`):**
  `import { toNextJsHandler } from "better-auth/next-js";`
  `export const { POST, GET } = toNextJsHandler(auth);` — note the handler
  is created from the `auth` instance, not `auth.handler`.

**Why no custom sign-up route:** Better Auth's stock `signUpEmail` endpoint
already accepts a body that includes `additionalFields`; the
`z.record(z.string(), z.any())` part of the body schema means extra fields
like `companyName` reach `ctx.body` unchanged. A custom route would
conflict with the `[...all]` catch-all and add surface area for no benefit.

**Alternative considered (rejected):** passing `companyName` via
`additionalFields` so it lands on `User`. Rejected because the field
belongs on `Employer`, not `User`, and forcing it onto `User` would create
a redundant nullable column.

## Guards

`src/lib/auth-guard.ts`:

```ts
import { headers } from "next/headers";
import { auth } from "./auth";
import type { UserRole } from "../generated/prisma/enums";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Unauthenticated");
  return session;
}

export async function requireRole(allowed: UserRole[]) {
  const session = await requireAuth();
  if (!allowed.includes(session.user.role as UserRole)) {
    throw new HttpError(403, "Forbidden");
  }
  return session;
}
```

`requireRole` composes `requireAuth` so callers never need to call both. The
return type carries the full `session` so handlers can read `session.user.id`,
`email`, `name`, `role` directly.

`src/lib/with-auth-errors.ts`:

```ts
import { HttpError } from "./auth-guard";

export function withAuthErrors<T extends (...a: any[]) => Promise<Response>>(h: T): T {
  return (async (...args) => {
    try {
      return await h(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        return Response.json({ message: e.message }, { status: e.status });
      }
      console.error(e);
      return Response.json({ message: "Internal server error" }, { status: 500 });
    }
  }) as T;
}
```

## Mock Endpoints

| Method & Path | Guard | Response body |
|---|---|---|
| `GET /api/me` | `requireAuth()` | `{ id, email, name, role }` from session |
| `GET /api/candidate/profile` | `requireRole(["candidate"])` | `{ id, email, name, role: "candidate" }` |
| `GET /api/employer/profile` | `requireRole(["employer"])` | `{ id, email, name, role: "employer", companyName }` (joins `Employer` by `userId`) |

The employer handler does one extra Prisma read (`prisma.employer.findUnique`)
to surface `companyName`. If that becomes a hot path later, we can promote
`companyName` to an `additionalField` on the session.

## Sign-up Body

```
POST /api/auth/sign-up/email
{
  "email": "ada@lovelace.io",
  "password": "supersecret",
  "name": "Ada Lovelace",
  "role": "employer",
  "companyName": "Analytical Engines Ltd"
}
```

Validation rules:

- `role` must be `"candidate"` or `"employer"`. Absent → default `"candidate"`.
- If `role === "employer"`, `companyName` must be a non-empty string. Otherwise
  the route returns `400 { message: "companyName is required for employer sign-up" }`.

## Environment Variables

Add to `.env` (the existing `DATABASE_URL` line is kept):

```
BETTER_AUTH_SECRET=<32+ char base64>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
```

`BETTER_AUTH_SECRET` is generated once with `openssl rand -base64 32` and
committed to `.env` (the file is gitignored). The two `BETTER_AUTH_URL`
values match the Next dev server.

## Order of Operations

1. `npm install better-auth`.
2. Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`
   to `.env`.
3. Update `prisma/schema.prisma` with `UserRole`, the `role` field on `User`,
   and the `Employer` model.
4. Run `npx @better-auth/cli@latest generate --output prisma/schema.prisma`
   to append `Session`, `Account`, `Verification`, `emailVerified`, `image`.
5. Run `npm run db:migrate -- --name role_based_auth` to apply the migration.
6. Write `src/lib/auth.ts`, `src/lib/auth-client.ts`, the auth catch-all
   route handler, the two guards, the error wrapper, and the three mock
   endpoints. No custom sign-up route — Better Auth's stock `signUpEmail`
   is used and extended via `additionalFields` + `databaseHooks`.
7. Update `prisma/seed.ts` to upsert one candidate (`alice@prisma.io`) and
   one employer (`bob@prisma.io` with `companyName: "Prisma Inc"`).
8. Run `npm run db:seed`.
9. Run `npm run dev` and execute the verification matrix below.

## Verification Matrix

Manual curl checks (no test framework in this project). All assume the dev
server is running on `http://localhost:3000`.

| # | Request | Expected |
|---|---|---|
| 1 | `POST /api/auth/sign-up/email` `{ email, password, name, role: "candidate" }` | `200`, `User` row created with `role=candidate`, no `Employer` row |
| 2 | `POST /api/auth/sign-up/email` `{ email, password, name, role: "employer", companyName: "Acme" }` | `200`, `User` row with `role=employer` AND `Employer` row with `companyName="Acme"` |
| 3 | `POST /api/auth/sign-up/email` `{ email, password, name, role: "employer" }` (no `companyName`) | `400 { message: "companyName is required for employer sign-up" }` |
| 4 | `POST /api/auth/sign-up/email` `{ email: "dup@x.io", ... }` twice | First `200`, second `422` (Better Auth's "USER_ALREADY_EXISTS" — verified from the `signUpEmail` source) |
| 5 | `GET /api/me` without cookie | `401 { message: "Unauthenticated" }` |
| 6 | `GET /api/me` as candidate (cookie from #1) | `200 { id, email, name, role: "candidate" }` |
| 7 | `GET /api/candidate/profile` as candidate | `200` |
| 8 | `GET /api/candidate/profile` as employer (cookie from #2) | `403 { message: "Forbidden" }` |
| 9 | `GET /api/employer/profile` as employer | `200 { ..., companyName: "Acme" }` |
| 10 | `GET /api/employer/profile` as candidate | `403 { message: "Forbidden" }` |
| 11 | `POST /api/auth/sign-in/email` with valid candidate creds, then `GET /api/me` | `200` with the candidate's session |
| 12 | `POST /api/auth/sign-out` (with cookie) then `GET /api/me` | `401` |

`GET /api/auth/ok` (Better Auth health) returns `{ status: "ok" }` after step 6.

## Out of Scope (YAGNI)

- Email verification, password reset, OAuth, 2FA, magic links, passkeys.
- Admin role and admin-only endpoints.
- Sign-out / session revocation demo endpoints beyond the stock Better Auth
  flow.
- Frontend sign-in / sign-up / dashboard UI pages. The API surface is the
  deliverable; UI is separate work.
- Updating `src/app/page.tsx` — the starter page keeps working.
- Test framework setup and automated tests — manual curl is the verification
  step for this change.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `additionalFields.role` defaults vs Better Auth's required `email` + `name` | Better Auth's stock `signUpEmail` body schema already enforces non-empty `name`, `email`, and `password` before the `before` hook runs. We don't need a custom wrapper. |
| `databaseHooks` don't see the sign-up body | The `before` hook reads `ctx.body` directly (Better Auth parses the body before hooks run, and the `signUpEmail` schema is open to extra fields via `z.record(z.string(), z.any())`). `companyName` is then stashed on the `ctx` object so the `after` hook can read it. |
| `additionalFields.role` rejected by the `UserRole` DB enum | The hook's `type: ["candidate", "employer"]` is the enum form and matches the Prisma `UserRole` enum exactly, so the JS-layer validator and the DB-layer enum agree. |
| `companyName` stored without a corresponding `User` row on race conditions | `prisma.employer.create` is inside `databaseHooks.user.create.after`, so it runs only after the user insert succeeds inside the same adapter call. If it throws, Better Auth will surface a 500. Acceptable for the demo. |
| `UserRole` enum conflict with Prisma generator output | The enum is declared in our schema before the CLI runs. The CLI only adds new models/columns; it won't touch the enum. |
| Migration drift on existing local DBs | This project is a fresh template; existing data is seed-only. Drop and re-migrate if any prior migration is in a bad state. |
