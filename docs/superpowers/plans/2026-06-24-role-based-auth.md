# Role-Based Authentication with Better Auth Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-based authentication (candidate/employer) to the Next.js + Prisma template using Better Auth, with two reusable guards and three mock role-locked endpoints.

**Architecture:** Extend the Prisma schema with a `UserRole` enum and a 1-to-1 `Employer` table. Use Better Auth's `prismaAdapter` + `additionalFields.role` for the `User.role` column, and `databaseHooks.user.create.{before,after}` to validate the sign-up body and create the `Employer` row when role=employer. Expose a Next.js catch-all for `/api/auth/*`. Provide `requireAuth` and `requireRole` guards used by three mock GET endpoints.

**Tech Stack:** Next.js 16 (App Router), TypeScript ESM, Prisma 7 (prisma-client generator, `PrismaPg` driver adapter), PostgreSQL, Better Auth (latest).

---

## Prerequisites

- [ ] **Step 1: Confirm Postgres is running**

```powershell
docker compose ps
```

Expected: `next-auth-template-postgres` shows `running` / `Up`. If not:

```powershell
docker compose up -d
```

- [ ] **Step 2: Confirm `.env` has `DATABASE_URL`**

```powershell
Get-Content .env
```

Expected line present: `DATABASE_URL="postgresql://johndoe:randompassword@localhost:5432/mydb?schema=public"`

- [ ] **Step 3: Confirm Prisma client is generated**

```powershell
Test-Path src/generated/prisma/client
```

Expected: `True`. If `False`, run:

```powershell
npm run db:generate
```

---

## Task 1: Install Better Auth and Configure Environment

**Files:**
- Modify: `package.json` (auto-updated by npm)
- Modify: `.env`

- [ ] **Step 1: Install `better-auth`**

```powershell
npm install better-auth
```

Expected: package added to `dependencies` in `package.json`; no errors.

- [ ] **Step 2: Generate a Better Auth secret**

```powershell
$secret = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
Write-Output $secret
```

Copy the printed value (a 44-char base64 string).

- [ ] **Step 3: Append the three env vars to `.env`**

Open `.env` and append (paste the secret from Step 2):

```
BETTER_AUTH_SECRET=<paste secret from step 2>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
```

Final `.env` contents should be:

```
# Added by create-prisma
DATABASE_URL="postgresql://johndoe:randompassword@localhost:5432/mydb?schema=public"
BETTER_AUTH_SECRET=<44-char base64>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
```

- [ ] **Step 4: Verify env loads**

```powershell
node -e "require('dotenv').config(); console.log('SECRET_LEN=', process.env.BETTER_AUTH_SECRET.length, 'URL=', process.env.BETTER_AUTH_URL)"
```

Expected output: `SECRET_LEN= 44 URL= http://localhost:3000`

---

## Task 2: Write the Full Prisma Schema (User, Employer, Better Auth tables)

**Files:**
- Modify: `prisma/schema.prisma`

> **Why we write the schema manually instead of using the Better Auth CLI:** the CLI's `generate` command OVERWRITES the target file with a complete schema it builds from the auth config. It would clobber our `UserRole` enum, `role` field, and `Employer` model. It also defaults to the legacy `prisma-client-js` generator (we use Prisma 7's `prisma-client`) and uses `String @id` without `cuid` (we use `cuid`). Writing the full schema directly is more reliable and lets us keep our conventions.

- [ ] **Step 1: Replace the schema file with the new content**

Overwrite `prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum UserRole {
  candidate
  employer
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  emailVerified Boolean  @default(false)
  image         String?
  role          UserRole @default(candidate)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  employer Employer?
  sessions Session[]
  accounts Account[]
}

model Employer {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyName String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
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

  @@index([userId])
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

  @@index([userId])
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime  @updatedAt

  @@index([identifier])
}
```

- [ ] **Step 2: Format the schema**

```powershell
npx prisma format
```

Expected: `Formatted prisma/schema.prisma` and Prisma may reorder fields (e.g., put the `@id` decoration on its own line). The logical content is the same.

- [ ] **Step 3: Validate the schema**

```powershell
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid 🚀`. If this fails, double-check the model definitions for typos.

- [ ] **Step 4: Generate the client**

```powershell
npm run db:generate
```

Expected: `Generated Prisma Client` and the directory `src/generated/prisma/` now contains `client.ts`, `enums.ts`, model files, and the `UserRole` enum export.

- [ ] **Step 5: Apply the migration**

```powershell
npx prisma migrate dev --name add_role_based_auth
```

Expected: `Migration successful` and a new folder `prisma/migrations/<timestamp>_add_role_based_auth/migration.sql` is created. The migration creates: `User` (with `emailVerified`, `image`, `role` columns), `Employer`, `Session`, `Account`, `Verification` tables.

- [ ] **Step 6: Verify the migration files**

```powershell
Get-ChildItem prisma/migrations
```

Expected: at least one migration folder named `*_add_role_based_auth`.

- [ ] **Step 7: Verify the database has all five tables**

```powershell
docker exec -it next-auth-template-postgres psql -U johndoe -d mydb -c "\dt"
```

Expected: tables listed include `User`, `Employer`, `Session`, `Account`, `Verification`.

---

## Task 3: Create Real Better Auth Server Config

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Create `src/lib/auth.ts`**

Create the file with this content:

```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { prisma } from "./prisma";
import type { UserRole } from "../generated/prisma/enums";

const VALID_ROLES: UserRole[] = ["candidate", "employer"];

// Request-scoped carrier for companyName. Keyed by the Request object so the
// entry is garbage-collected when the request finishes. Both the `before`
// and `after` database hooks for the same sign-up receive the same Request
// instance, so this is safe.
const companyNameByRequest = new WeakMap<Request, string>();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: ["candidate", "employer"],
        defaultValue: "candidate",
        required: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const body = (ctx?.body ?? {}) as {
            role?: string;
            companyName?: string;
          };
          const role: UserRole = VALID_ROLES.includes(body.role as UserRole)
            ? (body.role as UserRole)
            : "candidate";

          if (role === "employer" && (!body.companyName || !body.companyName.trim())) {
            throw new APIError("BAD_REQUEST", {
              message: "companyName is required for employer sign-up",
            });
          }

          if (ctx?.request && body.companyName) {
            companyNameByRequest.set(ctx.request, body.companyName.trim());
          }

          return {
            data: {
              ...user,
              role,
            },
          };
        },
        after: async (user, ctx) => {
          if (user.role === "employer" && ctx?.request) {
            const companyName = companyNameByRequest.get(ctx.request);
            if (companyName) {
              await prisma.employer.create({
                data: {
                  userId: user.id,
                  companyName,
                },
              });
            }
          }
        },
      },
    },
  },
});
```

- [ ] **Step 2: Create the catch-all route handler**

Create `src/app/api/auth/[...all]/route.ts` with this content:

```typescript
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { POST, GET } = toNextJsHandler(auth);
```

- [ ] **Step 3: Type-check**

```powershell
npx tsc --noEmit
```

Expected: no errors. If `UserRole` import path differs, check the actual file in `src/generated/prisma/` and adjust the import in `src/lib/auth.ts`.

- [ ] **Step 4: Lint**

```powershell
npm run lint
```

Expected: no errors. (Warnings about `_companyName` underscore prefix are acceptable; the underscore marks "intentionally unused" by convention.)

- [ ] **Step 5: Start the dev server (in a separate terminal) and verify health endpoint**

Terminal 1:

```powershell
npm run dev
```

Wait until you see `Ready` in the output.

Terminal 2:

```powershell
curl http://localhost:3000/api/auth/ok
```

Expected response body: `{"status":"ok"}` with HTTP 200.

If you see a 404, the catch-all route isn't being picked up — verify `src/app/api/auth/[...all]/route.ts` exists and the dev server picked up the new route (restart if needed).

---

## Task 4: Create the React Auth Client

**Files:**
- Create: `src/lib/auth-client.ts`

- [ ] **Step 1: Create the file**

Create `src/lib/auth-client.ts` with this content:

```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
});

export const { signUp, signIn, signOut, useSession, getSession } = authClient;
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

---

## Task 5: Create the Guards and Error Wrapper

**Files:**
- Create: `src/lib/auth-guard.ts`
- Create: `src/lib/with-auth-errors.ts`

- [ ] **Step 1: Create `src/lib/auth-guard.ts`**

Create the file with this content:

```typescript
import { headers } from "next/headers";
import { auth } from "./auth";
import type { UserRole } from "../generated/prisma/enums";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
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
  const role = session.user.role as UserRole;
  if (!allowed.includes(role)) {
    throw new HttpError(403, "Forbidden");
  }
  return session;
}
```

- [ ] **Step 2: Create `src/lib/with-auth-errors.ts`**

Create the file with this content:

```typescript
import { HttpError } from "./auth-guard";

export function withAuthErrors<T extends (...args: unknown[]) => Promise<Response>>(
  handler: T,
): T {
  return (async (...args: unknown[]) => {
    try {
      return await handler(...args);
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

- [ ] **Step 3: Type-check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Lint**

```powershell
npm run lint
```

Expected: no errors.

---

## Task 6: Create the Mock Role-Locked Endpoints

**Files:**
- Create: `src/app/api/me/route.ts`
- Create: `src/app/api/candidate/profile/route.ts`
- Create: `src/app/api/employer/profile/route.ts`

- [ ] **Step 1: Create `src/app/api/me/route.ts`**

Create the file with this content:

```typescript
import { requireAuth } from "@/lib/auth-guard";
import { withAuthErrors } from "@/lib/with-auth-errors";

export const GET = withAuthErrors(async () => {
  const { user } = await requireAuth();
  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
});
```

- [ ] **Step 2: Create `src/app/api/candidate/profile/route.ts`**

Create the file with this content:

```typescript
import { requireRole } from "@/lib/auth-guard";
import { withAuthErrors } from "@/lib/with-auth-errors";

export const GET = withAuthErrors(async () => {
  const { user } = await requireRole(["candidate"]);
  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: "candidate",
  });
});
```

- [ ] **Step 3: Create `src/app/api/employer/profile/route.ts`**

Create the file with this content:

```typescript
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { withAuthErrors } from "@/lib/with-auth-errors";

export const GET = withAuthErrors(async () => {
  const { user } = await requireRole(["employer"]);
  const employer = await prisma.employer.findUnique({
    where: { userId: user.id },
  });
  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: "employer",
    companyName: employer?.companyName ?? null,
  });
});
```

- [ ] **Step 4: Type-check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Lint**

```powershell
npm run lint
```

Expected: no errors.

- [ ] **Step 6: Verify route resolution (dev server already running from Task 3)**

```powershell
curl -i http://localhost:3000/api/me
```

Expected: HTTP 401 with body `{"message":"Unauthenticated"}` (no cookie sent).

---

## Task 7: Update the Seed Script

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Replace the seed file**

Overwrite `prisma/seed.ts` with:

```typescript
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { UserRole } from "../src/generated/prisma/enums";

const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main() {
  const candidate = await prisma.user.upsert({
    where: { email: "alice@prisma.io" },
    update: { name: "Alice" },
    create: {
      email: "alice@prisma.io",
      name: "Alice",
      role: UserRole.candidate,
    },
  });

  const employerUser = await prisma.user.upsert({
    where: { email: "bob@prisma.io" },
    update: { name: "Bob" },
    create: {
      email: "bob@prisma.io",
      name: "Bob",
      role: UserRole.employer,
    },
  });

  await prisma.employer.upsert({
    where: { userId: employerUser.id },
    update: { companyName: "Prisma Inc" },
    create: {
      userId: employerUser.id,
      companyName: "Prisma Inc",
    },
  });

  console.log(`Seeded candidate ${candidate.email} and employer ${employerUser.email}.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: Run the seed**

```powershell
npm run db:seed
```

Expected: `Seeded candidate alice@prisma.io and employer bob@prisma.io.`

- [ ] **Step 3: Verify in the database**

```powershell
docker exec -it next-auth-template-postgres psql -U johndoe -d mydb -c "SELECT email, role FROM \"User\";"
docker exec -it next-auth-template-postgres psql -U johndoe -d mydb -c "SELECT u.email, e.\"companyName\" FROM \"User\" u JOIN \"Employer\" e ON e.\"userId\" = u.id;"
```

Expected: two users (`alice@prisma.io` with `role=candidate`, `bob@prisma.io` with `role=employer`); the join shows Bob's company.

---

## Task 8: Run the Verification Matrix

All checks assume the dev server is running on `http://localhost:3000`. Restart it if you haven't already:

```powershell
npm run dev
```

Open a second terminal for the curl calls. Save cookies between requests using cookie jar files:

```powershell
$candidateJar = (New-TemporaryFile).FullName
$employerJar = (New-TemporaryFile).FullName
```

> **PowerShell note:** in all curl examples below, the JSON body is wrapped in **single quotes** (so the inner double quotes are literal). Do **not** use `\"` escapes — single-quoted PowerShell strings don't process escapes, and `\"` would be sent as a literal backslash.

- [ ] **Step 1: Sign up a candidate (no `companyName` needed)**

```powershell
curl -i -c $candidateJar -X POST http://localhost:3000/api/auth/sign-up/email -H "Content-Type: application/json" -d '{"email":"candidate@test.io","password":"password123","name":"Cand","role":"candidate"}'
```

Expected: HTTP 200; body contains `"role":"candidate"`.

- [ ] **Step 2: Sign up an employer WITH `companyName`**

```powershell
curl -i -c $employerJar -X POST http://localhost:3000/api/auth/sign-up/email -H "Content-Type: application/json" -d '{"email":"employer@test.io","password":"password123","name":"Emp","role":"employer","companyName":"Acme Corp"}'
```

Expected: HTTP 200; response body includes `"role":"employer"`.

- [ ] **Step 3: Sign up an employer WITHOUT `companyName` (should fail)**

```powershell
curl -i -X POST http://localhost:3000/api/auth/sign-up/email -H "Content-Type: application/json" -d '{"email":"bad@test.io","password":"password123","name":"Bad","role":"employer"}'
```

Expected: HTTP 400 with body containing `"companyName is required for employer sign-up"`.

- [ ] **Step 4: Sign up the same email twice (should fail with 422)**

```powershell
curl -i -X POST http://localhost:3000/api/auth/sign-up/email -H "Content-Type: application/json" -d '{"email":"candidate@test.io","password":"password123","name":"Dup"}'
```

Expected: HTTP 422 (Better Auth's `USER_ALREADY_EXISTS`).

- [ ] **Step 5: Hit `/api/me` without a cookie (401)**

```powershell
curl -i http://localhost:3000/api/me
```

Expected: HTTP 401 with body `{"message":"Unauthenticated"}`.

- [ ] **Step 6: Hit `/api/me` as the candidate (200)**

```powershell
curl -i -b $candidateJar http://localhost:3000/api/me
```

Expected: HTTP 200; body contains `"email":"candidate@test.io"` and `"role":"candidate"`.

- [ ] **Step 7: Hit `/api/candidate/profile` as the candidate (200)**

```powershell
curl -i -b $candidateJar http://localhost:3000/api/candidate/profile
```

Expected: HTTP 200; body contains `"role":"candidate"`.

- [ ] **Step 8: Hit `/api/candidate/profile` as the employer (403)**

```powershell
curl -i -b $employerJar http://localhost:3000/api/candidate/profile
```

Expected: HTTP 403 with body `{"message":"Forbidden"}`.

- [ ] **Step 9: Hit `/api/employer/profile` as the employer (200 + `companyName`)**

```powershell
curl -i -b $employerJar http://localhost:3000/api/employer/profile
```

Expected: HTTP 200; body contains `"companyName":"Acme Corp"`.

- [ ] **Step 10: Hit `/api/employer/profile` as the candidate (403)**

```powershell
curl -i -b $candidateJar http://localhost:3000/api/employer/profile
```

Expected: HTTP 403 with body `{"message":"Forbidden"}`.

- [ ] **Step 11: Verify the `Employer` row exists for the test employer**

```powershell
docker exec -it next-auth-template-postgres psql -U johndoe -d mydb -c "SELECT u.email, e.\"companyName\" FROM \"User\" u JOIN \"Employer\" e ON e.\"userId\" = u.id WHERE u.email = 'employer@test.io';"
```

Expected: one row with `companyName = "Acme Corp"`.

- [ ] **Step 12: Verify NO `Employer` row exists for the candidate**

```powershell
docker exec -it next-auth-template-postgres psql -U johndoe -d mydb -c "SELECT COUNT(*) FROM \"Employer\" e JOIN \"User\" u ON e.\"userId\" = u.id WHERE u.email = 'candidate@test.io';"
```

Expected: `0`.

- [ ] **Step 13: Sign in via the stock endpoint and re-check `/api/me`**

```powershell
$signinJar = (New-TemporaryFile).FullName
curl -i -c $signinJar -X POST http://localhost:3000/api/auth/sign-in/email -H "Content-Type: application/json" -d '{"email":"candidate@test.io","password":"password123"}'
curl -i -b $signinJar http://localhost:3000/api/me
```

Expected: sign-in returns 200, subsequent `/api/me` returns 200 with `"email":"candidate@test.io"`.

- [ ] **Step 14: Sign out and re-check `/api/me` (should be 401)**

```powershell
curl -i -b $signinJar -c $signinJar -X POST http://localhost:3000/api/auth/sign-out
curl -i -b $signinJar http://localhost:3000/api/me
```

Expected: sign-out returns 200, subsequent `/api/me` returns 401.

- [ ] **Step 15: Final lint + typecheck sweep**

```powershell
npx tsc --noEmit
npm run lint
```

Expected: both succeed with no errors.

---

## Done Criteria

All of the following must be true:

1. `npx tsc --noEmit` passes.
2. `npm run lint` passes.
3. `GET /api/auth/ok` returns `{"status":"ok"}`.
4. All verification curl checks in Task 8 pass.
5. The seed script creates Alice (candidate) and Bob (employer + Employer row) without error.
