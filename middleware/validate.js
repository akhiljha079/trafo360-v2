// Shared express-validator result handler: on failure, flash every message
// and redirect back to the form the user came from, matching this app's
// existing flash+redirect error pattern (see routes/*.js catch blocks).
const { validationResult } = require('express-validator');
const { safeBack } = require('../utils/safeRedirect');

function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  result.array().forEach(e => req.flash('error', e.msg));
  res.redirect(safeBack(req));
}

module.exports = { validate };
