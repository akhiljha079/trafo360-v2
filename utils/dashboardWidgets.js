// Registry of dashboard widgets a user can show/hide/reorder. Each user's
// choices are stored in user_dashboard_widgets; a user who never customizes
// anything just sees every widget they have permission for, in this order.
const WIDGET_REGISTRY = [
  { key: 'stats', label: 'Summary Stat Cards' },
  { key: 'jobs_by_phase', label: 'Active Jobs by Phase' },
  { key: 'recent_jobs', label: 'Recently Updated Jobs' },
  { key: 'my_issues', label: 'My Issued Documents (Due Soon)' },
  { key: 'pending_approvals', label: 'Pending Approvals', requiresModule: 'documents', requiresAction: 'approve' }
];

function visibleToUser(widget, user) {
  if (!widget.requiresModule) return true;
  if (user.is_admin) return true;
  return !!(user.permissions && user.permissions[widget.requiresModule] && user.permissions[widget.requiresModule][widget.requiresAction]);
}

// Returns the registry merged with this user's saved prefs (defaults for
// anything never customized), sorted by sequence_order, filtered to widgets
// the user's permissions allow. `savedRows` = rows from user_dashboard_widgets.
function resolveWidgets(user, savedRows) {
  const savedByKey = {};
  savedRows.forEach(r => { savedByKey[r.widget_key] = r; });

  return WIDGET_REGISTRY
    .filter(w => visibleToUser(w, user))
    .map((w, i) => {
      const saved = savedByKey[w.key];
      return {
        key: w.key,
        label: w.label,
        isVisible: saved ? !!saved.is_visible : true,
        sequenceOrder: saved ? saved.sequence_order : i * 10
      };
    })
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
}

module.exports = { WIDGET_REGISTRY, resolveWidgets };
