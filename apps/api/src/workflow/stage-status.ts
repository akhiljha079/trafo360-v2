/** Pure stage-completion rule (spec §73) - deliberately has zero DB/Nest
 * dependency so it's trivially unit-testable and can't drift into "any file
 * uploaded = done". A stage is COMPLETED only when every truly-required
 * requirement (mandatory, not overridden to optional, not marked N/A) has an
 * APPROVED current document version. */

export type RequirementDocStatus =
  | "NONE" // no document uploaded against this requirement yet
  | "PENDING" // uploaded, awaiting a decision (Draft/Uploaded/UnderReview)
  | "APPROVED"
  | "REJECTED";

export interface RequirementForStatus {
  mandatory: boolean;
  required: boolean;
  notApplicable: boolean;
  docStatus: RequirementDocStatus;
}

export type StageStatus = "INCOMPLETE" | "UNDER_REVIEW" | "COMPLETED";

export function computeStageStatus(requirements: RequirementForStatus[]): StageStatus {
  const trulyRequired = requirements.filter((r) => r.mandatory && r.required && !r.notApplicable);

  if (trulyRequired.length === 0) return "COMPLETED";
  if (trulyRequired.every((r) => r.docStatus === "APPROVED")) return "COMPLETED";
  if (trulyRequired.some((r) => r.docStatus === "PENDING")) return "UNDER_REVIEW";
  return "INCOMPLETE";
}
