const { hasModulePermission } = require('../middleware/auth');

// Shared confidentiality check, used by the Document Library routes, the
// Accounting module, and global search so all three apply exactly the same
// visibility rule. An accounting-category document is gated by the
// Accounting module's own permission instead of Documents - matches
// requireDocumentModule() in middleware/auth.js.
function canSeeDocument(user, doc) {
  const moduleKey = doc.category_type === 'accounting' ? 'accounting' : 'documents';
  if (user.can_view_confidential || hasModulePermission(user, moduleKey, 'edit')) return true;
  if (doc.confidentiality === 'Public' || doc.confidentiality === 'Internal') return true;
  return doc.uploaded_by === user.id;
}

module.exports = { canSeeDocument };
