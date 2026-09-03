// Shared confidentiality check, used by the Document Library routes and
// global search so both apply exactly the same visibility rule.
function canSeeDocument(user, doc) {
  if (user.can_view_confidential || user.can_manage_documents) return true;
  if (doc.confidentiality === 'Public' || doc.confidentiality === 'Internal') return true;
  return doc.uploaded_by === user.id;
}

module.exports = { canSeeDocument };
