import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Input, message, Space, Tag, Timeline, Typography, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { api, ApiError } from "../api/client";

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
  versions: Version[];
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

  const query = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.get<DocumentDetail>(`/documents/${documentId}`),
    enabled: !!documentId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["document", documentId] });
    qc.invalidateQueries({ queryKey: ["project-workflow"] });
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
    const formData = new FormData();
    formData.append("file", file);
    try {
      await api.upload(`/documents/${documentId}/versions`, formData);
      message.success("New version uploaded");
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Upload failed");
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

          <Upload beforeUpload={uploadNewVersion} showUploadList={false}>
            <Button icon={<UploadOutlined />} style={{ marginBottom: 16 }}>
              Upload new version
            </Button>
          </Upload>

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
                  <a href={api.downloadUrl(v.id)} target="_blank" rel="noreferrer">
                    Download
                  </a>

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
    </Drawer>
  );
}
