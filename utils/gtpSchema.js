// GTP (General Technical Particulars) schema, now admin-editable from the
// front end (Admin > GTP Schema) instead of the hardcoded constant this
// replaces (utils/gtpFields.js). Field VALUES are still stored per-order as
// flat JSON in orders.gtp_json (unchanged) - only the schema definition
// (which groups/fields exist, their labels/units/types, which stages they
// show up on) now lives in the gtp_field_groups / gtp_fields tables.
const pool = require('../config/db');

// Returns the same shape the old GTP_GROUPS constant had:
// [{ group, fields: [{key,label,unit,type,options,stages}] }]
// scoped to fields that apply to every type (transformer_type_id IS NULL)
// plus any fields scoped specifically to the given transformerType.
async function getSchema(transformerType) {
  const [rows] = await pool.query(
    `SELECT g.id AS group_id, g.name AS group_name, g.sequence_order AS group_order,
            f.field_key, f.label, f.unit, f.field_type, f.select_options, f.stage_codes, f.sequence_order AS field_order
     FROM gtp_field_groups g
     JOIN gtp_fields f ON f.group_id = g.id AND f.is_active = 1
     LEFT JOIN transformer_types t ON g.transformer_type_id = t.id
     WHERE g.is_active = 1 AND (g.transformer_type_id IS NULL OR t.name = ?)
     ORDER BY g.sequence_order ASC, g.id ASC, f.sequence_order ASC, f.id ASC`,
    [transformerType || '']
  );

  const groupsByOrder = new Map();
  rows.forEach(r => {
    if (!groupsByOrder.has(r.group_id)) {
      groupsByOrder.set(r.group_id, { group: r.group_name, fields: [] });
    }
    groupsByOrder.get(r.group_id).fields.push({
      key: r.field_key,
      label: r.label,
      unit: r.unit || '',
      type: r.field_type,
      options: r.select_options ? r.select_options.split(',').map(s => s.trim()).filter(Boolean) : [],
      stages: r.stage_codes ? r.stage_codes.split(',').map(s => s.trim()).filter(Boolean) : []
    });
  });
  return [...groupsByOrder.values()];
}

async function getActiveTransformerTypes() {
  const [rows] = await pool.query('SELECT * FROM transformer_types WHERE is_active=1 ORDER BY sequence_order ASC, name ASC');
  return rows;
}

// Flattens a schema (from getSchema) into [{key,label,unit,group,value}] for
// fields tagged with the given stage code - drives department work orders
// and (Phase 2) generated technical documents.
function fieldsForStage(stageCode, gtpData, schema) {
  const data = gtpData || {};
  const result = [];
  schema.forEach(g => {
    g.fields.forEach(f => {
      if (f.stages.includes(stageCode)) {
        result.push({ key: f.key, label: f.label, unit: f.unit || '', group: g.group, value: data[f.key] || '' });
      }
    });
  });
  return result;
}

module.exports = { getSchema, getActiveTransformerTypes, fieldsForStage };
