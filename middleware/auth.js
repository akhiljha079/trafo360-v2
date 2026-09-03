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
  res.locals.currentUser = req.session.user || null;
  res.locals.appName = await getAppName();
  res.locals.poweredBy = 'Vayrone Infratech';
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

module.exports = { attachUser, requireAuth, requireRole, requirePermission };
