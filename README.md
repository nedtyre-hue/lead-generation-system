# Lead App

A lead management application that fetches leads from BigQuery, verifies emails with Reoon, and pushes to ManyReach campaigns.

## Quick Start

```powershell
# Terminal 1 — Server
cd server
npm run dev

# Terminal 2 — Client
cd client
npm run dev
```

Or use the combined script:
```powershell
.\start-all.ps1
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3000

---

## ⚠️ BigQuery Setup — CRITICAL

The app reads leads from a **master view** that unions multiple source tables.

### Architecture

```
Dataset: leadraw (US, NO table expiration!)
├── leadrocks_raw    ← one table per source
├── apollo_raw
├── linkedin_raw
└── master_leads     ← VIEW that UNIONs all sources (app reads from here)
```

### Required View: `master_leads`

The app queries `lead-system-481211.leadraw.master_leads` which must expose:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `email` | STRING | ✅ | Lead email address |
| `first_name` | STRING | ✅ | For gender detection |
| `last_name` | STRING | Optional | Saved if present |
| `company_name` | STRING | Optional | Saved as "company" |
| `source` | STRING | ✅ | Short code: `leadrocks`, `apollo`, etc. |
| `source_detail` | STRING | Optional | Human label: `LeadRocks Database 341,632` |

### Example View DDL

```sql
CREATE VIEW `lead-system-481211.leadraw.master_leads` AS
SELECT
  LOWER(TRIM(email)) AS email,
  first_name, last_name, company_name,
  'leadrocks' AS source,
  'LeadRocks Database 341,632' AS source_detail
FROM `lead-system-481211.leadraw.leadrocks_raw`
WHERE email IS NOT NULL AND email != '' AND STRPOS(email, '@') > 1

UNION ALL
-- add more sources here...
;
```

### Dataset Expiration Warning

> **DO NOT** set a `defaultTableExpirationMs` on the `leadraw` dataset.
> If the dataset has an expiration policy, tables will be **automatically deleted** by BigQuery.

### Query Template

The default `bq_query_template` setting should be:

```sql
SELECT email, first_name, last_name, company_name, source, source_detail
FROM `lead-system-481211.leadraw.master_leads`
```

The app automatically appends:
- `WHERE first_name IS NOT NULL`
- `AND source IN (...)` or `AND source = '...'` (based on source filter)
- `ORDER BY RAND()`
- `LIMIT <n> OFFSET <n>`

---

## Architecture

| Component | Tech | Purpose |
|-----------|------|---------|
| Server | Node.js + Express | API, BigQuery, Reoon, ManyReach integration |
| Client | React + Vite | Dashboard UI |
| Database | SQLite (Prisma ORM) | Local lead storage, settings, suppression list |
| BigQuery | Google Cloud | Source of raw lead data |
| Reoon | API | Email verification |
| ManyReach | API | Campaign management & email pushing |

## Settings (configured via UI)

| Key | Description |
|-----|-------------|
| `bq_project_id` | Google Cloud project ID |
| `bq_query_template` | BigQuery SQL to fetch leads |
| `reoon_api_key` | Reoon email verification API key |
| `reoon_statuses` | JSON array of accepted statuses (e.g., `["safe"]`) |
| `manyreach_api_key` | ManyReach API key |
| `manyreach_list_id` | ManyReach list ID (auto-provisioned) |

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Table ... was not found` | `leads_master` deleted or missing | Recreate table (see above) |
| `BigQuery query timed out` | Query too large or BQ overloaded | Reduce lead target, retry |
| `Scripts disabled` (PowerShell) | Execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` error | Bad JSON in `.env` | Re-paste service account JSON (no line breaks) |
