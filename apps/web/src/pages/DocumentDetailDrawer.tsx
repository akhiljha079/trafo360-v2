import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Form, Input, message, Modal, Popconfirm, Select, Space, Tag, Timeline, Typography, Upload } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined, UploadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { FilePreviewModal } from "../layout/FilePreviewModal";

interface Approval {
  id: string;
  decision: string;
  comment: string | null;
  approver: { id: string; name: string } | null;
  decidedAt: string | null;
}
interface Version {
  id: string;
  versionNo: number;
  fileName: string;
  mimeType: string;
  status: string;
  storageStatus: string;
  revisionReason: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
  approvals: Approval[];
}
interface DocumentDetail {
  id: string;
  title: string;
  status: string;
  documentTypeId: string;
  confidentialityLevelId: string;
  versions: Version[];
}
interface DocumentType {
  id: string;
  name: string;
}
interface ConfidentialityLevel {
  id: string;
  name: string;
}

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "success",
  REJECTED: "error",
  UNDER_REVIEW: "warning",
  UPLOADED: "processing",
  SUPERSEDED: "default",
  DRAFT: "default",
};

export function DocumentDetailDrawer({
  documentId,
  onClose,
}: {
  documentId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [comment, setComment] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null);
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [editForm] = Form.useForm();
  const canEdit = useAuth((s) => s.hasPermission("document.edit"));
  const canDelete = useAuth((s) => s.hasPermission("document.delete"));

  const query = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.get<DocumentDetail>(`/documents/${documentId}`),
    enabled: !!documentId,
    // An approval decision often comes from someone else's session - polls
    // while this drawer is open so a pending version's status doesn't sit
    // stale until the viewer manually reloads.
    refetchInterval: 15_000,
  });
  const documentTypesQuery = useQuery({
    queryKey: ["document-types"],
    queryFn: () => api.get<DocumentType[]>("/document-types"),
    enabled: editOpen,
  });
  const confidentialityQuery = useQuery({
    queryKey: ["confidentiality-levels"],
    queryFn: () => api.get<ConfidentialityLevel[]>("/confidentiality-levels"),
    enabled: editOpen,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["document", documentId] });
    qc.invalidateQueries({ queryKey: ["project-workflow"] });
    qc.invalidateQueries({ queryKey: ["document-library"] });
  }

  async function onEdit() {
    const values = await editForm.validateFields();
    try {
      await api.patch(`/documents/${documentId}`, values);
      message.success("Document updated");
      setEditOpen(false);
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function onDelete() {
    try {
      await api.delete(`/documents/${documentId}`);
      message.success("Document deleted");
      invalidate();
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  async function decide(approvalId: string, action: "approve" | "reject") {
    try {
      await api.post(`/document-approvals/${approvalId}/${action}`, { comment: comment[approvalId] });
      message.success(action === "approve" ? "Approved" : "Rejected");
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  async function uploadNewVersion(file: File) {
    setUploadingVersion(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const uploaded = await api.upload<{ status: string }>(`/documents/${documentId}/versions`, formData);
      message.success(
        uploaded.status === "UNDER_REVIEW" ? "New version uploaded - awaiting approval" : "New version uploaded and approved",
      );
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploadingVersion(false);
    }
    return false; // prevent antd Upload's own auto-submit
  }

  return (
    <Drawer title={query.data?.title} open={!!documentId} onClose={onClose} width={520}>
      {query.data && (
        <>
          <Tag color={STATUS_COLOR[query.data.status] ?? "default"} style={{ marginBottom: 16 }}>
            {query.data.status.replace(/_/g, " ")}
          </Tag>

          <Space style={{ marginBottom: 16 }} wrap>
            <Upload beforeUpload={uploadNewVersion} showUploadList={false} disabled={uploadingVersion}>
              <Button icon={<UploadOutlined />} loading={uploadingVersion}>
                Upload new version
              </Button>
            </Upload>
            {canEdit && (
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  editForm.setFieldsValue({
                    title: query.data!.title,
                    documentTypeId: query.data!.documentTypeId,
                    confidentialityLevelId: query.data!.confidentialityLevelId,
                  });
                  setEditOpen(true);
                }}
              >
                Edit
              </Button>
            )}
            {canDelete && (
              <Popconfirm
                title="Delete this document?"
                description="This permanently removes every version and its approval history."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={onDelete}
              >
                <Button danger icon={<DeleteOutlined />}>
                  Delete
                </Button>
              </Popconfirm>
            )}
          </Space>

          <Timeline
            items={query.data.versions.map((v) => ({
              color: v.status === "APPROVED" ? "green" : v.status === "REJECTED" ? "red" : "blue",
              children: (
                <div>
                  <Space>
                    <Typography.Text strong>Version {v.versionNo}</Typography.Text>
                    <Tag color={STATUS_COLOR[v.status] ?? "default"}>{v.status.replace(/_/g, " ")}</Tag>
                    {v.storageStatus === "LOCAL_PENDING_SYNC" && <Tag color="orange">syncing to NFS</Tag>}
                  </Space>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {v.uploadedBy.name} · {new Date(v.createdAt).toLocaleString()}
                  </div>
                  {v.revisionReason && <div style={{ fontSize: 12 }}>Reason: {v.revisionReason}</div>}
                  <Space size="small">
                    <Button type="link" size="small" style={{ padding: 0 }} icon={<EyeOutlined />} onClick={() => setPreviewVersion(v)}>
                      View
                    </Button>
                    <a href={api.downloadUrl(v.id)} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  </Space>

                  {v.approvals.map((a) => (
                    <div key={a.id} style={{ marginTop: 8, padding: 8, background: "#fafafa", borderRadius: 4 }}>
                      {a.decision === "PENDING" ? (
                        <Space direction="vertical" style={{ width: "100%" }}>
                          <Input.TextArea
                            rows={1}
                            placeholder="Comment (optional)"
                            value={comment[a.id] ?? ""}
                            onChange={(e) => setComment((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          />
                          <Space>
                            <Button size="small" type="primary" onClick={() => decide(a.id, "approve")}>
                              Approve
                            </Button>
                            <Button size="small" danger onClick={() => decide(a.id, "reject")}>
                              Reject
                            </Button>
                          </Space>
                        </Space>
                      ) : (
                        <div style={{ fontSize: 12 }}>
                          <Tag color={a.decision === "APPROVED" ? "success" : "error"}>{a.decision}</Tag>
                          {a.approver?.name} {a.comment && `— "${a.comment}"`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ),
            }))}
          />
        </>
      )}

      <Modal
        title="Edit Document"
        open={editOpen}
        onOk={onEdit}
        onCancel={() => setEditOpen(false)}
        okText="Save"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Corrects the title/type/confidentiality level only - upload a new version for a corrected
          file.
        </Typography.Paragraph>
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="documentTypeId" label="Document Type">
            <Select options={documentTypesQuery.data?.map((t) => ({ value: t.id, label: t.name }))} />
          </Form.Item>
          <Form.Item name="confidentialityLevelId" label="Confidentiality Level">
            <Select options={confidentialityQuery.data?.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      {previewVersion && (
        <FilePreviewModal
          open={!!previewVersion}
          onClose={() => setPreviewVersion(null)}
          title={`${query.data?.title} - v${previewVersion.versionNo}`}
          mimeType={previewVersion.mimeType}
          previewUrl={api.previewUrl(previewVersion.id)}
          downloadUrl={api.downloadUrl(previewVersion.id)}
        />
      )}
    </Drawer>
  );
}
