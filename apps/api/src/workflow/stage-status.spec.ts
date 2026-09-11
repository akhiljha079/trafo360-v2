import { computeStageStatus, RequirementForStatus } from "./stage-status";

function req(overrides: Partial<RequirementForStatus>): RequirementForStatus {
  return { mandatory: true, required: true, notApplicable: false, docStatus: "NONE", ...overrides };
}

describe("computeStageStatus", () => {
  it("is COMPLETED when a stage has no requirements at all", () => {
    expect(computeStageStatus([])).toBe("COMPLETED");
  });

  it("is INCOMPLETE when a mandatory requirement has no document", () => {
    expect(computeStageStatus([req({ docStatus: "NONE" })])).toBe("INCOMPLETE");
  });

  it("is NOT completed just because a document was uploaded - the core business rule", () => {
    // This is the exact case spec §73 calls out: "a stage should not
    // automatically become complete merely because a file exists."
    expect(computeStageStatus([req({ docStatus: "PENDING" })])).toBe("UNDER_REVIEW");
  });

  it("is COMPLETED only once every mandatory requirement is APPROVED", () => {
    expect(computeStageStatus([req({ docStatus: "APPROVED" }), req({ docStatus: "APPROVED" })])).toBe("COMPLETED");
  });

  it("is UNDER_REVIEW if one of several mandatory requirements is still pending", () => {
    expect(computeStageStatus([req({ docStatus: "APPROVED" }), req({ docStatus: "PENDING" })])).toBe(
      "UNDER_REVIEW",
    );
  });

  it("is INCOMPLETE (not UNDER_REVIEW) if a requirement was rejected and never resubmitted", () => {
    expect(computeStageStatus([req({ docStatus: "REJECTED" })])).toBe("INCOMPLETE");
  });

  it("ignores optional (non-mandatory) requirements entirely", () => {
    expect(computeStageStatus([req({ mandatory: false, docStatus: "NONE" })])).toBe("COMPLETED");
  });

  it("ignores a requirement overridden to not-applicable at the project level", () => {
    expect(computeStageStatus([req({ notApplicable: true, docStatus: "NONE" })])).toBe("COMPLETED");
  });

  it("ignores a requirement overridden to not-required at the project level", () => {
    expect(computeStageStatus([req({ required: false, docStatus: "NONE" })])).toBe("COMPLETED");
  });

  it("treats a mix of one N/A and one approved mandatory requirement as COMPLETED", () => {
    expect(computeStageStatus([req({ notApplicable: true }), req({ docStatus: "APPROVED" })])).toBe("COMPLETED");
  });
});
