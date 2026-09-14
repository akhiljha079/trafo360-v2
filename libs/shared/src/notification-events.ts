// Canonical notification event keys (spec §34/§60). Single source of truth
// so the seed data, the dispatch service, and the admin template/rule UI
// can never drift on what an event is actually called.

export const NOTIFICATION_EVENTS = {
  DOCUMENT_APPROVAL_PENDING: "DOCUMENT_APPROVAL_PENDING",
  DOCUMENT_APPROVED: "DOCUMENT_APPROVED",
  DOCUMENT_REJECTED: "DOCUMENT_REJECTED",
  FILE_ISSUE_REQUESTED: "FILE_ISSUE_REQUESTED",
  FILE_ISSUED: "FILE_ISSUED",
  FILE_DUE_TOMORROW: "FILE_DUE_TOMORROW",
  FILE_OVERDUE: "FILE_OVERDUE",
  FILE_EXTENSION_REQUESTED: "FILE_EXTENSION_REQUESTED",
  FILE_EXTENSION_APPROVED: "FILE_EXTENSION_APPROVED",
  FILE_EXTENSION_REJECTED: "FILE_EXTENSION_REJECTED",
  TYPE_TEST_CERTIFICATE_EXPIRING: "TYPE_TEST_CERTIFICATE_EXPIRING",
  /** Fired on every document upload that's tied to a workflow stage
   * requirement (ad-hoc uploads with no requirement have no stage/
   * department to resolve, so this doesn't fire for those). Goes to the
   * uploaded-for stage's responsible department head (e.g. Sales HOD for
   * a Sales-stage document) plus every System Administrator. */
  STAGE_DOCUMENT_UPLOADED: "STAGE_DOCUMENT_UPLOADED",
  /** Fired once per department head (every department that has one set)
   * when a new project is created - the "send your documents to the
   * Document Coordinator" kickoff notice, carrying project/customer
   * details so recipients know which order this is for. */
  PROJECT_CREATED_DEPARTMENT_NOTICE: "PROJECT_CREATED_DEPARTMENT_NOTICE",
} as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export const NOTIFICATION_EVENT_KEYS = Object.values(NOTIFICATION_EVENTS);
