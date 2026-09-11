# TRAFO 360
## A Front-End-Configurable Manufacturing Execution System for Transformer Manufacturing
### For Trafo Power & Electricals Pvt Ltd
**Built by Vayrone Infratech**

A web application that runs a transformer manufacturer's Sales → Manufacturing → Dispatch operation
end to end, with almost everything reconfigurable from the Admin UI rather than hardcoded:

1. **Workflow tracking** — every transformer job moves through a fully customizable stage pipeline
   (rename/reorder/add/remove stages, gate advancement on required documents), with automatic
   email/WhatsApp notifications you configure per stage.
2. **Orders, Lots & GTP-driven manufacturing** — batch orders, auto-generated per-unit jobs, and a
   **database-driven GTP (General Technical Particulars) schema** you edit from the front end instead
   of a fixed form.
3. **Technical document generation** — eleven document types (test reports, QAP, packing lists,
   certificates, and more) generated as branded PDFs straight from GTP data, auto-filed into the
   document library.
4. **Document Issue Management** — a library-style catalogue with confidentiality levels, an
   approval-gated borrow/issue workflow, e-signatures, QR physical-file tracking, automatic overdue
   escalation, and an extension flow.
5. **Modern, themeable UI** — dark mode, a live transformer-build visualization tied to real stage
   progress, per-user dashboard customization, validated-palette analytics charts, and global search.
6. **Production hardening** — CSRF protection, rate limiting, a MySQL-backed session store, structured
   logging, and a Docker deployment path alongside the primary aaPanel one.

The core workflow/document-management modules were built, installed, and functionally tested
end-to-end (login, job creation, stage advancement with live email-log auditing, document upload,
issue → approval → extension → extension-approval, role-based access control, and the daily cron
escalation logic). Everything added since is documented per-section below, including what's been
verified and how, and what still needs a real deployment to confirm — see
**§15 Verification Status** before relying on anything without checking it yourself first.

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v16+) |
| Web framework | Express.js |
| Templating | EJS (server-rendered, Bootstrap 5) |
| Database | MySQL / MariaDB |
| Auth | express-session (server-side sessions, bcrypt password hashing) |
| Email | Nodemailer (SMTP, configurable from the Admin UI) |
| Scheduled jobs | node-cron (in-process daily scheduler) |
| File uploads | Multer (files stored outside the public web root) |
| OCR | Tesseract.js (self-hosted, no cloud API/key - see §6C) |

No build step is required — it runs directly with `node server.js` / PM2. This matches how aaPanel's Node.js App manager expects an app to run.

---

## 2. Deploying on aaPanel (Web UI Walkthrough)

Every step below happens inside the aaPanel web dashboard in your browser. The only exception is
step 6, which uses aaPanel's built-in **Terminal** panel — still entirely inside the browser, no
SSH client needed — because installing npm packages and seeding the database don't have a pure
point-and-click equivalent.

### Step 1 — Install prerequisites (App Store)
Log into aaPanel, click **App Store** in the left sidebar, and install:
- **Node.js Version Manager** → once installed, open it and click **Install Node.js version**,
  choose **18.x** or **20.x LTS**, and install it.
- **MySQL** (5.7 or 8.0) — if it's not already installed. During install, aaPanel will show you the
  MySQL **root password** — save it somewhere safe (docker-compose calls the equivalent variable
  `DB_ROOT_PASSWORD`; on aaPanel it's just the root password aaPanel generated).
- **PM2 Manager** — search the App Store for "PM2 Manager" and install it (some aaPanel versions
  bundle this automatically with the Node.js App feature; if you don't see a separate PM2 Manager
  tile after installing Node.js Version Manager, it's already included).

### Step 2 — Create the database (Database)
Click **Database** in the left sidebar → **Add database**:
- Database name: `trafo360` (or your own choice — you'll reuse it in Step 5)
- Username: `trafo360_user`
- Password: click the dice icon to generate a strong one, then **copy and save it** — you'll paste
  it into `.env` in Step 5.
- Access permission: leave as **Local** (the app connects from the same server, `DB_HOST=127.0.0.1`)
- Click **Submit**.

### Step 3 — Create the website and upload the code (Website + Files)
1. Click **Website** in the left sidebar → **Add site**.
2. Domain: your real domain (e.g. `trafo360.yourcompany.com`) — you can also use a bare IP for now
   and add the real domain later, but a domain is required if you want free SSL in Step 8.
3. Leave **Database** unchecked here (you already made one in Step 2) and **FTP** unchecked unless
   you specifically want FTP access.
4. Click **Submit** — aaPanel creates `/www/wwwroot/<your-domain>/`.
5. Click **Files** in the left sidebar, navigate into that new website folder, and delete the
   default `index.html` aaPanel put there.
6. Get this project's code into that folder, either way:
   - **Upload a zip**: zip this project on your machine (excluding `node_modules/`, which you don't
     need to upload — it gets rebuilt on the server in Step 6), click **Upload** in the Files panel,
     upload the zip into the website folder, then right-click it → **Decompress**.
   - **Git clone**: if this project is in a git remote you control, open **Terminal** (left sidebar)
     and run `cd /www/wwwroot/<your-domain> && git clone <your-repo-url> .`

### Step 4 — Configure environment (Files' built-in editor)
1. In the **Files** panel, inside the website folder, find `.env.example` and use **Rename** to
   duplicate it to `.env` (or upload a fresh copy named `.env`).
2. Click `.env` → **Edit** (aaPanel opens its built-in code editor — no terminal needed for this
   part) and fill in:
   - `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — from Step 2
   - `SESSION_SECRET` — **must** be a long random string; the app now refuses to start in
     production with the placeholder value left in `.env.example`, so don't skip this. Any
     20+ character random string works — e.g. generate one at random or run
     `openssl rand -hex 32` in the Terminal panel if you want a cryptographically strong one.
   - `NODE_ENV=production`
   - `APP_URL` — your domain with `https://`, e.g. `https://trafo360.yourcompany.com` (you can
     revisit this after Step 8 once SSL is actually issued)
   - `SMTP_*` — placeholder values are fine here; **Admin → SMTP Settings** inside the app lets you
     set the real mail credentials later without touching the server again
   - `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the first login you'll create in Step 5
3. Save.

### Step 5 — Install dependencies, provision Chromium, and initialize the database (Terminal)
Click **Terminal** in the left sidebar (a browser-based shell into this exact server — still part
of the aaPanel UI, nothing external to install) and run, inside the website folder:
```bash
cd /www/wwwroot/<your-domain>
npm install --omit=dev
```
This also downloads Puppeteer's bundled Chromium (~200MB) automatically — needed for the technical
document generation (PDF) engine (§6.1) and, if you enable it later, WhatsApp notifications (§11.4).
It needs the server to have normal outbound internet access, which almost all VPS/aaPanel servers
do. If your server has no outbound internet access, see §11.5 for the "install a system Chromium
instead" alternative.

Still in the same Terminal panel:
```bash
npm run seed          # creates all tables + seeds roles, stages, GTP schema, document templates, settings
npm run create-admin  # creates your first Admin login from the .env ADMIN_EMAIL/ADMIN_PASSWORD you just set
```

### Step 6 — Run the app (Website → Node Project)
1. Click **Website** in the left sidebar, then the **Node Project** tab at the top (next to PHP/Java
   project tabs — this only appears once Node.js Version Manager is installed from Step 1).
2. Click **Add Node Project**:
   - **Project directory**: the website folder from Step 3
   - **Startup file**: `server.js`
   - **Node version**: the 18.x/20.x LTS you installed in Step 1
   - **Port**: `3000` (must match `PORT` in `.env`, or leave `.env` unset for the default)
   - **Startup mode**: **PM2** — aaPanel then handles restart-on-crash and restart-on-reboot
     automatically, so you don't need to babysit the process
   - **Run command**: `npm start` (equivalent to `node server.js`)
3. Click **Submit**, then **Start** the project. Its status should turn green ("Running"); click
   **Logs** on the project if it doesn't, to see the actual startup error (a common one is a typo in
   `.env`, or the `SESSION_SECRET` placeholder check in server.js refusing to boot — see Step 4).

### Step 7 — Reverse proxy + SSL (Website settings)
1. Back in **Website** (the normal, non-Node tab), click your site → **Settings**.
2. Click **Reverse Proxy** → **Add Reverse Proxy**: target URL `http://127.0.0.1:3000`, leave the
   rest at defaults, **Submit**.
3. Click **SSL** → **Let's Encrypt** tab → select the domain → **Apply**. Once issued, toggle
   **Force HTTPS** on.
4. Go back to `.env` (Step 4) and make sure `APP_URL` matches the final `https://` address, then
   restart the Node project from the **Node Project** tab (Step 6) for the change to take effect.

### Step 8 — First login and initial configuration
- Visit your domain, log in with the Admin credentials from Step 4.
- **Admin → Users** — create real accounts for every department (Sales, Design, Stores, Production
  sections, QA, Dispatch, Documents Coordinator, and the Director).
- **Admin → Notification Rules** — decide who gets emailed at each workflow stage.
- **Admin → SMTP Settings** — enter your real mail server credentials (Gmail with an App Password,
  Office 365, or your own SMTP relay all work).
- **Admin → Workflow Stages** — rename/reorder/add/remove stages to match exactly how your factory
  works; everything downstream (job tracking, notifications, document gating) follows whatever's
  defined here.
- **Admin → GTP Schema** — review the default ~35-field GTP form and adjust it (or add fields/groups
  specific to your transformer types) before Sales starts entering real orders.
- **Admin → Document Templates** — set your real numbering prefixes and review the intro text for
  each of the 11 generated document types before anyone relies on them going to a customer.
- **Admin → System Settings** — set your Company Name, Tagline, and upload your Company Logo (used
  on every generated document's letterhead), plus the Warranty Certificate terms text.

---

## 3. How the Workflow Module Works

- `Admin → Workflow Stages` is the single source of truth for the Sales → Manufacturing → Dispatch pipeline. It ships pre-seeded with 28 stages (8 Sales, 13 Manufacturing, 7 Dispatch) matching a typical transformer manufacturing process, but every stage can be renamed, reordered (↑/↓), given a different "owner role", disabled, or you can add entirely new stages — **the workflow is not hardcoded**.
- Each Transformer Job (`/jobs`) starts at the first active stage and is moved forward one stage at a time from its detail page — either by "Advance to next stage" or by manually jumping to any stage.
- Every start/complete event is written to `job_stage_history` (a full audit trail) and checked against `Admin → Notification Rules` — if a rule exists for that stage+event, the configured role(s)/user(s) get an email automatically.

## 4. How the Document Issue Management Module Works

- `Documents Coordinator` (or Admin) catalogues every file under **Document Library**, tagging each with a Confidentiality level (Public / Internal / Confidential / Highly Confidential). Confidential and Highly Confidential documents are automatically hidden from anyone whose role doesn't have "View Confidential" checked in **Admin → Roles & Privileges**.
- Any user can request to **issue/borrow** a document. This creates a "Pending Approval" record and emails everyone whose role has "Approve Document Issue" checked (e.g. Director, or any role you choose).
- On approval, the document is marked Issued with an issue date and a due date (default period configurable in **Admin → System Settings**).
- A daily background job (runs once a day, 09:00 server time by default — configurable in `cron/scheduler.js`):
  - Sends a reminder before the due date and on the due date
  - If overdue, sends daily reminders to the holder + Documents Coordinator during the configured **grace period** (default 2 working days, Sundays excluded by default — configurable)
  - Once the grace period is exceeded, **automatically escalates via email to the Director** and marks the record "Escalated"
- The holder can request an **extension** at any time before/after the due date; this again requires approval from the Director/authorized role, and the due date only changes once approved.
- Every email the system ever sends (workflow or document) is logged in the `email_log` table for audit purposes.

## 5. Roles Shipped by Default

| Role | Notes |
|---|---|
| Admin | Full system access |
| Director | Receives escalations; approves document issues/extensions by default |
| Sales | Owns the Sales-phase stages |
| Design Engineering | Owns design/drawing stages; can view confidential |
| Stores / Procurement | Material stages |
| Production - Core & Winding / Assembly / Fabrication / Oil & Drying | Manufacturing stages |
| QA / Testing | Testing/QA stages; can view confidential |
| Dispatch | Dispatch-phase stages |
| Documents Coordinator | Manages the document library and issue workflow; can view confidential |

**Admin → Roles & Privileges** now grids this out per module instead of a flat list of checkboxes:
Sales / Manufacturing / Dispatch / Documents / Warranty / Accounting / Reports, each with independent
View / Create / Edit / Delete / Approve toggles per role, alongside the three flags that were always
cross-cutting rather than module-scoped (Admin, Director-gets-escalations, View Confidential). A role
change takes effect the next time a user with that role logs in. If you're upgrading an existing
install, run `db/upgrade_modules_rbac.sql` once (a fresh `npm run seed` already includes it) — it
backfills every existing role's new per-module grid from its old flags, so nobody's effective access
changes on upgrade; you can then re-tune it from the new grid at any time.

---

## 2A. Modules

The sidebar and permission model are organized into modules that mirror the Sales → Manufacturing →
Dispatch flow, plus Documents, Warranty, Accounting, and Reports. A physical transformer unit is still
a single Job record that flows continuously through all three phases (that hasn't changed) — the
modules are a navigation and permission grouping over that same underlying data, not separate copies
of it:

- **Sales** (`/sales`) — order/GTP intake overview, quick links into **Orders & GTP**.
- **Manufacturing** (`/manufacturing`) — units currently in a Manufacturing-phase stage, active lots,
  quick links into **Transformer Jobs** and **Project Status**.
- **Dispatch** (`/dispatch`) — units currently in a Dispatch-phase stage, dispatch throughput this
  month.
- **Documents** — the existing Document Library and Document Issues.
- **Reports** — currently the existing Analytics dashboard; a dedicated Reports module with
  exportable per-module reports is planned for a later phase.
- **Warranty** (`/warranty`) — see §6A.
- **Accounting** (`/accounting`) — see §6B.

A job's stage-transition actions (Advance / Set Stage / Hold / Cancel) are gated by whichever module
its **current stage's phase** maps to, not by a fixed module — so a Dispatch-only role can push a unit
through Dispatch-phase stages without needing Manufacturing rights, and vice versa. Everything else
(creating/editing orders, jobs, lots, documents) is gated by a fixed module matching where that action
lives in the sidebar.

---

## 6. Orders, Lots & GTP-Driven Manufacturing

For orders manufactured in batches (e.g. "50 x 10MVA transformers, released in lots of 10"),
**Orders & Lots** replaces creating 50 separate jobs by hand:

- **Create an Order** once, with the customer, PO, total quantity, and a structured **GTP (General
  Technical Particulars)** form — rated power, voltages, vector group, impedance, core/winding
  materials, tap changer details, insulation levels, tank/oil specs, and more (ships with ~35 fields
  across 9 groups). This is the single design that every unit in the order shares. Unlike earlier
  builds, the GTP schema itself is **not hardcoded** — `Admin → GTP Schema` lets you add, edit,
  reorder, or disable transformer types, field groups, and individual fields (including which
  department work orders/documents each field appears on) entirely from the front end, optionally
  scoped to a specific transformer type. If you're upgrading an existing install, run
  `db/upgrade_gtp_schema.sql` once (a fresh `npm run seed` already includes everything).
- **Add Lots** against the order as manufacturing releases happen — e.g. Lot 1 = 10 units, Lot 2 = 10
  units, and so on, whatever pattern your production planning uses. Adding a lot **automatically
  creates one Job per unit** (e.g. `ORD-2026-014-L1-U01` through `U10`), each starting at the first
  **Manufacturing**-phase stage (Sales/GTP approval already happened once, at the order level) and
  tracked independently from there.
- **Lot Progress Matrix** (`Orders → [Order] → [Lot] → Progress`) is the direct answer to "how many
  tanks are prepared, how many painted, how many wound, from this lot" — every active stage shows a
  live count of how many of the lot's units have **completed** it and how many are **currently in
  progress**, with a progress bar per stage.
- **System-generated Department Work Orders**: from an order's page, click any manufacturing stage
  (Core, Winding, Tank & Fabrication, Testing, etc.) to open a printable sheet pulling only the GTP
  parameters relevant to that department, optionally with a specific lot's unit list attached — this
  is the "receipt" that goes to each department telling them exactly what to build.
- Standalone jobs (created via **Jobs → New Job**, not through an Order) continue to work exactly as
  before — Orders/Lots are additive, not a replacement, for one-off units or smaller orders that don't
  need batch tracking.

### 6.1 Technical Document Generation

A **Generate Document** panel on every Job, Order, and Lot page produces a formal, letterheaded PDF
straight from that unit's/order's GTP data — no manual drafting. Eleven document types ship by
default: Routine Test Report, Type Test Certificate, Quality Assurance Plan, Inspection Call Notice,
Packing List, Dispatch Clearance Note, Warranty Certificate, Nameplate/Rating Plate Data Sheet,
Technical Offer Sheet, Bill of Materials Export, and Material Test Certificate Index. Every generated
PDF is **automatically added to the Document Library** — it gets a QR label, an auto-generated
document number, the standard confidentiality/issue-approval workflow, and is linked back to its
source Job/Order/Lot — nothing generated lives outside the existing document-control system.
`Admin → Document Templates` controls the numbering prefix, intro text, and which GTP-tagged stages
feed each document type's data table (or disables a type entirely). If you're upgrading an existing
install, run `db/upgrade_document_generation.sql` once (a fresh `npm run seed` already includes
everything). Rendering uses a headless Chromium instance (via Puppeteer, downloaded automatically on
`npm install`) - no extra server setup needed beyond what a normal deploy already does.

## 6A. Warranty Tracking & Claims Management

- A **Warranty** record is created automatically for a unit the moment its job is marked Completed
  (all stages finished, i.e. dispatched) — `start_date` is the completion date, `duration_months`
  comes from that unit's transformer type (**Admin → GTP Schema** → per-type "Warranty (months)"
  field, falling back to the **Default Warranty Period** in **Admin → System Settings** if a type
  isn't found), and `end_date` is computed from the two.
- **Warranty → Warranty & Claims** lists every unit's warranty with a RAG-style status — **Active**,
  **Expiring** (within the configurable **Warranty Expiring Alert** window, default 60 days —
  **Admin → System Settings**), **Expired**, or **Void** — and how many open claims each has. A daily
  background check (the same scheduler as the document overdue/escalation job, `cron/scheduler.js`)
  flips Active → Expiring → Expired automatically and emails everyone with Warranty module access
  when a unit enters the Expiring window.
- **Full claims management**: from a warranty's page, raise a claim with the customer's complaint.
  Each claim moves through **Open → Investigating → Resolved/Rejected → Closed**, can be assigned to
  a user, records a site visit date, resolution notes, and any spare parts used, and supports
  attaching photos/reports (reusing the existing Document Library upload/storage — these show up
  tagged to the claim, not in the general library list). Moving a claim to a final decision
  (Resolved/Rejected) requires the Warranty module's **Approve** permission; everything else needs
  **Edit**/**Create**, matching the same per-module RBAC grid as every other module (**Admin → Roles
  & Privileges**). The claimant is emailed automatically when a decision is recorded.
- The existing **Warranty Certificate** PDF (generated from a Job's **Generate Document** panel,
  §6.1) is unchanged and independent of this tracking — this module adds *tracking the warranty
  period and handling claims against it*, not the certificate paperwork itself.

## 6B. Accounting Documents Module

Accounting itself (ledgers, GST/tax computation, payments) is explicitly **out of scope** for this
system — but the factory still needs somewhere to file the documents that accounting produces or
needs, linked back to the relevant order/job. **Accounting → Accounting Documents** is a thin,
purpose-built view over the existing Document Library infrastructure (upload, storage, confidentiality)
scoped to a dedicated set of categories (Sales Invoice, Payment Receipt, E-Way Bill, Purchase Order,
Tax Invoice/GST) — no borrow/issue workflow, no ledger, no calculations, just collection and retrieval.
Accounting documents are gated by their **own** entry in the per-module permission grid (**Admin →
Roles & Privileges**), independent of the general Documents module, and do not appear in the general
Document Library list (only under Accounting) — so a role can be given access to one without the other.

## 6C. OCR on Uploaded Scans

Uploading an image file (JPG/PNG — not a PDF; scanned PDFs aren't rasterized) to the Document Library
or Accounting Documents kicks off a best-effort text extraction in the background via
[Tesseract.js](https://github.com/naptha/tesseract.js), a self-hosted OCR engine (no cloud API, no key
to manage — consistent with this app's offline-friendly deployment story). The extracted text is
stored on the document and:
- Shown on the document's page in a collapsible **OCR Extracted Text** panel, along with a
  best-effort *guess* at a document number and a date found in the text (simple pattern matching -
  always a suggestion to eyeball against the original, never applied automatically to the document's
  actual name/code).
- Searchable — the Document Library search box and global search also match against OCR'd text, so a
  scanned certificate can be found by content even if it was catalogued under an unrelated name.

Since OCR accuracy depends heavily on scan quality, fonts, and layout, treat this as a
time-saving assist for cataloguing, not a data-entry replacement — it was designed and code-reviewed
in this environment but the actual Tesseract recognition pass has not been run against a real scanned
document here (no network access to install `tesseract.js` in this sandbox); please upload a real test
scan after deploying and confirm the extracted text looks reasonable before relying on it. Run
`npm install` after upgrading (adds the `tesseract.js` dependency) and `db/upgrade_ocr.sql` once
against an existing database (a fresh `npm run seed` already includes the column).

## 6D. Customer Portal

A separate, restricted login surface at **`/portal/login`** — entirely distinct from staff logins
(`/login`): different session, different login page, and a customer account never goes through the
internal roles/permissions system at all.

- **Admin → Customer Portal** is where Admin creates a **Customer** (the real-world company) and one
  or more **portal logins** for it (name/email/password — customers cannot self-register). Password
  resets and enable/disable both work the same way as Admin → Users.
- An **Order** can optionally be linked to a Customer from its Edit / GTP page — this is what makes
  the order (and the units created under it) visible in that customer's portal. Orders/units keep
  their existing free-text `customer_name` for display everywhere else in the app; the link is
  additive and nothing breaks for orders that aren't linked.
- Once logged in, a customer sees **only their own orders**: per-unit stage progress (no GTP/technical
  detail), and any document an admin has explicitly checked **"Visible in the Customer Portal"** on
  that document's page in the Document Library or Accounting Documents (e.g. a released test report
  or certificate) — nothing else in the system is reachable. Every portal query is scoped to the
  logged-in customer's ID, and confidentiality is still enforced even on a customer-visible document
  (Confidential/Highly Confidential is never shown externally, regardless of the flag).
- If you're upgrading an existing install, run `db/upgrade_customer_portal.sql` once (a fresh
  `npm run seed` already includes everything). Like the rest of this round of work, this was built and
  reviewed without a live database — please click through a real customer login end-to-end before
  relying on it (create a customer, link an order, mark a document Customer Visible, and confirm the
  portal shows exactly what's expected and nothing more).

## 7. Department Document Gating

**Admin → Stage Document Requirements** lets you define what a department must upload before a unit
is allowed past a given stage — e.g. Core Shop must upload a "Core Cutting Inspection Report" before
that unit can move to Winding. Requirements can be **Mandatory** (blocks "Advance to next stage" until
satisfied) or **Optional** (informational only). On each job's page, a checklist shows exactly which
required documents are missing (✗) or satisfied (✓) for its current stage, with an upload button right
there — so the department doing the work is also the one proving it's done, before the job can move on.
Manual "Jump to stage" overrides remain available for admins/managers who need to bypass this for
genuine exceptions.

## 8. Full Edit & Delete Support

Both **Transformer Jobs** and the **Document Library** now support full editing and deletion:

- **Jobs**: Edit customer/PO/rating/serial details any time from the job page. Delete **soft-deletes**
  (archives) the job — it disappears from the active list, but its full stage history stays intact in
  the database for audit purposes; nothing is ever silently destroyed.
- **Documents**: Edit metadata (name, category, confidentiality, linked job, storage location) and
  optionally replace the uploaded file. **Archive** is the default "Delete" action (reversible — restore
  any time from the new Archived view toggle on the Document Library page). A separate **permanent
  delete**, restricted to Admin only, actually removes the database record and file — use it only when
  you're certain a document should never be recoverable (e.g. accidental duplicate upload).
- Orders themselves also support edit (including the GTP form) and soft-delete, following the same
  audit-preserving pattern.

If you're upgrading an existing install, run `db/upgrade_orders_lots.sql` once to add these tables and
columns (a fresh `npm run seed` on a new database already includes everything via `schema.sql`).

## 9. Project Status Dashboard

A new **Project Status** page (linked from the sidebar and the main Dashboard) gives a single-glance,
RAG-coded (Red/Amber/Green) view of every transformer job:

- **Progress %** — based on how far the job's current stage sits within the full active stage sequence.
- **Days in current stage** — flags anything sitting in one stage for **10+ days** with a warning icon, so bottlenecks are visible immediately rather than discovered at dispatch time.
- **RAG status**, driven by an optional **Target Dispatch Date** you can set per job (on the New Job form, or edited any time from the job's detail page):
  - **Green — On Track:** more than 7 days until the target date.
  - **Amber — At Risk:** within 7 days of the target date.
  - **Red — Delayed:** past the target date and not yet dispatched.
  - **Gray:** no target date set, or the job is On Hold/Cancelled.
- Summary cards at the top give an instant count of how many jobs are in each state, plus a dedicated "stalled" count.

This sits alongside (not instead of) the Analytics dashboard — Analytics looks backward at trends and averages, Project Status looks forward at what's at risk right now.

Every job's progress is also shown as a small animated **transformer build illustration** (core →
windings → tank → radiators/bushings → oil → dispatch straps, matching the real manufacturing
sequence) with a glow ring reflecting its RAG status — used on the job detail page, Project Status,
and the dashboard's recent-jobs list.

### 9.1 Dashboard Customization

**Customize Dashboard** (top of the Dashboard) lets each user show/hide and reorder their own
dashboard widgets (summary stats, active jobs by phase, recently updated jobs, my issued documents,
pending approvals) — purely personal, doesn't affect what anyone else sees. If you're upgrading an
existing install, run `db/upgrade_dashboard_widgets.sql` once (a fresh `npm run seed` already
includes everything).

## 10. Branding & Modern UI

The interface carries real Trafo Power & Electricals identity pulled from trafopower.com:
ISO 9001:2015 certification, 1986 founding year, the Sikandra/Agra plant location, and manufacturing
capacity figures (25kVA–50,000kVA, up to 132kV) shown on the login screen. The footer links out to
both **trafopower.com** and **vayrone.com**. The visual design uses a navy/blue/amber palette with the
Inter/Poppins font pairing, a modern split-screen login page, sticky gradient navbar, and RAG-coded
progress indicators throughout. If you're upgrading an existing install, run `db/upgrade_project_status.sql`
once to add the new `target_dispatch_date` column (a fresh `npm run seed` already includes it).

**Enterprise UI pass** (no schema changes - front-end only):

- **Dashboard module tiles** — the Dashboard now leads with a row of live-stat tiles (Sales,
  Manufacturing, Dispatch, Documents, Warranty, Accounting), each shown only if you can access that
  module, linking straight to its home page.
- **Tabs** on the two busiest detail pages — a **Transformer Job** page is now Overview / Documents
  (with a "missing required docs" badge) / Stage History, and an **Order** page is Lots / GTP Summary
  / Work Orders / Documents — using Bootstrap's native tab plugin (already loaded), styled with a
  `.tabs-modern` treatment.
- **Card/thumbnail grid view** — Transformer Jobs, Orders, Document Library, Accounting Documents,
  Project Status, and Warranty each have a table/grid toggle; the grid cards for jobs and project
  status reuse the existing transformer build visualization as their thumbnail. The toggle is
  remembered per page/browser in `localStorage`, so it doesn't affect what anyone else sees.
- **Motion** — cards and tiles gently fade/rise into place as you scroll to them
  (`public/js/animate.js`, an IntersectionObserver), fully disabled under
  `prefers-reduced-motion: reduce`, matching how the transformer build visualization already handled
  reduced motion.
- No new frontend framework or build step - everything above is the existing Bootstrap 5 + vanilla JS
  stack, extended (`public/css/style.css`, `public/js/animate.js`, `public/js/viewToggle.js`).

## 11. Add-On Features Included in This Build

Four of the previously "suggested" add-ons have now been built in. All are safe by default —
if any of them can't run on your server (e.g. no Chromium for WhatsApp), the rest of the
application is completely unaffected.

### 11.1 QR-Code Physical File Tracking
- Every document in the library automatically gets a unique QR code (`Admin` isn't needed for this — it happens on document creation).
- On a document's page, **Print Label** opens a printable sticker (QR + doc code + name + confidentiality) sized for a small label printer or to cut out from A4.
- Scanning the QR with any phone camera opens `https://your-domain/scan/<token>`, which (after login, if needed) takes the person straight to that document's page — no searching required.
- **Documents Coordinator** can **Regenerate** a document's QR code if a label is lost or compromised (the old label immediately stops working).
- This QR mechanism can be extended to the physical folders from the file-index/folder-tree we built earlier — just create a "document" record per physical folder and print its label.

### 11.2 E-Signature Approvals
- Approving (or rejecting) a document issue request, and approving/rejecting an extension request, now includes a **signature pad** (draw with mouse/finger/stylus) directly in the browser.
- **A signature is required to approve** — the button is blocked client-side and the server independently re-checks this, so it can't be bypassed by disabling JavaScript.
- The captured signature (PNG) is stored against that specific approval record and displayed on the issue's detail page permanently as part of the audit trail.
- Signing is optional when *rejecting* a request (a signature isn't needed to say no).

### 11.3 Analytics Dashboard
- **Analytics** page (visible to anyone with **View** on the **Reports** module — **Admin → Roles &
  Privileges**) with seven charts:
  1. Jobs by phase & status
  2. Average time spent per stage (hours) — spot bottlenecks
  3. Jobs created per month — throughput trend
  4. Document issues by status
  5. Overdue/escalated documents trend by month
  6. Stage-completion workload by department/role
  7. Documents by confidentiality level
- Built with Chart.js (CDN, no extra build step) fed by live SQL aggregate queries — for live trend
  charts. For exportable tabular reports, see §11.3A below.

### 11.3A Reports Module
**Reports** (`/reports`, also gated on the Reports module's **View** permission) complements Analytics
with filterable, exportable tabular reports, one per module: Sales, Manufacturing Throughput, Dispatch,
Warranty Claims, Document Issues, and Accounting Documents. Each has a From/To date filter and two
export buttons — **CSV** (for Excel) and **PDF** (letterheaded, via the same Puppeteer pipeline that
renders the 11 technical document types, §6.1) — so a department head can pull, say, "every warranty
claim raised last quarter" without writing a query.

### 11.4 WhatsApp Notifications (WhatsApp Web — no paid Business API)
- **Admin → WhatsApp Notifications** lets you connect a real WhatsApp account by scanning a QR code (exactly like linking a device to WhatsApp Web on a browser).
- Once connected, every notification this system already sends by email (stage changes, approval requests, reminders, overdue alerts, Director escalations, extension decisions) is **also** sent as a WhatsApp message — but only to users who have a **WhatsApp Number** saved on their profile (`Admin → Users`).
- **Please read the on-screen warning before enabling this.** In summary:
  - This is *unofficial* automation of the consumer WhatsApp app (via `whatsapp-web.js`, which drives a real WhatsApp Web session using a headless Chromium browser). It is not the paid, Meta-sanctioned WhatsApp Business API.
  - Use a **dedicated company phone number**, not someone's personal number — WhatsApp's Terms of Service don't officially permit this kind of automation, and while it's very widely used at reasonable volume for internal notifications like this, there's a small risk of the number being flagged.
  - The linked phone must stay **powered on and connected to the internet**; WhatsApp Web relays messages through it.
  - If the WhatsApp session ever disconnects or errors out, the app keeps running normally and every notification still goes out by **email** — WhatsApp is a bonus channel, never a dependency.

**A note on testing:** everything else in this README describes features that were actually run and verified end-to-end (login, workflow stages, document issue/approval/extension, QR generation and scanning, e-signature enforcement, and the analytics queries). The WhatsApp module's code was written, syntax-checked, and its admin UI/status states (Disabled → Initializing → QR Pending → Ready → Error) were verified to render and toggle correctly — but the actual WhatsApp pairing step needs a real phone to scan the QR code, which isn't something that could be tested in this environment. Please test that specific step on your own server before relying on it.

### 11.5 aaPanel Setup Notes for the New Add-Ons

- **QR codes, e-signatures, analytics** — no extra server setup needed; they work as soon as you deploy normally (Steps 1–8 above still apply). Just re-run `npm install` since two new packages (`qrcode`, `whatsapp-web.js`) were added, and run `db/upgrade_addons.sql` once against your database if you'd already set it up before this update (a fresh `npm run seed` on a brand-new database already includes everything).
- **WhatsApp** needs a headless Chromium browser on the server:
  - **Easiest:** just let it download its own the first time you run `npm install` (needs the server to have normal outbound internet access — most VPS/aaPanel servers do). No extra config needed.
  - **Lighter/faster:** install a system Chromium once (`apt install -y chromium` on most distros, or your distro's equivalent) and set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` in `.env` — this avoids the ~300MB Puppeteer download and reduces disk usage per deploy.
  - If your hosting environment blocks outbound downloads entirely and you don't want to install system Chromium either, simply leave WhatsApp disabled — nothing else in the app is affected.

---

## 12. Suggested Add-Ons Not Yet Built (Future Phase)

1. **Mobile app / PWA wrapper** — the current UI is responsive and works in a mobile browser, but an installable PWA (or a thin native wrapper) would let Director/approvers approve issue requests from a push notification with one tap.
2. **Two-Factor Authentication (2FA)** — for Admin and Director logins specifically, given they can approve confidential document releases.
3. **ERP/Tally integration** — auto-create the dispatch invoice / E-Way Bill stage entry from your accounting software instead of manual entry.
4. **Automated backup to cloud storage** — nightly `mysqldump` + uploads folder sync to Google Drive/S3, since this system will become the single source of truth for your QA/MRB records.

**Built since the original version of this list:** OCR on uploaded scans (§6C) and a Customer-facing portal (§6D) — both described in their own sections below.

---

## 13. Project Structure

```
trafo-360/
├── server.js                       # App entry point
├── package.json
├── .env.example                    # Copy to .env and fill in
├── Dockerfile / docker-compose.yml  # Alternative deploy path - see §14
├── config/
│   ├── db.js                       # MySQL connection pool
│   ├── mailer.js                    # Dynamic SMTP (DB-configurable)
│   ├── logger.js                     # Structured (pino) logging
│   └── csrf.js                        # CSRF double-submit-cookie config
├── db/
│   ├── schema.sql                  # All tables (source of truth for a fresh install)
│   ├── seed.sql                     # Default roles, 28 stages, categories, GTP schema, document templates, settings
│   └── upgrade_*.sql                 # Migrations for pre-existing installs - see §16
├── scripts/
│   ├── seed.js                      # npm run seed
│   └── createAdmin.js                # npm run create-admin
├── middleware/
│   ├── auth.js                      # Session auth + role/permission guards (staff)
│   ├── customerAuth.js               # Session auth guard for the Customer Portal (separate from staff)
│   ├── validate.js                    # express-validator result handler
│   ├── upload.js                       # Multer config for confidential documents (private, outside public/)
│   └── uploadLogo.js                    # Multer config for the public branding logo (inside public/)
├── utils/
│   ├── workingDays.js               # Grace-period working-day math
│   ├── notify.js                     # Workflow stage email + WhatsApp engine
│   ├── documentNotify.js              # Document issue email + WhatsApp engine
│   ├── warrantyNotify.js               # Warranty claim/expiry email + WhatsApp engine
│   ├── permissionRecipients.js          # Shared "who has module permission X" lookup (both notifiers above)
│   ├── warranty.js                       # Auto-creates a job's warranty record on dispatch
│   ├── ocr.js                              # Tesseract.js text extraction + doc-number/date guessing
│   ├── whatsapp.js                        # WhatsApp Web (unofficial) integration
│   ├── gtpSchema.js                        # Resolves the DB-driven GTP schema (replaces the old hardcoded version)
│   ├── documentTypes.js                     # Technical-document type definitions + data gathering
│   ├── documentGenerator.js                  # Orchestrates PDF generation -> Document Library filing
│   ├── pdfGenerator.js                        # EJS -> HTML -> PDF via a shared Puppeteer instance
│   ├── documentAccess.js                       # Shared document-confidentiality check (module-aware)
│   ├── jobStatus.js                             # Shared RAG/progress-% computation
│   ├── dashboardWidgets.js                       # Dashboard widget registry
│   └── safeRedirect.js                            # Open-redirect-safe replacement for redirect('back')
├── cron/
│   └── scheduler.js                # Daily document reminder/escalation + warranty expiry job
├── routes/                         # auth, customerPortal, adminCustomers, search, dashboard, sales,
│                                    # manufacturing, dispatch, jobs, orders, projectStatus, documents,
│                                    # issues, warranty, accounting, analytics, reports, admin,
│                                    # gtpSchema, documentTemplates
├── views/                          # EJS templates, including views/documents/generate/ (PDF layout +
│                                    # report-template.ejs), views/warranty/, views/accounting/,
│                                    # views/reports/, views/portal/ (Customer Portal, its own minimal
│                                    # chrome - no shared sidebar/header), and views/partials/widgets/
├── public/
│   ├── css/style.css               # Design tokens, dark mode, module tiles/entity cards/tabs, motion
│   ├── js/{csrf,theme}.js           # CSRF auto-injection, dark-mode toggle
│   ├── js/animate.js                 # Scroll-in motion for [data-animate] elements
│   ├── js/viewToggle.js               # Table/grid view toggle on list pages (per-page localStorage)
│   └── branding/                     # Uploaded company logo (public - not confidential)
└── uploads/                        # Confidential document files (private, outside public/)
```

## 14. Docker Deployment (Alternative to aaPanel)

If you'd rather not manage Node/MySQL/PM2 directly, `docker-compose.yml` runs the whole stack
(app + MySQL, with persistent volumes for the database, uploaded documents, and the branding logo):

```bash
cp .env.example .env        # fill in SESSION_SECRET, DB_ROOT_PASSWORD, SMTP_* at minimum
docker compose up -d --build
docker compose exec app npm run seed
docker compose exec app npm run create-admin
```

The app will be on `http://localhost:3000` (or `$PORT`). Put a reverse proxy (nginx/Caddy) with a
real TLS certificate in front of it for production, same as the aaPanel path's Step 7. The compose
file's MySQL port is bound to `127.0.0.1` only (for local DB-GUI debugging) — it's not reachable from
outside the host by default. This path is optional — the primary, verified deployment path is aaPanel
(§2); keep this only if you might want a containerized deploy later, otherwise `Dockerfile`,
`docker-compose.yml`, and `.dockerignore` are safe to delete.

**Note on this repository:** the sandbox this app was built in has neither Docker nor a usable local
MySQL, so `docker compose up` itself has not been run end-to-end — the Dockerfile and compose file
were reviewed carefully and the app was verified booting/serving traffic via `node server.js` directly
against the same code paths, but please do a first real `docker compose up` yourself and report back
if anything doesn't come up cleanly.

## 15. Verification Status

Being upfront about what "tested" means for the work in this repository, since a lot of it was built
without access to a running MySQL instance or Docker:

- **Verified live, repeatedly, throughout development:** the app boots and serves real HTTP traffic
  (every route in the app was hit with curl and returned the expected status code), all security
  middleware (CSRF, rate limiting, CSP/security headers, the `SESSION_SECRET` fail-fast check) behaves
  correctly under live requests including deliberate attack attempts (wrong/missing CSRF tokens,
  disallowed file uploads), and the PDF generation pipeline (all 7 document layout types, including
  the company logo) was rendered for real through Puppeteer and visually inspected. The transformer
  build visualization was rendered and screenshotted across 9 progress states. The login page's
  light/dark themes were screenshotted and a real dark-mode CSS bug was caught and fixed that way.
- **Verified by static analysis:** every JavaScript file syntax-checks cleanly and every EJS template
  compiles cleanly, on every commit in this project's history.
- **Not yet verified (needs a real database):** anything that requires real data round-tripping
  through MySQL - workflow stage advancement, order/lot creation, document issue approval,
  notification emails actually sending, and the daily cron escalation job. These all worked in the
  original (pre-this-round) build per the top of this README, and the code paths for the new work
  follow the exact same patterns, but please click through the app yourself against a real database
  before considering any of Phases 1 through 7 (GTP schema, document generation, UI modernization,
  dashboard customization, and the security-hardening commits) production-verified. (This project
  previously carried a Jest/Supertest test suite covering these flows; it was removed to keep the
  deployed package lean — `git log` has it if you want it back.)

## 16. Upgrading an Existing Install

A **fresh** `npm run seed` already includes everything in this README - skip this section entirely
for a new install. If you have an existing database from before this round of changes, run these
once, in this order (each is idempotent-ish per its own comments, but back up your database first
regardless):

```bash
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_orders_lots.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_project_status.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_addons.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_gtp_schema.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_document_generation.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_dashboard_widgets.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_modules_rbac.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_warranty.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_ocr.sql
mysql --default-character-set=utf8mb4 -u <user> -p <database> < db/upgrade_customer_portal.sql
```

**The `--default-character-set=utf8mb4` flag is not optional** - without it, the `mysql` CLI falls
back to its own default charset (often `latin1`) for the session, which silently corrupts any `°`,
`²`, or other non-ASCII character in the file being loaded (e.g. a GTP field unit like `°C` gets
permanently stored as `Â°C`). This isn't a risk for `npm run seed`/`npm run create-admin` (those go
through `mysql2` in Node, which already defaults to `utf8mb4`) - it only bites raw `mysql <file.sql`
invocations like the ones above.

Then `npm install` (a few packages were added since the original build) and restart the app.

---

*This application and documentation were prepared for Trafo Power & Electricals Pvt Ltd by Vayrone Infratech.*
