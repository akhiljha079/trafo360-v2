// =====================================================================
// TRAFO 360
// Trafo Power & Electricals Pvt Ltd
// Sales -> Manufacturing -> Dispatch Workflow & Document Issue Management
// Built by Vayrone Infratech
// =====================================================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');

const { attachUser } = require('./middleware/auth');
const { startScheduler } = require('./cron/scheduler');
const whatsapp = require('./utils/whatsapp');
const pool = require('./config/db');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'partials/layout');

// Core middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));
app.use(flash());
app.use(attachUser);

app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// Routes
app.use(require('./routes/auth'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/jobs'));
app.use(require('./routes/orders'));
app.use(require('./routes/projectStatus'));
app.use(require('./routes/documents'));
app.use(require('./routes/issues'));
app.use(require('./routes/analytics'));
app.use(require('./routes/admin'));

app.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

// 404
app.use((req, res) => res.status(404).render('404', { title: 'Not Found', layout: false }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  req.flash('error', 'An unexpected error occurred.');
  res.redirect('back');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`TRAFO 360 (Trafo Power & Electricals - Workflow & DMS) running on port ${PORT}`);
  startScheduler();

  // Resume the WhatsApp Web session automatically on restart if it was
  // previously enabled - fully optional, never blocks server startup.
  try {
    const enabled = await whatsapp.isEnabledInSettings();
    if (enabled) {
      whatsapp.initWhatsApp().catch(err => console.error('[whatsapp] init error:', err.message));
    }
  } catch (err) {
    console.error('[whatsapp] Could not check WhatsApp setting on boot:', err.message);
  }
});
