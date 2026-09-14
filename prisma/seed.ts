import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from "@trafo360/shared";

const prisma = new PrismaClient();

// Permissions and default role grants (spec §9/§10) come from
// libs/shared/src/permissions.ts - the actual single source of truth (this
// file used to keep its own duplicate copy, which is exactly the kind of
// drift that comment warns against: a permission added there never reached
// the seeded DB until this got fixed alongside the certificate.* additions).
const ROLE_PERMISSIONS: Record<string, string[]> = DEFAULT_ROLE_PERMISSIONS;

// ---------------------------------------------------------------------------
// Departments (spec §8 defaults)
// ---------------------------------------------------------------------------
const DEPARTMENTS: Array<{ code: string; name: string }> = [
  { code: "SALES", name: "Sales" },
  { code: "ENG", name: "Engineering" },
  { code: "PROC", name: "Procurement" },
  { code: "STORES", name: "Stores" },
  { code: "IQC", name: "Incoming Quality" },
  { code: "MFG", name: "Manufacturing" },
  { code: "PPC", name: "Production Planning" },
  { code: "IPQC", name: "In-Process Quality" },
  { code: "TEST", name: "Testing" },
  { code: "QA", name: "QA" },
  { code: "DISPATCH", name: "Dispatch" },
  { code: "COMM", name: "Commercial" },
  { code: "EXPORT", name: "Export" },
  { code: "DOCCTRL", name: "Document Control" },
  { code: "MGMT", name: "Management" },
  { code: "IT", name: "IT" },
  { code: "ADMIN", name: "Administration" },
];

// ---------------------------------------------------------------------------
// Confidentiality levels (spec §23 defaults)
// ---------------------------------------------------------------------------
const CONFIDENTIALITY_LEVELS = [
  { code: "PUBLIC", name: "Public", rank: 1, requiresApprovalForDownload: false, requiresApprovalForPhysicalIssue: false },
  { code: "INTERNAL", name: "Internal", rank: 2, requiresApprovalForDownload: false, requiresApprovalForPhysicalIssue: false },
  { code: "CONFIDENTIAL", name: "Confidential", rank: 3, requiresApprovalForDownload: false, requiresApprovalForPhysicalIssue: true },
  { code: "HIGHLY_CONFIDENTIAL", name: "Highly Confidential", rank: 4, requiresApprovalForDownload: true, requiresApprovalForPhysicalIssue: true },
  { code: "RESTRICTED", name: "Restricted", rank: 5, requiresApprovalForDownload: true, requiresApprovalForPhysicalIssue: true },
];

// ---------------------------------------------------------------------------
// Workflow template: "Transformer Manufacturing - Standard" (spec §13/§16-18)
// ---------------------------------------------------------------------------
type DocSeed = { code: string; name: string; mandatory?: boolean };
type StageSeed = { code: string; name: string; docs: DocSeed[]; department?: string };
type ParentStageSeed = { code: string; name: string; stages: StageSeed[] };

const WORKFLOW: ParentStageSeed[] = [
  {
    code: "SALES", name: "Sales", stages: [
      { code: "S1", name: "Enquiry / Requirement Review", docs: [], department: "SALES" },
      { code: "S2", name: "Quotation / Offer", docs: [{ code: "QUOTATION", name: "Quotation / Offer" }], department: "SALES" },
      {
        code: "S3", name: "Order / Contract Review", department: "SALES", docs: [
          { code: "CUST_PO", name: "Customer PO" },
          { code: "CUST_TECH_SPEC", name: "Customer Technical Specification" },
          { code: "CUST_ELEC_DWG", name: "Customer Electrical Drawing" },
          { code: "CUST_MECH_DWG", name: "Customer Mechanical Drawing" },
          { code: "CUST_GTP", name: "Customer GTP / Specification" },
        ],
      },
    ],
  },
  {
    code: "ENGINEERING", name: "Engineering", stages: [
      { code: "E1", name: "Design & Engineering", docs: [{ code: "DESIGN_CALC", name: "Design Calculation" }], department: "ENG" },
      { code: "E2", name: "GTP Preparation & Approval", docs: [{ code: "APPROVED_GTP", name: "Approved GTP" }], department: "ENG" },
      {
        code: "E3", name: "Design Release", department: "ENG", docs: [
          { code: "APPROVED_DESIGN", name: "Approved Design" },
          { code: "ELEC_DWG", name: "Electrical Drawing" },
          { code: "MECH_TANK_DWG", name: "Mechanical / Tank Drawing" },
        ],
      },
    ],
  },
  {
    code: "PROCUREMENT", name: "Procurement", stages: [
      {
        code: "P1", name: "Material Requirement Planning", department: "PROC", docs: [
          { code: "MRP", name: "MRP" }, { code: "RMC", name: "RMC" }, { code: "BOM", name: "BOM" },
        ],
      },
      { code: "P2", name: "Purchase Planning", docs: [{ code: "PURCHASE_REQ", name: "Purchase Requisition" }], department: "PROC" },
      {
        code: "P3", name: "Material Procurement", department: "PROC", docs: [
          { code: "SUPPLIER_PO", name: "Supplier PO" }, { code: "JOB_ORDER", name: "Job Order" },
        ],
      },
    ],
  },
  {
    code: "QUALITY_INCOMING", name: "Quality - Incoming", stages: [
      {
        code: "QI1", name: "Incoming Material Inspection", department: "IQC", docs: [
          { code: "INCOMING_QC", name: "Incoming Material QC" },
          { code: "MTC", name: "Material Test Certificate" },
          { code: "SUPPLIER_CERT", name: "Supplier Certificate" },
        ],
      },
      { code: "QI2", name: "Material Traceability", docs: [{ code: "TRACEABILITY", name: "Heat / Batch / Lot Traceability" }], department: "IQC" },
    ],
  },
  {
    code: "MANUFACTURING", name: "Manufacturing", stages: [
      { code: "MF1", name: "Core Manufacturing", docs: [{ code: "CORE_MFG", name: "Core Manufacturing Record" }], department: "MFG" },
      {
        code: "MF2", name: "HV & LV Winding", department: "MFG", docs: [
          { code: "YELLOW_CARD", name: "Yellow Card / Job Card" },
          { code: "HV_WINDING_QC", name: "HV Winding QC" },
          { code: "LV_WINDING_QC", name: "LV Winding QC" },
          { code: "WINDING_DIM", name: "Winding Dimension Report (ID/OD/Axial Length/Turns/Conductor/Insulation)" },
        ],
      },
      { code: "MF3", name: "Active Part Assembly", docs: [{ code: "ACTIVE_PART", name: "Active Part Assembly Report" }], department: "MFG" },
      {
        code: "MF4", name: "Tank Fabrication", department: "MFG", docs: [
          { code: "TANK_FAB", name: "Tank Fabrication Report" },
          { code: "TANK_INSPECTION", name: "Tank Inspection" },
          { code: "TANK_LEAK_TEST", name: "Tank Leak Test" },
        ],
      },
      { code: "MF5", name: "Tank Testing & Painting", docs: [{ code: "PAINTING_DFT", name: "Painting / DFT Record" }], department: "MFG" },
      {
        code: "MF6", name: "Drying & Tanking", department: "MFG", docs: [
          { code: "DRYING_RECORD", name: "Drying Record" },
          { code: "TANKING_RECORD", name: "Tanking Record" },
          { code: "PSR", name: "PSR" },
        ],
      },
      {
        code: "MF7", name: "Oil Filling & Final Assembly", department: "MFG", docs: [
          { code: "OIL_FILLING", name: "Oil Filling Record" },
          { code: "OIL_TEST", name: "Oil Test Report" },
        ],
      },
    ],
  },
  {
    code: "QUALITY_IN_PROCESS", name: "Quality - In Process", stages: [
      {
        code: "QP1", name: "In-Process Inspection", department: "IPQC", docs: [
          { code: "STAGE_INSPECTION", name: "Stage Inspection Report (Winding / Core Assembly / Tank with Accessories / PSR / Tanking)" },
        ],
      },
      { code: "QP2", name: "NCR Resolution", docs: [{ code: "NCR", name: "NCR / Corrective Action", mandatory: false }], department: "IPQC" },
    ],
  },
  {
    code: "FINAL_TESTING_QA", name: "Final Testing & QA", stages: [
      { code: "FT1", name: "Internal Testing", docs: [{ code: "INTERNAL_TEST", name: "Internal Testing Report" }], department: "TEST" },
      { code: "FT2", name: "Routine Testing", docs: [{ code: "ROUTINE_TEST", name: "Routine Test Report" }], department: "TEST" },
      { code: "FT3", name: "Final Inspection", docs: [{ code: "FINAL_INSPECTION", name: "Final Inspection Report" }], department: "QA" },
      {
        code: "FT4", name: "QA Release", department: "QA", docs: [
          { code: "QA_RELEASE", name: "QA Release" },
          { code: "CERT_CONFORMITY", name: "Certificate of Conformity" },
        ],
      },
    ],
  },
  {
    code: "DISPATCH", name: "Dispatch", stages: [
      {
        code: "D1", name: "Dispatch Clearance", department: "DISPATCH", docs: [
          { code: "DISPATCH_INSTR", name: "Dispatch Instruction Report" },
          { code: "DISPATCH_CLEARANCE", name: "Dispatch Clearance" },
          { code: "PACKING_INSPECTION", name: "Packing Inspection" },
        ],
      },
      {
        code: "D2", name: "Commercial Documentation", department: "COMM", docs: [
          { code: "INVOICE", name: "Invoice" },
          { code: "EWAY_BILL", name: "E-Way Bill" },
        ],
      },
      {
        code: "D3", name: "Packing & Logistics", department: "DISPATCH", docs: [
          { code: "PACKING_LIST", name: "Packing List" },
          { code: "LR_GR", name: "LR / GR" },
        ],
      },
      {
        code: "D4", name: "Warranty / Guarantee Documentation", department: "DISPATCH", docs: [
          { code: "WARRANTY_CERT", name: "Warranty Certificate" },
          { code: "GUARANTEE_CERT", name: "Guarantee Certificate" },
        ],
      },
    ],
  },
  {
    code: "EXPORT", name: "Export", stages: [
      {
        code: "EX1", name: "Export Documentation", department: "EXPORT", docs: [
          { code: "EXP_COMM_INVOICE", name: "Commercial Invoice", mandatory: false },
          { code: "EXP_PACKING_LIST", name: "Packing List (Export)", mandatory: false },
          { code: "EXP_SHIPPING_BILL", name: "Shipping Bill", mandatory: false },
          { code: "EXP_CERT_ORIGIN", name: "Certificate of Origin", mandatory: false },
          { code: "EXP_BOL_AWB", name: "Bill of Lading / Air Waybill", mandatory: false },
          { code: "EXP_INSURANCE", name: "Insurance", mandatory: false },
          { code: "EXP_INSPECTION_CERT", name: "Inspection Certificate", mandatory: false },
        ],
      },
    ],
  },
  {
    code: "PROJECT_CLOSURE", name: "Project Closure", stages: [
      { code: "PC1", name: "Project File Compilation", docs: [{ code: "PROJECT_DOSSIER", name: "Project Dossier / Document Register" }], department: "DOCCTRL" },
      { code: "PC2", name: "Document Handover & Closure", docs: [{ code: "HANDOVER_CERT", name: "Document Handover Certificate" }], department: "DOCCTRL" },
    ],
  },
];

async function main() {
  console.log("Seeding confidentiality levels...");
  const confidentiality = new Map<string, string>();
  for (const level of CONFIDENTIALITY_LEVELS) {
    const row = await prisma.confidentialityLevel.upsert({
      where: { code: level.code },
      update: level,
      create: level,
    });
    confidentiality.set(level.code, row.id);
  }

  console.log("Seeding permissions...");
  const permissionIds = new Map<string, string>();
  for (const perm of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { code: perm.code },
      update: { category: perm.category, description: perm.description },
      create: perm,
    });
    permissionIds.set(perm.code, row.id);
  }

  console.log("Seeding roles + role-permissions...");
  const roleIds = new Map<string, string>();
  for (const roleName of Object.keys(ROLE_PERMISSIONS)) {
    const isDirectorOrAbove = roleName === "System Administrator" || roleName === "Director";
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {
        isSystem: true,
        maxConfidentialityLevelId: isDirectorOrAbove ? confidentiality.get("RESTRICTED") : confidentiality.get("INTERNAL"),
      },
      create: {
        name: roleName,
        isSystem: true,
        maxConfidentialityLevelId: isDirectorOrAbove ? confidentiality.get("RESTRICTED") : confidentiality.get("INTERNAL"),
      },
    });
    roleIds.set(roleName, role.id);

    for (const code of ROLE_PERMISSIONS[roleName]) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) throw new Error(`Unknown permission code in seed: ${code}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }

  console.log("Seeding departments...");
  const departmentIds = new Map<string, string>();
  for (const dept of DEPARTMENTS) {
    const row = await prisma.department.upsert({ where: { code: dept.code }, update: { name: dept.name }, create: dept });
    departmentIds.set(dept.code, row.id);
  }

  console.log("Seeding bootstrap local administrator...");
  const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin";
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@trafo360.local";
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      name: "System Administrator (Local Bootstrap)",
      email: adminEmail,
      source: "LOCAL",
      passwordHash,
      status: "ACTIVE",
      roleId: roleIds.get("System Administrator"),
    },
  });

  console.log("Seeding workflow template: Transformer Manufacturing - Standard...");
  const template = await prisma.workflowTemplate.upsert({
    where: { name: "Transformer Manufacturing - Standard" },
    update: { active: true },
    create: { name: "Transformer Manufacturing - Standard", active: true, description: "Default Sales -> Engineering -> Procurement -> Quality -> Manufacturing -> Testing -> Dispatch -> Closure workflow for transformer orders." },
  });

  let parentSortOrder = 0;
  let docTypeCount = 0;
  for (const parent of WORKFLOW) {
    parentSortOrder += 1;
    const parentStage = await prisma.parentStage.upsert({
      where: { workflowTemplateId_code: { workflowTemplateId: template.id, code: parent.code } },
      update: { name: parent.name, sortOrder: parentSortOrder },
      create: { workflowTemplateId: template.id, code: parent.code, name: parent.name, sortOrder: parentSortOrder },
    });

    let stageSortOrder = 0;
    for (const stageSeed of parent.stages) {
      stageSortOrder += 1;
      const responsibleDepartmentId = stageSeed.department ? departmentIds.get(stageSeed.department) : undefined;
      const stage = await prisma.stage.upsert({
        where: { parentStageId_code: { parentStageId: parentStage.id, code: stageSeed.code } },
        update: { name: stageSeed.name, sortOrder: stageSortOrder, responsibleDepartmentId },
        create: {
          parentStageId: parentStage.id,
          code: stageSeed.code,
          name: stageSeed.name,
          sortOrder: stageSortOrder,
          responsibleDepartmentId,
        },
      });

      for (const doc of stageSeed.docs) {
        docTypeCount += 1;
        const documentType = await prisma.documentType.upsert({
          where: { code: doc.code },
          update: { name: doc.name },
          create: { code: doc.code, name: doc.name, confidentialityLevelId: confidentiality.get("INTERNAL") },
        });
        await prisma.stageDocumentRequirement.upsert({
          where: { stageId_documentTypeId: { stageId: stage.id, documentTypeId: documentType.id } },
          update: { mandatory: doc.mandatory ?? true },
          create: { stageId: stage.id, documentTypeId: documentType.id, mandatory: doc.mandatory ?? true },
        });
      }
    }
  }

  console.log("Seeding default notification templates...");
  const NOTIFICATION_TEMPLATES: { eventKey: string; channel: string; subject: string; body: string }[] = [
    {
      eventKey: "STAGE_DOCUMENT_UPLOADED",
      channel: "EMAIL",
      subject: "Document uploaded: {{documentTitle}} — {{projectNo}}",
      body: `<p><strong>{{uploadedByName}}</strong> uploaded <strong>{{documentTitle}}</strong> for stage <strong>{{stageName}}</strong>.</p>
<p>Project: {{projectNo}} — {{projectName}}<br/>Customer: {{customerName}}</p>`,
    },
    {
      eventKey: "PROJECT_CREATED_DEPARTMENT_NOTICE",
      channel: "EMAIL",
      subject: "New project {{projectNo}} — please send your documents",
      body: `<p>A new project has been created and needs your department's documents.</p>
<p>Project: {{projectNo}} — {{projectName}}<br/>Customer: {{customerName}}</p>
<p>Documents required from your department: <strong>{{documentList}}</strong></p>
<p>Please send these to <strong>{{documentCoordinatorName}}</strong> as soon as they're ready.</p>`,
    },
  ];
  for (const t of NOTIFICATION_TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { eventKey_channel: { eventKey: t.eventKey, channel: t.channel } },
      update: { subject: t.subject, body: t.body },
      create: t,
    });
  }

  console.log(`Seed complete: ${CONFIDENTIALITY_LEVELS.length} confidentiality levels, ${PERMISSIONS.length} permissions, ${Object.keys(ROLE_PERMISSIONS).length} roles, ${DEPARTMENTS.length} departments, 1 bootstrap admin, 1 workflow template with ${WORKFLOW.length} parent stages and ${docTypeCount} document types.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
