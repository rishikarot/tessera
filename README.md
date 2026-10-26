# Tessera

Tessera is a minimal no-code platform for building business apps: define your own modules (tables), fields, views, forms and, soon, automations. It is modelled on Airtable's feature set with its own quiet, minimal look.

## What works today (Phase 1)

- **Workspaces, apps and modules.** An app groups related modules, like a Sales CRM with Companies, Contacts and Deals.
- **All 31 field types defined**, with validation: text, long text, email, URL, phone, number, currency, percent, duration, rating, autonumber, single and multiple select, checkbox, date, created/modified time and by, user, linked record, lookup, rollup, count, attachment (links for now), barcode, signature, location, plus formula, button and AI fields (set up today, calculated in later phases).
- **Linked records both ways.** Linking Deals to Companies adds the paired field on Companies automatically, and lookups, rollups and counts compute across the link.
- **Views:** grid (inline editing, keyboard navigation, column menu, grouping), kanban (drag cards between columns) and forms (shareable public link). Every view saves its own filters, sorts, groups and hidden fields, and can be collaborative, personal or locked.
- **Records:** expand panel, comments, full change history, soft delete and restore.
- **Roles:** owner, creator, editor, commenter and read-only, enforced by the API.
- **Field type changes** convert existing values where possible (for example text to single select creates the options).

Calendar, gallery, timeline, list and Gantt views can already be created and saved; they render from Phase 2. See the roadmap below.

## Run it locally

You need Node 20+, Docker Desktop (running) and pnpm. This project uses pnpm workspaces, so `npm install` will not work. Turn on pnpm once with:

```bash
corepack enable       # or: npm install -g pnpm
```

Then:

```bash
pnpm install
pnpm db:up            # starts Postgres 16 in Docker (see docker-compose.yml)
pnpm db:seed          # optional: demo Sales CRM for demo@tessera.local
pnpm dev              # API on :4000, web app on http://localhost:5173
```

Sign in with any email (development sign-in). Use `demo@tessera.local` to see the seeded CRM.

### Using Supabase instead of Docker

Tessera only needs a Postgres database, so a Supabase project works as is:

1. In Supabase, open **Connect** and copy the **Session pooler** connection string.
2. Run with it as `DATABASE_URL`, adding `?sslmode=require`:

```bash
export DATABASE_URL="postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
pnpm db:seed && pnpm dev
```

Migrations run automatically when the API starts.

## Tests

```bash
pnpm test             # shared unit tests + API integration tests
```

API tests create and reset a `tessera_test` database next to `DATABASE_URL` (or use `TEST_DATABASE_URL`).

## Project layout

```
apps/api          Fastify API, SQL migrations, services, integration tests
apps/web          React + Vite web app
packages/shared   Field types, validation, view config, filters and sorts, roles
```

Records are stored as JSONB keyed by field id, so creating modules and fields never needs a database migration. Linked records live in a `record_links` table, stored in both directions.

## Roadmap

| Phase | Scope |
| --- | --- |
| 1 (now) | Apps, modules, all field types, grid, kanban, forms, links, lookups, rollups, roles |
| 2 | Calendar, gallery, timeline, list, Gantt; formula engine; automations; REST API keys and webhooks; file uploads |
| 3 | Interface builder, dashboards, field and row permissions, realtime presence, integrations |
| 4 | AI fields, describe-an-app, external portals, SSO and audit logs, scripting, MCP |

## Before going live

- Replace development sign-in (`POST /auth/dev-login`) with real authentication, and set `AUTH_SECRET`.
- Filtering and sorting run in memory per request (up to 50,000 records per module); push them into SQL for larger modules.
