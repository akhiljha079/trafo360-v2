// Defines the technical documents the system can generate as PDFs, and how
// to gather the data each one needs. Admin-editable settings for each type
// (numbering prefix, which GTP-tagged stages feed it, intro text) live in
// the document_templates table (Admin > Document Templates, Phase 6) -
// this file only defines the structural shape (scope + body layout), which
// determines what data-gathering logic runs.
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { getSchema, fieldsForStage } = require('./gtpSchema');

// scope: which level this document is generated at/from
//   'job'   - a single transformer unit (needs a job)
//   'lot'   - a manufacturing lot (needs an order + lot)
//   'order' - a whole order (needs an order)
// body: which section renders in views/documents/generate/pdf-template.ejs
const DOCUMENT_TYPES = {
  routine_test_report: { label: 'Routine Test Report', scope: 'job', body: 'test-results' },
  type_test_certificate: { label: 'Type Test Certificate', scope: 'job', body: 'test-results' },
  qap: { label: 'Quality Assurance Plan', scope: 'order', body: 'stage-checklist' },
  inspection_call_notice: { label: 'Inspection Call Notice', scope: 'job', body: 'gtp-table' },
  packing_list: { label: 'Packing List', scope: 'lot', body: 'unit-list' },
  dispatch_clearance: { label: 'Dispatch Clearance Note', scope: 'job', body: 'gtp-table' },
  warranty_certificate: { label: 'Warranty Certificate', scope: 'job', body: 'terms-text' },
  nameplate: { label: 'Nameplate / Rating Plate Data Sheet', scope: 'job', body: 'nameplate' },
  technical_offer: { label: 'Technical Offer Sheet', scope: 'order', body: 'gtp-table' },
  bom_export: { label: 'Bill of Materials Export', scope: 'order', body: 'gtp-table' },
  mtc_index: { label: 'Material Test Certificate Index', scope: 'order', body: 'document-index' }
};

const NAMEPLATE_FIELD_KEYS = [
  'rated_power', 'frequency', 'phases', 'hv_voltage', 'lv_voltage', 'vector_group',
  'impedance_pct', 'cooling_type', 'standard', 'total_weight_kg', 'oil_quantity_l'
];

function parseGtpJson(order) {
  try { return JSON.parse(order.gtp_json || '{}'); } catch (e) { return {}; }
}

async function getSetting(key, fallback) {
  const [[row]] = await pool.query('SELECT setting_value FROM system_settings WHERE setting_key=?', [key]);
  return row && row.setting_value ? row.setting_value : fallback;
}

// Puppeteer's page.setContent() has no base URL to resolve a relative
// /branding/... path against, so the logo is inlined as a data URI instead.
// company_logo_path is stored as the public URL path (e.g. /branding/foo.png,
// served by express.static from public/) - resolve it against public/, not
// the project root.
function readLogoDataUri(logoPath) {
  if (!logoPath) return null;
  try {
    const abs = path.join(__dirname, '..', 'public', logoPath.replace(/^\/+/, ''));
    const ext = path.extname(abs).slice(1).toLowerCase() || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
  } catch (e) {
    return null; // missing/unreadable file - documents still generate, just without a logo
  }
}

// Gathers everything views/documents/generate/pdf-template.ejs needs for a
// given doc_type + context ({job, order, lot}) + its document_templates row.
async function gatherData(docType, ctx, template) {
  const def = DOCUMENT_TYPES[docType];
  const order = ctx.order || null;
  const job = ctx.job || null;
  const lot = ctx.lot || null;
  const gtpData = order ? parseGtpJson(order) : {};
  const stageCodes = (template.source_stage_codes || '').split(',').map(s => s.trim()).filter(Boolean);

  const base = {
    docType, def, template, order, job, lot,
    companyName: await getSetting('company_name', 'Trafo Power & Electricals Pvt Ltd'),
    companyLogoDataUri: readLogoDataUri(await getSetting('company_logo_path', null))
  };

  if (def.body === 'test-results' || def.body === 'gtp-table') {
    const schema = order ? await getSchema(order.transformer_type) : [];
    let fields = [];
    stageCodes.forEach(code => { fields = fields.concat(fieldsForStage(code, gtpData, schema)); });
    // de-dupe (a field can be tagged with more than one of the source stages)
    const seen = new Set();
    fields = fields.filter(f => (seen.has(f.key) ? false : (seen.add(f.key), true)));
    return { ...base, fields };
  }

  if (def.body === 'nameplate') {
    const schema = order ? await getSchema(order.transformer_type) : [];
    const flat = {};
    schema.forEach(g => g.fields.forEach(f => { flat[f.key] = f; }));
    const fields = NAMEPLATE_FIELD_KEYS
      .filter(key => flat[key])
      .map(key => ({ key, label: flat[key].label, unit: flat[key].unit, value: gtpData[key] || '' }));
    return { ...base, fields };
  }

  if (def.body === 'stage-checklist') {
    const [stages] = await pool.query(`SELECT * FROM stages WHERE is_active=1 ORDER BY sequence_order ASC`);
    const [requirements] = await pool.query(`SELECT * FROM stage_document_requirements WHERE is_active=1 ORDER BY stage_id, id`);
    const checklist = stages.map(s => ({
      stage: s,
      requirements: requirements.filter(r => r.stage_id === s.id)
    }));
    return { ...base, checklist };
  }

  if (def.body === 'unit-list') {
    const [units] = await pool.query(
      `SELECT job_no, unit_no, serial_no, rating, status FROM jobs WHERE lot_id=? AND is_deleted=0 ORDER BY unit_no ASC`,
      [lot.id]
    );
    return { ...base, units, unitWeightKg: gtpData.total_weight_kg || '' };
  }

  if (def.body === 'terms-text') {
    const termsText = await getSetting('warranty_terms_text', '');
    return { ...base, termsText };
  }

  if (def.body === 'document-index') {
    const [documents] = await pool.query(
      `SELECT d.doc_code, d.doc_name, d.upload_date, c.name AS category_name
       FROM documents d LEFT JOIN document_categories c ON d.category_id = c.id
       WHERE d.is_active=1 AND (d.related_order_id=? OR (d.related_job_id IN (SELECT id FROM jobs WHERE order_id=?)))
       ORDER BY d.upload_date DESC`,
      [order.id, order.id]
    );
    return { ...base, documents };
  }

  return base;
}

module.exports = { DOCUMENT_TYPES, gatherData };
