// Users whose role can perform `action` on a given module, via
// role_permissions - Admin roles always qualify (matches
// hasModulePermission()'s bypass in middleware/auth.js). Shared by
// documentNotify.js and warrantyNotify.js so "who gets notified" always
// matches whatever Admin > Roles & Privileges currently says, instead of
// drifting per notifier.
const pool = require('../config/db');

const COLUMN_BY_ACTION = { view: 'can_view', create: 'can_create', edit: 'can_edit', delete: 'can_delete', approve: 'can_approve' };

async function usersWithModulePermission(moduleKey, action) {
  const column = COLUMN_BY_ACTION[action];
  if (!column) throw new Error(`Unknown permission action: ${action}`);
  const [rows] = await pool.query(
    `SELECT u.email, u.whatsapp_number FROM users u
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN modules m ON rp.module_id = m.id AND m.module_key = ?
     WHERE u.is_active = 1 AND (r.is_admin = 1 OR (m.module_key = ? AND rp.${column} = 1))`,
    [moduleKey, moduleKey]
  );
  return rows;
}

module.exports = { usersWithModulePermission };
