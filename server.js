// =====================================================================
// TRAFO 360
// Trafo Power & Electricals Pvt Ltd
// Sales -> Manufacturing -> Dispatch Workflow & Document Issue Management
// Built by Vayrone Infratech
// =====================================================================
require('dotenv').config();
const express = require('express');
require('express-async-errors'); // patches Router - must load before routes are required below
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const logger = require('./config/logger');

// Safety net: without this, an unhandled promise rejection anywhere in the
// app (Node 15+ defaults to *crashing* the process on those, not just
// logging) takes the entire site down - which is exactly what happened when
// a stray Puppeteer/WhatsApp browser-launch failure wasn't fully caught.
// WhatsApp is an explicitly optional subsystem (see utils/whatsapp.js) and
// must never be able to kill core request handling for everyone else.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection (process kept alive)');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception (process kept alive)');
});

const { attachUser, requireAuth } = require('./middleware/auth');
const { attachCustomerUser } = require('./middleware/customerAuth');
const upload = require('./middleware/upload');
const uploadLogo = require('./middleware/uploadLogo');
const { doubleCsrfProtection, invalidCsrfTokenError } = require('./config/csrf');
const { safeBack } = require('./utils/safeRedirect');
const { startScheduler } = require('./cron/scheduler');
const whatsapp = require('./utils/whatsapp');
const pool = require('./config/db');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Sessions and CSRF tokens are both signed with this secret (see
// config/csrf.js) - the placeholder default is publicly visible in this
// codebase, so running production with it means anyone can forge a session
// or bypass CSRF. docker-compose already fails fast on this (SESSION_SECRET
// is a required compose variable); the aaPanel/manual deploy path has no
// equivalent gate, so enforce it here instead of failing silently.
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change_this_secret' || process.env.SESSION_SECRET === 'change_this_to_a_long_random_string')) {
  console.error('FATAL: SESSION_SECRET is not set (or is still the placeholder) in .env. Set it to a long random string before running in production.');
  process.exit(1);
}

// Trust the reverse proxy (aaPanel/nginx) for correct req.ip / req.secure
// behind SSL termination - needed for rate limiting and secure cookies.
app.set('trust proxy', 1);

app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'partials/layout');

// Security headers. CSP is intentionally permissive on 'unsafe-inline' for
// script/style: the app's views use inline <script> blocks and inline style
// attributes throughout (signature pads, chart init, etc). Tightening this to
// a nonce/hash-based policy is a good follow-up but requires touching every
// view - out of scope for this hardening pass. The CDN allowlist below is
// exactly (and only) what the app actually loads today.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));

app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

// Rate limiting: a generous global ceiling (defense in depth) plus a strict
// one on login specifically, since that's the credential-guessing target.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false
}));
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please wait a few minutes and try again.'
});
// PDF generation spins up a headless-Chromium page per document - cheap
// individually, but worth capping against accidental or deliberate abuse.
const generateDocumentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many documents generated in a short time. Please wait a few minutes and try again.'
});

// Core middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

const sessionStore = new MySQLStore({}, pool);
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: isProd } // 8 hours
}));
app.use(flash());

// The 4 routes that accept file uploads need multer to run BEFORE CSRF
// validation below - express.urlencoded()/express.json() (above) don't
// parse multipart/form-data, so the _csrf field wouldn't be visible yet
// otherwise. Each is gated by requireAuth here too, since without it an
// unauthenticated request could still trigger a file write to disk before
// the route's own auth/permission check further down the chain ever runs.
// See config/csrf.js for the fuller explanation (including the blanket-skip
// approach that was tried and rejected as an actual CSRF bypass).
app.post('/documents', requireAuth, upload.single('file'));
app.post('/documents/:id/edit', requireAuth, upload.single('file'));
app.post('/jobs/:id/stage-documents', requireAuth, upload.single('file'));
app.post('/warranty/claims/:claimId/documents', requireAuth, upload.single('file'));
app.post('/accounting', requireAuth, upload.single('file'));
app.post('/admin/settings', requireAuth, uploadLogo.single('logo'));

app.use(doubleCsrfProtection);
app.use(attachUser);
app.use(attachCustomerUser);

app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// Routes
app.post('/login', loginLimiter);
app.post('/portal/login', loginLimiter);
app.use((req, res, next) => (/\/generate-document$/.test(req.path) ? generateDocumentLimiter(req, res, next) : next()));
app.use(require('./routes/auth'));
app.use(require('./routes/customerPortal'));
app.use(require('./routes/adminCustomers'));
app.use(require('./routes/search'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/sales'));
app.use(require('./routes/manufacturing'));
app.use(require('./routes/dispatch'));
app.use(require('./routes/jobs'));
app.use(require('./routes/orders'));
app.use(require('./routes/projectStatus'));
app.use(require('./routes/documents'));
app.use(require('./routes/issues'));
app.use(require('./routes/warranty'));
app.use(require('./routes/accounting'));
app.use(require('./routes/analytics'));
app.use(require('./routes/reports'));
app.use(require('./routes/admin'));
app.use(require('./routes/gtpSchema'));
app.use(require('./routes/documentTemplates'));

app.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

// 404
app.use((req, res) => res.status(404).render('404', { title: 'Not Found', layout: false }));

// Error handler
app.use((err, req, res, next) => {
  // A response may already be fully sent by the time an error surfaces here
  // (e.g. a session-store write that fails asynchronously after a redirect
  // already went out) - nothing more can be done for that request.
  if (res.headersSent) return next(err);

  if (err === invalidCsrfTokenError || err?.code === 'EBADCSRFTOKEN') {
    req.log?.warn({ err }, 'CSRF validation failed');
    req.flash('error', 'Your session expired or the form was resubmitted. Please try again.');
    return res.redirect(safeBack(req));
  }
  (req.log || logger).error({ err }, 'Unhandled request error');
  req.flash('error', 'An unexpected error occurred.');
  res.redirect(safeBack(req));
});

// Only bind a real port when this file is run directly (`node server.js`) -
// not when required as a module (e.g. by the test suite via supertest).
if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  // Wait for the session store's table to be confirmed ready before binding
  // the port - express-mysql-session creates it asynchronously in the
  // background otherwise, and a login landing in that window gets its
  // session silently dropped (looks exactly like "wrong password" even with
  // the right one). This only matters for the first moment after a boot.
  sessionStore.onReady().catch(err => {
    logger.error({ err }, 'Session store failed to initialize');
    process.exit(1);
  }).then(() => {
    app.listen(PORT, async () => {
      logger.info(`TRAFO 360 (Trafo Power & Electricals - Workflow & DMS) running on port ${PORT}`);
      startScheduler();

      // Resume the WhatsApp Web session automatically on restart if it was
      // previously enabled - fully optional, never blocks server startup.
      try {
        const enabled = await whatsapp.isEnabledInSettings();
        if (enabled) {
          whatsapp.initWhatsApp().catch(err => logger.error({ err }, '[whatsapp] init error'));
        }
      } catch (err) {
        logger.error({ err }, '[whatsapp] Could not check WhatsApp setting on boot');
      }
    });
  });
}

module.exports = app;
