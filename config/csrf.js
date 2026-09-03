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
});

module.exports = { doubleCsrfProtection, invalidCsrfTokenError };
