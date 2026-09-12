import { DeleteOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Descriptions, Drawer, Form, Image, Input, message, Modal, Popconfirm, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";

interface FileIssueTransaction {
  id: string;
  status: string;
  purpose: string | null;
  dueDate: string | null;
  issueDate: string | null;
  requester: { id: string; name: string };
  issuedBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
}
interface PhysicalFile {
  id: string;
  fileCode: string;
  status: string;
  building: string | null;
  floor: string | null;
  room: string | null;
  rack: string | null;
  shelf: string | null;
  box: string | null;
  project: { id: string; projectNo: string; name: string; customer: { name: string } };
  confidentialityLevel: { code: string; name: string };
}
interface LabelData {
  fileCode: string;
  projectNo: string;
  projectName: string;
  customerName: string;
  confidentiality: string;
  location: string;
  qrDataUrl: string;
}
interface IndexDocument {
  id: string;
  title: string;
  status: string;
  documentType: { name: string };
  versions: { versionNo: number }[];
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "success",
  ISSUED: "processing",
  ARCHIVED: "default",
  LOST: "error",
};
const TX_STATUS_COLOR: Record<string, string> = {
  REQUESTED: "default",
  APPROVED: "blue",
  ISSUED: "processing",
  RETURNED: "success",
  OVERDUE: "error",
  EXTENSION_REQUESTED: "warning",
  REJECTED: "error",
};

export function PhysicalFileDrawer({ physicalFileId, onClose }: { physicalFileId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const canManage = useAuth((s) => s.hasPermission("physical_file.create"));
  const [locationForm] = Form.useForm();
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestDueDate, setRequestDueDate] = useState<dayjs.Dayjs | null>(null);
  const [requestPurpose, setRequestPurpose] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);

  const fileQuery = useQuery({
    queryKey: ["physical-file", physicalFileId],
    queryFn: () => api.get<PhysicalFile>(`/physical-files/${physicalFileId}`),
    enabled: !!physicalFileId,
  });
  const transactionsQuery = useQuery({
    queryKey: ["file-issues", physicalFileId],
    queryFn: () => api.get<FileIssueTransaction[]>(`/file-issues?physicalFileId=${physicalFileId}`),
    enabled: !!physicalFileId,
  });
  const labelQuery = useQuery({
    queryKey: ["physical-file-label", physicalFileId],
    queryFn: () => api.get<LabelData>(`/physical-files/${physicalFileId}/label`),
    enabled: labelOpen && !!physicalFileId,
  });
  // The index page lists every approved document for this project, in the
  // order they'd actually be filed - it's what makes a printed physical
  // file a real indexed dossier rather than just a label with a QR code on
  // it. Only fetched once the print modal is actually open.
  const indexQuery = useQuery({
    queryKey: ["physical-file-index", fileQuery.data?.project.id],
    queryFn: () => api.get<IndexDocument[]>(`/projects/${fileQuery.data!.project.id}/documents`),
    enabled: labelOpen && !!fileQuery.data,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["physical-file", physicalFileId] });
    qc.invalidateQueries({ queryKey: ["file-issues", physicalFileId] });
    qc.invalidateQueries({ queryKey: ["physical-files-list"] });
  }

  async function saveLocation() {
    const values = await locationForm.validateFields();
    try {
      await api.patch(`/physical-files/${physicalFileId}/location`, values);
      message.success("Location updated");
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to save location");
    }
  }

  async function submitRequest() {
    if (!requestDueDate) return;
    try {
      await api.post(`/physical-files/${physicalFileId}/issue-requests`, {
        purpose: requestPurpose,
        dueDate: requestDueDate.toISOString(),
      });
      message.success("File requested");
      setRequestOpen(false);
      setRequestPurpose("");
      setRequestDueDate(null);
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to request file");
    }
  }

  async function act(id: string, action: "approve" | "issue" | "return") {
    try {
      if (action === "return") {
        await api.post(`/file-issues/${id}/return`, {});
      } else {
        await api.post(`/file-issues/${id}/${action}`, {});
      }
      message.success("Done");
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  async function onDelete() {
    if (!fileQuery.data) return;
    try {
      await api.delete(`/physical-files/${physicalFileId}`);
      message.success("Physical file deleted");
      qc.invalidateQueries({ queryKey: ["physical-file-for-project", fileQuery.data.project.id] });
      qc.invalidateQueries({ queryKey: ["physical-files-list"] });
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  const relevantTransactions = transactionsQuery.data ?? [];

  return (
    <Drawer title={fileQuery.data?.fileCode} open={!!physicalFileId} onClose={onClose} width={560}>
      {fileQuery.data && (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Tag color={STATUS_COLOR[fileQuery.data.status] ?? "default"}>{fileQuery.data.status}</Tag>
            <Tag>{fileQuery.data.confidentialityLevel.name}</Tag>
          </Space>

          <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Project">
              {fileQuery.data.project.projectNo} — {fileQuery.data.project.name}
            </Descriptions.Item>
            <Descriptions.Item label="Customer">{fileQuery.data.project.customer.name}</Descriptions.Item>
          </Descriptions>

          <Form
            form={locationForm}
            layout="vertical"
            initialValues={{
              building: fileQuery.data.building,
              floor: fileQuery.data.floor,
              room: fileQuery.data.room,
              rack: fileQuery.data.rack,
              shelf: fileQuery.data.shelf,
              box: fileQuery.data.box,
            }}
          >
            <Space wrap>
              <Form.Item name="building" label="Building" style={{ width: 140 }}>
                <Input />
              </Form.Item>
              <Form.Item name="floor" label="Floor" style={{ width: 100 }}>
                <Input />
              </Form.Item>
              <Form.Item name="room" label="Room" style={{ width: 140 }}>
                <Input />
              </Form.Item>
              <Form.Item name="rack" label="Rack" style={{ width: 100 }}>
                <Input />
              </Form.Item>
              <Form.Item name="shelf" label="Shelf" style={{ width: 100 }}>
                <Input />
              </Form.Item>
              <Form.Item name="box" label="Box" style={{ width: 100 }}>
                <Input />
              </Form.Item>
            </Space>
            <Button onClick={saveLocation}>Save location</Button>
          </Form>

          <Space style={{ margin: "16px 0" }}>
            <Button onClick={() => setLabelOpen(true)}>View QR / Label / Index</Button>
            {fileQuery.data.status === "AVAILABLE" && (
              <Button type="primary" onClick={() => setRequestOpen(true)}>
                Request this file
              </Button>
            )}
            {canManage && fileQuery.data.status !== "ISSUED" && (
              <Popconfirm
                title="Delete this physical file record?"
                description="Only possible if it has no issue/return history yet."
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

          <Typography.Title level={5}>Issue History</Typography.Title>
          <Table
            rowKey="id"
            size="small"
            dataSource={relevantTransactions}
            pagination={false}
            columns={[
              { title: "Requester", dataIndex: ["requester", "name"] },
              { title: "Due", dataIndex: "dueDate", render: (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—") },
              {
                title: "Status",
                dataIndex: "status",
                render: (v: string) => <Tag color={TX_STATUS_COLOR[v] ?? "default"}>{v.replace(/_/g, " ")}</Tag>,
              },
              {
                title: "",
                render: (_, t) => (
                  <Space>
                    {t.status === "REQUESTED" && (
                      <Button size="small" onClick={() => act(t.id, "approve")}>
                        Approve
                      </Button>
                    )}
                    {(t.status === "REQUESTED" || t.status === "APPROVED") && (
                      <Button size="small" type="primary" onClick={() => act(t.id, "issue")}>
                        Issue
                      </Button>
                    )}
                    {(t.status === "ISSUED" || t.status === "OVERDUE") && (
                      <Button size="small" onClick={() => act(t.id, "return")}>
                        Return
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </>
      )}

      <Modal title="Request this physical file" open={requestOpen} onCancel={() => setRequestOpen(false)} onOk={submitRequest}>
        <Form layout="vertical">
          <Form.Item label="Purpose">
            <Input.TextArea rows={2} value={requestPurpose} onChange={(e) => setRequestPurpose(e.target.value)} />
          </Form.Item>
          <Form.Item label="Required until" required>
            <DatePicker style={{ width: "100%" }} value={requestDueDate} onChange={setRequestDueDate} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Label / Index" open={labelOpen} onCancel={() => setLabelOpen(false)} footer={null} width={640}>
        <style>{`
          @media print {
            .pf-modal-chrome { display: none !important; }
            .pf-print-page { page-break-after: always; border: none !important; }
            .pf-print-page:last-child { page-break-after: auto; }
          }
        `}</style>
        <Typography.Paragraph type="secondary" className="pf-modal-chrome" style={{ marginBottom: 16 }}>
          Printed order: this label sheet first, then the document index below it - insert the
          actual physical documents into the folder after the index, in the order listed.
        </Typography.Paragraph>

        {labelQuery.data && (
          <div className="pf-print-page" style={{ textAlign: "center", border: "1px solid #eee", padding: 16, marginBottom: 24 }}>
            <Typography.Title level={5}>TRAFO 360 — Project File</Typography.Title>
            <Typography.Text strong>Project No: </Typography.Text>
            {labelQuery.data.projectNo}
            <br />
            <Typography.Text strong>Customer: </Typography.Text>
            {labelQuery.data.customerName}
            <br />
            <Typography.Text strong>Confidentiality: </Typography.Text>
            {labelQuery.data.confidentiality}
            <br />
            <Typography.Text strong>Location: </Typography.Text>
            {labelQuery.data.location || "—"}
            <br />
            <Image src={labelQuery.data.qrDataUrl} width={160} preview={false} style={{ margin: "12px 0" }} />
            <br />
            <Typography.Text code>{labelQuery.data.fileCode}</Typography.Text>
          </div>
        )}

        <div className="pf-print-page" style={{ border: "1px solid #eee", padding: 16 }}>
          <Typography.Title level={5} style={{ textAlign: "center" }}>
            Document Index
          </Typography.Title>
          <Typography.Text type="secondary" style={{ display: "block", textAlign: "center", marginBottom: 12 }}>
            {labelQuery.data?.projectNo} — {labelQuery.data?.projectName}
          </Typography.Text>
          <Table
            size="small"
            pagination={false}
            loading={indexQuery.isLoading}
            dataSource={indexQuery.data ?? []}
            rowKey="id"
            locale={{ emptyText: "No documents uploaded for this project yet." }}
            columns={[
              { title: "#", render: (_, __, i) => i + 1, width: 40 },
              { title: "Document Type", dataIndex: ["documentType", "name"] },
              { title: "Title", dataIndex: "title" },
              { title: "Version", render: (_, d) => `v${d.versions[0]?.versionNo ?? "—"}` },
              {
                title: "Status",
                dataIndex: "status",
                render: (v: string) => <Tag color={v === "APPROVED" ? "success" : "default"}>{v.replace(/_/g, " ")}</Tag>,
              },
            ]}
          />
        </div>

        <div className="pf-modal-chrome" style={{ marginTop: 16, textAlign: "center" }}>
          <Button onClick={() => window.print()}>Print</Button>
        </div>
      </Modal>
    </Drawer>
  );
}
