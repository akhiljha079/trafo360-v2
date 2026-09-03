const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/dashboard', requireAuth, async (req, res) => {
  const [[{ activeJobs }]] = await pool.query(`SELECT COUNT(*) AS activeJobs FROM jobs WHERE status='Active' AND is_deleted=0`);
  const [[{ completedJobs }]] = await pool.query(`SELECT COUNT(*) AS completedJobs FROM jobs WHERE status='Completed' AND is_deleted=0`);
  const [jobsByPhase] = await pool.query(`
    SELECT s.phase, COUNT(*) AS cnt FROM jobs j JOIN stages s ON j.current_stage_id = s.id
    WHERE j.status='Active' AND j.is_deleted=0 GROUP BY s.phase`);
  const [recentJobs] = await pool.query(`
    SELECT j.*, s.stage_name, s.phase FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id
    WHERE j.is_deleted=0
    ORDER BY j.updated_at DESC LIMIT 8`);
  const [[{ issuedDocs }]] = await pool.query(`SELECT COUNT(*) AS issuedDocs FROM document_issues WHERE status IN ('Issued','Overdue')`);
  const [[{ overdueDocs }]] = await pool.query(`SELECT COUNT(*) AS overdueDocs FROM document_issues WHERE status IN ('Overdue','Escalated')`);
  const [[{ pendingApprovals }]] = await pool.query(`SELECT COUNT(*) AS pendingApprovals FROM document_issues WHERE status='Pending Approval'`);
  const [myIssues] = await pool.query(
    `SELECT di.*, d.doc_code, d.doc_name FROM document_issues di JOIN documents d ON di.document_id=d.id
     WHERE di.requested_by=? AND di.status IN ('Issued','Overdue','Escalated') ORDER BY di.due_date ASC LIMIT 5`,
    [req.session.user.id]
  );

  let pendingApprovalList = [];
  if (req.session.user.can_approve_document_issue) {
    [pendingApprovalList] = await pool.query(
      `SELECT di.*, d.doc_code, d.doc_name, u.name AS requester_name
       FROM document_issues di JOIN documents d ON di.document_id=d.id JOIN users u ON di.requested_by=u.id
       WHERE di.status='Pending Approval' ORDER BY di.created_at ASC LIMIT 10`
    );
  }

  res.render('dashboard', {
    title: 'Dashboard',
    activeJobs, completedJobs, jobsByPhase, recentJobs,
    issuedDocs, overdueDocs, pendingApprovals, myIssues, pendingApprovalList
  });
});

module.exports = router;
