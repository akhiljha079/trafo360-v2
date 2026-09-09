// Customer Portal auth - deliberately separate from middleware/auth.js's
// staff session (req.session.user). A customer login is a different trust
// boundary entirely: it never goes through roles/role_permissions, and a
// customer session living in the same browser as a staff session (rare, but
// possible) must never be confused with one another.

// Attach the logged-in customer (if any) to res.locals for every view -
// mirrors attachUser's role for staff, but no DB lookup is needed since
// everything a portal page needs is already in the session (set at login).
function attachCustomerUser(req, res, next) {
  res.locals.customerUser = req.session.customerUser || null;
  next();
}

function requireCustomerAuth(req, res, next) {
  if (!req.session.customerUser) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/portal/login');
  }
  next();
}

module.exports = { attachCustomerUser, requireCustomerAuth };
