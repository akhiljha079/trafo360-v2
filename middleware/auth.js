// Auth & role-based access control middleware
const pool = require('../config/db');

// Cache the app name briefly so we're not querying the DB on every single
// request just to render the title/navbar - refreshes automatically within
// a minute of an Admin changing it in Admin > System Settings.
let appNameCache = { value: 'TRAFO 360', fetchedAt: 0 };
const APP_NAME_CACHE_MS = 60 * 1000;

async function getAppName() {
  const now = Date.now();
  if (now - appNameCache.fetchedAt < APP_NAME_CACHE_MS) return appNameCache.value;
  try {
    const [[row]] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='app_name'`);
    appNameCache = { value: (row && row.setting_value) || 'TRAFO 360', fetchedAt: now };
  } catch (err) {
    // DB not reachable / table not migrated yet - fall back silently
    appNameCache = { value: appNameCache.value || 'TRAFO 360', fetchedAt: now };
  }
  return appNameCache.value;
}

// Attach current user (from session) to res.locals for every view
async function attachUser(req, res, next) {
  // A session created before the per-module RBAC upgrade shipped (persisted
  // in the MySQL session store across a deploy) won't have `.permissions`
  // yet - backfill it here instead of forcing every logged-in user to log
  // out, so requireModule()/the sidebar keep working immediately.
  if (req.session.user && !req.session.user.permissions) {
    req.session.user.permissions = await loadPermissions(req.session.user.role_id);
  }
  res.locals.currentUser = req.session.user || null;
  res.locals.appName = await getAppName();
  res.locals.poweredBy = 'Vayrone Infratech';
  // Force the session to persist (and its connect.sid cookie to be sent) the
  // moment we issue a CSRF token. With saveUninitialized:false, an untouched
  // session is never saved/cookied on a plain GET - so the CSRF token below
  // would be bound to a session ID the browser is never given, a *different*
  // (new) session gets created on the follow-up POST, and CSRF validation
  // fails on every single login attempt. Marking the session dirty here
  // guarantees the GET and its following POST share the same session ID.
  if (req.session && !req.session.__init) req.session.__init = true;
  // req.csrfToken is attached by the doubleCsrfProtection middleware, which
  // must run before this one (see server.js) for every request, including GETs.
  res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

// requireRole('Admin','Director') - allow only listed role names
function requireRole(...roleNames) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    if (!roleNames.includes(req.session.user.role_name)) {
      req.flash('error', 'You do not have permission to access that page.');
      return res.redirect('/dashboard');
    }
    next();
  };
}

// requirePermission('can_manage_documents') - checks a boolean flag on the role
function requirePermission(flag) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    if (!req.session.user[flag]) {
      req.flash('error', 'You do not have permission to perform this action.');
      return res.redirect('/dashboard');
    }
    next();
  };
}

// ---------------------------------------------------------------------
// Per-module RBAC (Sales/Manufacturing/Dispatch/Documents/Warranty/
// Accounting/Reports) - replaces the old flat can_manage_jobs/
// can_manage_documents/can_approve_document_issue flags above for anything
// module-scoped. Those flags (and requirePermission/requireRole) still work
// and are used for the handful of cross-cutting checks (is_admin hard-delete,
// Admin-only routes) that were never really module CRUD to begin with.
// ---------------------------------------------------------------------

// Loads this role's per-module permissions, keyed by module_key, e.g.
// { sales: { view:true, create:true, edit:true, delete:false, approve:false }, ... }.
// Called once at login and cached on the session - see routes/auth.js.
let warnedMissingRbacTables = false;

async function loadPermissions(roleId) {
  try {
    const [rows] = await pool.query(
      `SELECT m.module_key, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete, rp.can_approve
       FROM modules m LEFT JOIN role_permissions rp ON rp.module_id = m.id AND rp.role_id = ?
       WHERE m.is_active = 1`,
      [roleId]
    );
    const permissions = {};
    rows.forEach(r => {
      permissions[r.module_key] = {
        view: !!r.can_view, create: !!r.can_create, edit: !!r.can_edit,
        delete: !!r.can_delete, approve: !!r.can_approve
      };
    });
    return permissions;
  } catch (err) {
    // This runs on EVERY request for a logged-in user (see attachUser below)
    // - if it threw instead of catching, a database missing the `modules`/
    // `role_permissions` tables (i.e. db/upgrade_modules_rbac.sql was never
    // run) would break literally every single page for every user, forever.
    // Fail safe instead: log it loudly once, and return "no module access"
    // (is_admin still bypasses this everywhere via hasModulePermission's own
    // check, so Admin logins keep working and can fix the database).
    if (!warnedMissingRbacTables) {
      warnedMissingRbacTables = true;
      console.error(
        '[auth] Could not load role_permissions/modules (%s). Non-admin users will see no modules until this is fixed. ' +
        'Run db/upgrade_modules_rbac.sql against this database (or a fresh `npm run seed`), then restart the app.',
        err.message
      );
    }
    return {};
  }
}

// Admin always passes, regardless of what's in role_permissions - matches
// the "Admin: full system access" behavior every other check in this app has
// always had, and means a brand-new module works for Admin immediately
// without needing a backfill row.
function hasModulePermission(user, moduleKey, action) {
  if (!user) return false;
  if (user.is_admin) return true;
  return !!(user.permissions && user.permissions[moduleKey] && user.permissions[moduleKey][action]);
}

// requireModule('sales', 'edit') - per-module CRUD gate for routes whose
// module is fixed and known up front (order/lot/document/issue routes).
function requireModule(moduleKey, action) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    if (!hasModulePermission(req.session.user, moduleKey, action)) {
      req.flash('error', 'You do not have permission to perform this action.');
      return res.redirect('/dashboard');
    }
    next();
  };
}

// requireJobPhaseModule('edit') - for job stage-transition routes (advance /
// set-stage) only. A physical transformer unit genuinely flows through
// Sales -> Manufacturing -> Dispatch stages as ONE job record, so the module
// that gates "can this user push this job's stage forward" depends on which
// phase the job's CURRENT stage is in, not on a fixed module - a Dispatch
// user must be able to advance it through Dispatch-phase stages without
// needing blanket Manufacturing rights, and vice versa.
const PHASE_TO_MODULE = { Sales: 'sales', Manufacturing: 'manufacturing', Dispatch: 'dispatch' };
function requireJobPhaseModule(action) {
  return async (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    if (req.session.user.is_admin) return next();
    try {
      const [[row]] = await pool.query(
        `SELECT s.phase FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id WHERE j.id=?`,
        [req.params.id]
      );
      const moduleKey = (row && PHASE_TO_MODULE[row.phase]) || 'manufacturing';
      if (!hasModulePermission(req.session.user, moduleKey, action)) {
        req.flash('error', 'You do not have permission to perform this action.');
        return res.redirect(`/jobs/${req.params.id}`);
      }
      next();
    } catch (err) { next(err); }
  };
}

// requireDocumentModule('edit') - for document mutation routes (edit/
// archive/restore/qrcode-regenerate) keyed by :id. Accounting-category
// documents (invoices, receipts, etc.) are gated by the Accounting module's
// own permissions instead of Documents, so accounting-document access is
// independently controlled - matching the general Document Library and the
// Accounting module having separate role grid columns.
function requireDocumentModule(action) {
  return async (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    if (req.session.user.is_admin) return next();
    try {
      const [[row]] = await pool.query(
        `SELECT c.category_type FROM documents d LEFT JOIN document_categories c ON d.category_id = c.id WHERE d.id=?`,
        [req.params.id]
      );
      const moduleKey = (row && row.category_type === 'accounting') ? 'accounting' : 'documents';
      if (!hasModulePermission(req.session.user, moduleKey, action)) {
        req.flash('error', 'You do not have permission to perform this action.');
        return res.redirect(`/documents/${req.params.id}`);
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = {
  attachUser, requireAuth, requireRole, requirePermission,
  loadPermissions, hasModulePermission, requireModule, requireJobPhaseModule, requireDocumentModule
};