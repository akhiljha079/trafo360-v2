// Safe replacement for the deprecated res.redirect('back'): only honors the
// Referrer header when it points back at this same origin, otherwise falls
// back to the dashboard - avoids open-redirect via a spoofed Referrer.
function safeBack(req, fallback = '/dashboard') {
  const ref = req.get('Referrer');
  if (!ref) return fallback;
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    return new URL(ref, origin).origin === origin ? ref : fallback;
  } catch (e) {
    return fallback;
  }
}

module.exports = { safeBack };
