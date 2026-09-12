import {
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  UploadOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Collapse, Input, message, Modal, Progress, Space, Tag, Typography, Upload } from "antd";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { DocumentDetailDrawer } from "./DocumentDetailDrawer";

interface Requirement {
  id: string;
  required: boolean;
  notApplicable: boolean;
  overrideReason: string | null;
  mandatory: boolean;
  documentType: { id: string; code: string; name: string };
  documentId: string | null;
  docStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
}
interface ProjectStage {
  id: string;
  status: "INCOMPLETE" | "UNDER_REVIEW" | "COMPLETED";
  stage: { id: string; code: string; name: string; sortOrder: number };
  parentStage: { id: string; code: string; name: string; sortOrder: number };
  requirements: Requirement[];
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  COMPLETED: <CheckCircleFilled style={{ color: "#52c41a" }} />,
  UNDER_REVIEW: <ClockCircleFilled style={{ color: "#faad14" }} />,
  INCOMPLETE: <ExclamationCircleFilled style={{ color: "#d9d9d9" }} />,
};

const DOC_STATUS_LABEL: Record<string, string> = {
  NONE: "Pending",
  PENDING: "Awaiting Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

// Not shown for NONE - there's no upload yet to put a clock on, the "no
// document" state is communicated by the Upload button itself.
const DOC_STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING: <ClockCircleFilled style={{ color: "#faad14" }} />,
  APPROVED: <CheckCircleFilled style={{ color: "#52c41a" }} />,
  REJECTED: <CloseCircleFilled style={{ color: "#ff4d4f" }} />,
};

export function ProjectWorkflowChecklist({ projectId, hasTemplate }: { projectId: string; hasTemplate: boolean }) {
  const qc = useQueryClient();
  const [overrideTarget, setOverrideTarget] = useState<Requirement | null>(null);
  const [reason, setReason] = useState("");
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [uploadingRequirementId, setUploadingRequirementId] = useState<string | null>(null);

  const workflowQuery = useQuery({
    queryKey: ["project-workflow", projectId],
    queryFn: () => api.get<ProjectStage[]>(`/projects/${projectId}/workflow`),
    // A document uploaded here often gets approved by someone else, in
    // their own session, sometime later - polling is what makes that
    // status change actually show up without the uploader having to
    // remember to hit reload themselves.
    refetchInterval: 15_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["project-workflow", projectId] });
  }

  async function instantiate() {
    await api.post(`/projects/${projectId}/workflow/instantiate`);
    message.success("Workflow checklist generated");
    invalidate();
  }

  async function submitOverride() {
    if (!overrideTarget) return;
    await api.patch(`/project-document-requirements/${overrideTarget.id}/override`, {
      notApplicable: !overrideTarget.notApplicable,
      reason,
    });
    setOverrideTarget(null);
    setReason("");
    invalidate();
  }

  async function uploadForRequirement(requirement: Requirement, file: File) {
    setUploadingRequirementId(requirement.id);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentTypeId", requirement.documentType.id);
    formData.append("projectDocumentRequirementId", requirement.id);
    formData.append("title", requirement.documentType.name);
    try {
      const uploaded = await api.upload<{ status: string }>(`/projects/${projectId}/documents`, formData);
      message.success(
        uploaded.status === "UNDER_REVIEW"
          ? `${requirement.documentType.name} uploaded successfully - awaiting approval`
          : `${requirement.documentType.name} uploaded and approved`,
      );
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploadingRequirementId(null);
    }
    return false;
  }

  if (!hasTemplate) {
    return (
      <Alert
        type="info"
        showIcon
        message="No workflow template assigned"
        description="Edit the project to assign a workflow template, then a document checklist can be generated."
      />
    );
  }

  const stages = workflowQuery.data ?? [];
  if (!workflowQuery.isLoading && stages.length === 0) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Workflow checklist not generated yet"
        action={
          <Button size="small" onClick={instantiate}>
            Generate checklist
          </Button>
        }
      />
    );
  }

  const completed = stages.filter((s) => s.status === "COMPLETED").length;
  const percent = stages.length ? Math.round((completed / stages.length) * 100) : 0;

  const byParent = new Map<string, { name: string; sortOrder: number; stages: ProjectStage[] }>();
  for (const s of stages) {
    const key = s.parentStage.id;
    if (!byParent.has(key)) byParent.set(key, { name: s.parentStage.name, sortOrder: s.parentStage.sortOrder, stages: [] });
    byParent.get(key)!.stages.push(s);
  }
  const parents = [...byParent.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Card title="Workflow Checklist" style={{ marginTop: 16 }}>
      <Progress percent={percent} status={percent === 100 ? "success" : "active"} />
      {parents.map((parent) => {
        const parentPercent = Math.round(
          (parent.stages.filter((s) => s.status === "COMPLETED").length / parent.stages.length) * 100,
        );
        return (
          <Collapse
            key={parent.name}
            style={{ marginTop: 12 }}
            items={[
              {
                key: parent.name,
                label: (
                  <Space>
                    <strong>{parent.name.toUpperCase()}</strong>
                    <Tag color={parentPercent === 100 ? "success" : "default"}>{parentPercent}%</Tag>
                  </Space>
                ),
                children: (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {parent.stages
                      .sort((a, b) => a.stage.sortOrder - b.stage.sortOrder)
                      .map((s) => (
                        <div key={s.id}>
                          <Space>
                            {STATUS_ICON[s.status]}
                            <Typography.Text strong>{s.stage.name}</Typography.Text>
                            <Tag>{s.status.replace(/_/g, " ")}</Tag>
                          </Space>
                          {s.requirements.length > 0 && (
                            <div style={{ marginLeft: 24, marginTop: 4 }}>
                              {s.requirements.map((r) => (
                                <div
                                  key={r.id}
                                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}
                                >
                                  <span>
                                    {r.notApplicable ? (
                                      <Typography.Text delete type="secondary">
                                        {r.documentType.name}
                                      </Typography.Text>
                                    ) : r.documentId ? (
                                      <Typography.Link onClick={() => setOpenDocumentId(r.documentId)}>
                                        {r.documentType.name}
                                      </Typography.Link>
                                    ) : (
                                      r.documentType.name
                                    )}
                                    {!r.mandatory && <Tag style={{ marginLeft: 8 }}>optional</Tag>}
                                  </span>
                                  <span>
                                    {r.notApplicable ? (
                                      <Tag>N/A</Tag>
                                    ) : (
                                      <Tag
                                        icon={DOC_STATUS_ICON[r.docStatus]}
                                        color={r.docStatus === "APPROVED" ? "success" : r.docStatus === "REJECTED" ? "error" : "warning"}
                                      >
                                        {DOC_STATUS_LABEL[r.docStatus]}
                                      </Tag>
                                    )}
                                    {!r.notApplicable && !r.documentId && (
                                      <Upload
                                        showUploadList={false}
                                        disabled={uploadingRequirementId === r.id}
                                        beforeUpload={(file) => uploadForRequirement(r, file)}
                                      >
                                        <Button
                                          type="link"
                                          size="small"
                                          icon={<UploadOutlined />}
                                          loading={uploadingRequirementId === r.id}
                                        >
                                          Upload
                                        </Button>
                                      </Upload>
                                    )}
                                    <Button type="link" size="small" onClick={() => setOverrideTarget(r)}>
                                      {r.notApplicable ? "Restore" : "Mark N/A"}
                                    </Button>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </Space>
                ),
              },
            ]}
          />
        );
      })}

      <Modal
        title={overrideTarget?.notApplicable ? "Restore requirement" : "Mark as Not Applicable"}
        open={!!overrideTarget}
        onCancel={() => setOverrideTarget(null)}
        onOk={submitOverride}
        okButtonProps={{ disabled: !reason }}
      >
        <Typography.Paragraph>
          {overrideTarget?.documentType.name} — every override is audited with the reason you give here.
        </Typography.Paragraph>
        <Input.TextArea rows={3} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>

      <DocumentDetailDrawer
        documentId={openDocumentId}
        onClose={() => {
          setOpenDocumentId(null);
          invalidate();
        }}
      />
    </Card>
  );
}
