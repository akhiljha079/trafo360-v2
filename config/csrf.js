// Double-submit-cookie CSRF protection (csrf-csrf).
// Traditional server-rendered <form method="POST"> submissions can't send a
// custom header, so the token travels as a hidden `_csrf` form field -
// public/js/csrf.js injects it into every POST form automatically at render
// time (via the meta tag set in the layout), so individual .ejs views never
// need to know about this.
const { doubleCsrf } = require('csrf-csrf');

const { doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || 'change_this_secret',
  getSessionIdentifier: (req) => req.session.id,
  cookieName: process.env.NODE_ENV === 'production' ? '__Host-trafo360.csrf' : 'trafo360.csrf',
  cookieOptions: {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  },
  getCsrfTokenFromRequest: (req) => (req.body && req.body._csrf) || req.headers['x-csrf-token']
  // NOTE: express.urlencoded()/express.json() (applied globally, ahead of
  // this middleware) don't parse multipart/form-data bodies, so a file-
  // upload form's _csrf field wouldn't normally be visible here yet. Rather
  // than skip validation for multipart requests (which would have to be
  // content-type-based and so would blanket-skip CSRF for ANY route an
  // attacker sends as multipart, not just the legitimate upload ones -
  // a real hole, caught here before shipping), server.js instead runs
  // multer for the handful of upload routes BEFORE this middleware, so
  // req.body._csrf is already populated by the time this single pass runs -
  // no skip logic needed, every route validates the same way.
});

module.exports = { doubleCsrfProtection, invalidCsrfTokenError };
