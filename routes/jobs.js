const express = require('express');
const path = require('path');
const fs = require('fs');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireModule, requireJobPhaseModule } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { notifyStageEvent } = require('../utils/notify');
const { getActiveTransformerTypes } = require('../utils/gtpSchema');
const { DOCUMENT_TYPES } = require('../utils/documentTypes');
const { generateDocument } = require('../utils/documentGenerator');
const { computeRag, computeProgressPct } = require('../utils/jobStatus');
const { createWarrantyForJob } = require('../utils/warranty');
const router = express.Router();

const jobFieldRules = [
  body('customer_name').trim().notEmpty().withMessage('Customer name is required.').isLength({ max: 150 }),
  body('transformer_type').trim().notEmpty().withMessage('Transformer type is required.'),
  body('target_dispatch_date').optional({ checkFalsy: true }).isISO8601().withMessage('Target dispatch date must be a valid date.')
];

// LIST
router.get('/jobs', requireAuth, async (req, res) => {
  const { phase, status, q } = req.query;
  let sql = `SELECT j.*, s.stage_name, s.phase, s.sequence_order, o.order_no
             FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id
             LEFT JOIN orders o ON j.order_id = o.id
             WHERE j.is_deleted=0`;
  const params = [];
  if (phase) { sql += ' AND s.phase=?'; params.push(phase); }
  if (status) { sql += ' AND j.status=?'; params.push(status); }
  if (q) { sql += ' AND (j.job_no LIKE ? OR j.customer_name LIKE ? OR j.po_no LIKE ? OR j.serial_no LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`); }
  sql += ' ORDER BY j.updated_at DESC';
  const [jobsRaw] = await pool.query(sql, params);
  const [[{ totalStages }]] = await pool.query(`SELECT COUNT(*) AS totalStages FROM stages WHERE is_active=1`);
  const jobs = jobsRaw.map(j => ({ ...j, progressPct: computeProgressPct(j.sequence_order, totalStages), rag: computeRag(j).rag }));
  res.render('jobs/list', { title: 'Transformer Jobs', jobs, filters: { phase, status, q } });
});

// NEW (form) - for a standalone job not created via the Orders/Lots module
router.get('/jobs/new', requireAuth, requireModule('manufacturing', 'create'), async (req, res) => {
  const [firstStage] = await pool.query('SELECT * FROM stages WHERE is_active=1 ORDER BY sequence_order ASC LIMIT 1');
  const transformerTypes = await getActiveTransformerTypes();
  res.render('jobs/new', { title: 'New Transformer Job', firstStage: firstStage[0], transformerTypes });
});

// CREATE
router.post('/jobs', requireAuth, requireModule('manufacturing', 'create'),
  [body('job_no').trim().notEmpty().withMessage('Job No. is required.').isLength({ max: 60 }), ...jobFieldRules],
  validate, async (req, res) => {
  const { job_no, po_no, customer_name, transformer_type, rating, serial_no, target_dispatch_date } = req.body;
  try {
    const [[firstStage]] = await pool.query('SELECT * FROM stages WHERE is_active=1 ORDER BY sequence_order ASC LIMIT 1');
    const [result] = await pool.query(
      `INSERT INTO jobs (job_no, po_no, customer_name, transformer_type, rating, serial_no, target_dispatch_date, current_stage_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [job_no, po_no, customer_name, transformer_type, rating, serial_no, target_dispatch_date || null, firstStage ? firstStage.id : null, req.session.user.id]
    );
    if (firstStage) {
      await pool.query(
        `INSERT INTO job_stage_history (job_id, stage_id, event, updated_by) VALUES (?,?, 'Started', ?)`,
        [result.insertId, firstStage.id, req.session.user.id]
      );
      notifyStageEvent(result.insertId, firstStage.id, 'on_start').catch(console.error);
    }
    req.flash('success', `Job ${job_no} created.`);
    res.redirect(`/jobs/${result.insertId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create job. Job No. may already exist.');
    res.redirect('/jobs/new');
  }
});

// EDIT (form)
router.get('/jobs/:id/edit', requireAuth, requireModule('manufacturing', 'edit'), async (req, res) => {
  const [[job]] = await pool.query('SELECT * FROM jobs WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!job) { req.flash('error', 'Job not found.'); return res.redirect('/jobs'); }
  const transformerTypes = await getActiveTransformerTypes();
  res.render('jobs/edit', { title: `Edit ${job.job_no}`, job, transformerTypes });
});

// UPDATE
router.post('/jobs/:id/edit', requireAuth, requireModule('manufacturing', 'edit'), jobFieldRules, validate, async (req, res) => {
  const { po_no, customer_name, transformer_type, rating, serial_no } = req.body;
  try {
    await pool.query(
      `UPDATE jobs SET po_no=?, customer_name=?, transformer_type=?, rating=?, serial_no=? WHERE id=?`,
      [po_no || null, customer_name, transformer_type, rating || null, serial_no || null, req.params.id]
    );
    req.flash('success', 'Job details updated.');
    res.redirect(`/jobs/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update job.');
    res.redirect(`/jobs/${req.params.id}/edit`);
  }
});

// DELETE (soft - preserves history for audit; hides from lists)
router.post('/jobs/:id/delete', requireAuth, requireModule('manufacturing', 'delete'), async (req, res) => {
  await pool.query('UPDATE jobs SET is_deleted=1 WHERE id=?', [req.params.id]);
  req.flash('success', 'Job deleted (archived - stage history is preserved for audit purposes).');
  res.redirect('/jobs');
});

// VIEW
router.get('/jobs/:id', requireAuth, async (req, res) => {
  const [[job]] = await pool.query(
    `SELECT j.*, s.stage_name, s.phase, s.sequence_order, s.id AS stage_id, s.stage_code,
            o.order_no, l.lot_name, l.lot_no
     FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id
     LEFT JOIN orders o ON j.order_id = o.id LEFT JOIN lots l ON j.lot_id = l.id
     WHERE j.id=? AND j.is_deleted=0`, [req.params.id]);
  if (!job) { req.flash('error', 'Job not found.'); return res.redirect('/jobs'); }

  const [allStages] = await pool.query('SELECT * FROM stages WHERE is_active=1 ORDER BY sequence_order ASC');
  const [history] = await pool.query(
    `SELECT h.*, s.stage_name, s.phase, u.name AS updated_by_name
     FROM job_stage_history h JOIN stages s ON h.stage_id = s.id LEFT JOIN users u ON h.updated_by = u.id
     WHERE h.job_id=? ORDER BY h.action_at ASC`, [req.params.id]);
  const [documents] = await pool.query('SELECT * FROM documents WHERE related_job_id=? AND is_active=1', [req.params.id]);

  // figure out next stage in sequence for the "advance" button
  const currentIndex = allStages.findIndex(s => s.id === job.current_stage_id);
  const nextStage = currentIndex >= 0 && currentIndex < allStages.length - 1 ? allStages[currentIndex + 1] : null;

  const progressPct = computeProgressPct(job.sequence_order, allStages.length);
  const { rag, label: ragLabel } = computeRag(job);

  // Required documents for the CURRENT stage (admin-configured), and what's
  // already been uploaded for this job at this stage - the "department gate".
  let requirements = [];
  if (job.current_stage_id) {
    const [reqRows] = await pool.query(
      `SELECT * FROM stage_document_requirements WHERE stage_id=? AND is_active=1 ORDER BY id ASC`, [job.current_stage_id]);
    const [uploaded] = await pool.query(
      `SELECT jsd.*, u.name AS uploaded_by_name FROM job_stage_documents jsd LEFT JOIN users u ON jsd.uploaded_by=u.id
       WHERE jsd.job_id=? AND jsd.stage_id=?`, [req.params.id, job.current_stage_id]);
    requirements = reqRows.map(r => ({
      ...r,
      uploads: uploaded.filter(u => u.requirement_id === r.id)
    }));
  }
  const missingMandatory = requirements.filter(r => r.is_mandatory && r.uploads.length === 0);

  const [genDocTypes] = await pool.query(
    `SELECT doc_type, name FROM document_templates WHERE is_active=1 AND doc_type IN (?) ORDER BY name`,
    [Object.keys(DOCUMENT_TYPES).filter(k => DOCUMENT_TYPES[k].scope === 'job')]
  );

  const [[warranty]] = await pool.query('SELECT id, status, end_date FROM warranties WHERE job_id=?', [req.params.id]);

  res.render('jobs/view', { title: job.job_no, job, allStages, history, documents, nextStage, requirements, missingMandatory, genDocTypes, progressPct, rag, ragLabel, warranty });
});

// GENERATE a technical document (Routine Test Report, Nameplate, etc.) for this unit
router.post('/jobs/:id/generate-document', requireAuth, requireModule('manufacturing', 'edit'), async (req, res) => {
  const { doc_type } = req.body;
  const jobId = req.params.id;
  try {
    const [[job]] = await pool.query(
      `SELECT j.*, o.order_no, o.customer_name AS order_customer_name, o.po_no AS order_po_no,
              o.transformer_type AS order_transformer_type, o.rating AS order_rating, o.gtp_json
       FROM jobs j LEFT JOIN orders o ON j.order_id = o.id WHERE j.id=? AND j.is_deleted=0`, [jobId]);
    if (!job) { req.flash('error', 'Job not found.'); return res.redirect('/jobs'); }
    const order = job.order_id ? {
      id: job.order_id, order_no: job.order_no, customer_name: job.order_customer_name,
      po_no: job.order_po_no, transformer_type: job.order_transformer_type, rating: job.order_rating, gtp_json: job.gtp_json
    } : null;
    const documentId = await generateDocument(doc_type, { job, order }, req.session.user.id);
    req.flash('success', 'Document generated and added to the Document Library.');
    res.redirect(`/documents/${documentId}`);
  } catch (err) {
    req.log?.error({ err }, 'document generation failed');
    req.flash('error', `Could not generate document: ${err.message}`);
    res.redirect(`/jobs/${jobId}`);
  }
});

// UPLOAD a required (or ad-hoc) document for the job's CURRENT stage
// NOTE: file upload for this route runs early in server.js, before CSRF
// validation - see the comment in config/csrf.js.
router.post('/jobs/:id/stage-documents', requireAuth, async (req, res) => {
  const { requirement_id, remarks } = req.body;
  const jobId = req.params.id;
  try {
    const [[job]] = await pool.query('SELECT * FROM jobs WHERE id=?', [jobId]);
    if (!job || !job.current_stage_id) { req.flash('error', 'Job has no active stage.'); return res.redirect(`/jobs/${jobId}`); }
    if (!req.file) { req.flash('error', 'Please choose a file to upload.'); return res.redirect(`/jobs/${jobId}`); }
    await pool.query(
      `INSERT INTO job_stage_documents (job_id, stage_id, requirement_id, file_path, original_name, uploaded_by, remarks)
       VALUES (?,?,?,?,?,?,?)`,
      [jobId, job.current_stage_id, requirement_id || null, `/uploads/${req.file.filename}`, req.file.originalname, req.session.user.id, remarks || null]
    );
    req.flash('success', 'Document uploaded for this stage.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not upload document.');
  }
  res.redirect(`/jobs/${jobId}`);
});

// Download a stage document
router.get('/jobs/:id/stage-documents/:docId/download', requireAuth, async (req, res) => {
  const [[doc]] = await pool.query('SELECT * FROM job_stage_documents WHERE id=? AND job_id=?', [req.params.docId, req.params.id]);
  if (!doc) { req.flash('error', 'File not found.'); return res.redirect(`/jobs/${req.params.id}`); }
  const abs = path.join(__dirname, '..', doc.file_path.replace('/uploads/', 'uploads/'));
  if (!fs.existsSync(abs)) { req.flash('error', 'File missing on server.'); return res.redirect(`/jobs/${req.params.id}`); }
  res.download(abs, doc.original_name || path.basename(abs));
});

// ADVANCE TO NEXT STAGE (completes current, starts next) - fully driven by the
// customizable `stages` table, so admins can reorder/add/remove stages freely.
// Blocked if any MANDATORY document requirement for the current stage hasn't
// been uploaded yet - this is the department gate.
router.post('/jobs/:id/advance', requireAuth, requireJobPhaseModule('edit'), async (req, res) => {
  const { remarks } = req.body;
  const jobId = req.params.id;
  try {
    const [[job]] = await pool.query('SELECT * FROM jobs WHERE id=?', [jobId]);
    if (!job) { req.flash('error', 'Job not found.'); return res.redirect('/jobs'); }

    if (job.current_stage_id) {
      const [reqRows] = await pool.query(
        `SELECT * FROM stage_document_requirements WHERE stage_id=? AND is_active=1 AND is_mandatory=1`, [job.current_stage_id]);
      if (reqRows.length) {
        const [uploaded] = await pool.query(
          `SELECT DISTINCT requirement_id FROM job_stage_documents WHERE job_id=? AND stage_id=?`, [jobId, job.current_stage_id]);
        const uploadedIds = new Set(uploaded.map(u => u.requirement_id));
        const missing = reqRows.filter(r => !uploadedIds.has(r.id));
        if (missing.length) {
          req.flash('error', `Cannot advance: missing required document(s) - ${missing.map(m => m.requirement_name).join(', ')}`);
          return res.redirect(`/jobs/${jobId}`);
        }
      }
    }

    const [allStages] = await pool.query('SELECT * FROM stages WHERE is_active=1 ORDER BY sequence_order ASC');
    const currentIndex = allStages.findIndex(s => s.id === job.current_stage_id);
    const nextStage = currentIndex >= 0 && currentIndex < allStages.length - 1 ? allStages[currentIndex + 1] : null;

    if (job.current_stage_id) {
      await pool.query(
        `INSERT INTO job_stage_history (job_id, stage_id, event, remarks, updated_by) VALUES (?,?, 'Completed', ?, ?)`,
        [jobId, job.current_stage_id, remarks || null, req.session.user.id]
      );
      notifyStageEvent(jobId, job.current_stage_id, 'on_complete', remarks).catch(console.error);
    }

    if (nextStage) {
      await pool.query('UPDATE jobs SET current_stage_id=? WHERE id=?', [nextStage.id, jobId]);
      await pool.query(
        `INSERT INTO job_stage_history (job_id, stage_id, event, updated_by) VALUES (?,?, 'Started', ?)`,
        [jobId, nextStage.id, req.session.user.id]
      );
      notifyStageEvent(jobId, nextStage.id, 'on_start').catch(console.error);
      req.flash('success', `Job moved to: ${nextStage.stage_name}`);
    } else {
      await pool.query(`UPDATE jobs SET status='Completed' WHERE id=?`, [jobId]);
      // All stages finished = dispatched - start this unit's warranty clock.
      createWarrantyForJob(jobId).catch(err => req.log?.error({ err }, 'warranty creation failed'));
      req.flash('success', 'Job marked as Completed - all stages finished. Its warranty period has started.');
    }
    res.redirect(`/jobs/${jobId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not advance job stage.');
    res.redirect(`/jobs/${jobId}`);
  }
});

// JUMP TO A SPECIFIC STAGE MANUALLY (e.g. skip / go back) - for flexibility.
// Not gated by document requirements since it's an explicit manual override.
router.post('/jobs/:id/set-stage', requireAuth, requireJobPhaseModule('edit'), async (req, res) => {
  const { stage_id, remarks } = req.body;
  const jobId = req.params.id;
  try {
    await pool.query('UPDATE jobs SET current_stage_id=? WHERE id=?', [stage_id, jobId]);
    await pool.query(
      `INSERT INTO job_stage_history (job_id, stage_id, event, remarks, updated_by) VALUES (?,?, 'Started', ?, ?)`,
      [jobId, stage_id, remarks || 'Manually set', req.session.user.id]
    );
    notifyStageEvent(jobId, stage_id, 'on_start', remarks).catch(console.error);
    req.flash('success', 'Job stage updated.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update job stage.');
  }
  res.redirect(`/jobs/${jobId}`);
});

// HOLD / CANCEL / REACTIVATE
router.post('/jobs/:id/status', requireAuth, requireJobPhaseModule('edit'), async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE jobs SET status=? WHERE id=?', [status, req.params.id]);
  req.flash('success', `Job status set to ${status}.`);
  res.redirect(`/jobs/${req.params.id}`);
});

// UPDATE TARGET DISPATCH DATE (used by the Project Status RAG calculation)
router.post('/jobs/:id/target-date', requireAuth, requireModule('manufacturing', 'edit'), async (req, res) => {
  const { target_dispatch_date } = req.body;
  await pool.query('UPDATE jobs SET target_dispatch_date=? WHERE id=?', [target_dispatch_date || null, req.params.id]);
  req.flash('success', 'Target dispatch date updated.');
  res.redirect(`/jobs/${req.params.id}`);
});

module.exports = router;
