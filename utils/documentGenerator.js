// Orchestrates generating one technical document: gather data -> render PDF
// -> save the file -> create the documents-library row (so QR label,
// confidentiality, and the issue/approval workflow all apply to it exactly
// like any other document) -> record the generated_documents audit link.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { renderPdf } = require('./pdfGenerator');
const { DOCUMENT_TYPES, gatherData } = require('./documentTypes');

const uploadDir = path.join(__dirname, '..', 'uploads');

async function getTemplate(docType) {
  const [[template]] = await pool.query('SELECT * FROM document_templates WHERE doc_type=? AND is_active=1', [docType]);
  return template;
}

async function nextSequence(docType, job, order, lot) {
  let sql = 'SELECT COUNT(*) AS cnt FROM generated_documents WHERE doc_type=?';
  const params = [docType];
  if (job) { sql += ' AND job_id=?'; params.push(job.id); }
  else if (lot) { sql += ' AND lot_id=?'; params.push(lot.id); }
  else if (order) { sql += ' AND order_id=? AND job_id IS NULL AND lot_id IS NULL'; params.push(order.id); }
  const [[row]] = await pool.query(sql, params);
  return row.cnt + 1;
}

function sourceLabel(job, order, lot) {
  if (job) return job.job_no;
  if (lot) return `${order.order_no}-L${lot.lot_no}`;
  return order.order_no;
}

// ctx: { job, order, lot } - only what's relevant for the doc's scope needs
// to be set; userId is the generating user (for the documents.uploaded_by /
// generated_documents.generated_by audit fields).
async function generateDocument(docType, ctx, userId) {
  const def = DOCUMENT_TYPES[docType];
  if (!def) throw new Error(`Unknown document type: ${docType}`);

  const template = await getTemplate(docType);
  if (!template) throw new Error('This document type is disabled or not configured.');

  const { job, order, lot } = ctx;
  if (def.scope === 'job' && !job) throw new Error('This document requires a transformer job.');
  if ((def.scope === 'order' || def.scope === 'lot') && !order) throw new Error('This document requires an order.');
  if (def.scope === 'lot' && !lot) throw new Error('This document requires a lot.');

  const seq = await nextSequence(docType, job, order, def.scope === 'lot' ? lot : null);
  const docNumber = `${template.numbering_prefix}-${sourceLabel(job, order, lot)}-${String(seq).padStart(3, '0')}`;
  const generatedDate = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });

  const data = await gatherData(docType, { job, order, lot: def.scope === 'lot' ? lot : null }, template);
  const pdfBuffer = await renderPdf('pdf-template.ejs', { ...data, docNumber, generatedDate });

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
  fs.writeFileSync(path.join(uploadDir, filename), pdfBuffer);

  const [[category]] = await pool.query(`SELECT id FROM document_categories WHERE name='System-Generated Documents'`);
  const qrToken = crypto.randomBytes(16).toString('hex');

  const [result] = await pool.query(
    `INSERT INTO documents (doc_code, doc_name, category_id, confidentiality, related_job_id, related_order_id, related_lot_id, file_path, qr_token, uploaded_by, current_status)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'Available')`,
    [
      docNumber,
      `${def.label} - ${sourceLabel(job, order, lot)}`,
      category ? category.id : null,
      'Internal',
      job ? job.id : null,
      order ? order.id : null,
      def.scope === 'lot' && lot ? lot.id : null,
      `/uploads/${filename}`,
      qrToken,
      userId
    ]
  );
  const documentId = result.insertId;

  await pool.query(
    `INSERT INTO generated_documents (doc_type, document_id, job_id, order_id, lot_id, generated_by) VALUES (?,?,?,?,?,?)`,
    [docType, documentId, job ? job.id : null, order ? order.id : null, def.scope === 'lot' && lot ? lot.id : null, userId]
  );

  return documentId;
}

module.exports = { generateDocument };
