import { DeleteOutlined, DownloadOutlined, EditOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, message, Modal, Popconfirm, Table, Tag, Typography, Upload } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";

interface CertificateRow {
  id: string;
  transformerType: string;
  title: string;
  certificateNo: string | null;
  expiryDate: string;
  daysLeft: number;
  expiryStatus: "VALID" | "EXPIRING_SOON" | "EXPIRED";
  uploadedBy: { name: string };
}

const STATUS_COLOR: Record<string, string> = {
  VALID: "success",
  EXPIRING_SOON: "warning",
  EXPIRED: "error",
};

const STATUS_LABEL: Record<string, string> = {
  VALID: "Valid",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
};

export function TypeTestCertificatesPage() {
  const canManage = useAuth((s) => s.hasPermission("certificate.manage"));
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [renewTarget, setRenewTarget] = useState<CertificateRow | null>(null);
  const [renewForm] = Form.useForm();
  const [renewFile, setRenewFile] = useState<File | null>(null);
  const [editTarget, setEditTarget] = useState<CertificateRow | null>(null);
  const [editForm] = Form.useForm();
  const [busy, setBusy] = useState<"create" | "renew" | "edit" | null>(null);

  const query = useQuery({
    queryKey: ["type-test-certificates"],
    queryFn: () => api.get<CertificateRow[]>("/type-test-certificates"),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["type-test-certificates"] });
  }

  async function onCreate() {
    const values = await createForm.validateFields();
    if (!createFile) {
      message.error("Select a certificate file");
      return;
    }
    const formData = new FormData();
    formData.append("file", createFile);
    formData.append("transformerType", values.transformerType);
    formData.append("title", values.title);
    if (values.certificateNo) formData.append("certificateNo", values.certificateNo);
    formData.append("expiryDate", values.expiryDate.toISOString());
    setBusy("create");
    try {
      await api.upload("/type-test-certificates", formData);
      message.success("Certificate uploaded");
      setCreateOpen(false);
      createForm.resetFields();
      setCreateFile(null);
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function onEdit() {
    if (!editTarget) return;
    const values = await editForm.validateFields();
    setBusy("edit");
    try {
      await api.patch(`/type-test-certificates/${editTarget.id}`, values);
      message.success("Certificate updated");
      setEditTarget(null);
      editForm.resetFields();
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(cert: CertificateRow) {
    try {
      await api.delete(`/type-test-certificates/${cert.id}`);
      message.success("Certificate deleted");
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  async function onRenew() {
    if (!renewTarget) return;
    const values = await renewForm.validateFields();
    if (!renewFile) {
      message.error("Select the renewed certificate file");
      return;
    }
    const formData = new FormData();
    formData.append("file", renewFile);
    formData.append("expiryDate", values.expiryDate.toISOString());
    if (values.certificateNo) formData.append("certificateNo", values.certificateNo);
    setBusy("renew");
    try {
      await api.upload(`/type-test-certificates/${renewTarget.id}/renew`, formData);
      message.success("Certificate renewed");
      setRenewTarget(null);
      renewForm.resetFields();
      setRenewFile(null);
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Renewal failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>
            Type Test Certificates
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            One certificate per transformer type/rating - reminders go out to all administrators every 4 days once a
            certificate has a month or less left, until it's renewed.
          </Typography.Paragraph>
        </div>
        {canManage && (
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setCreateOpen(true)}>
            Upload Certificate
          </Button>
        )}
      </div>

      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        columns={[
          { title: "Transformer Type", dataIndex: "transformerType" },
          { title: "Title", dataIndex: "title" },
          { title: "Certificate No", dataIndex: "certificateNo", render: (v) => v ?? "—" },
          {
            title: "Expiry",
            render: (_, r) => (
              <span>
                {dayjs(r.expiryDate).format("DD-MMM-YYYY")}{" "}
                <Tag color={STATUS_COLOR[r.expiryStatus]}>
                  {STATUS_LABEL[r.expiryStatus]}
                  {r.expiryStatus !== "VALID" && ` (${r.daysLeft < 0 ? `${Math.abs(r.daysLeft)}d overdue` : `${r.daysLeft}d left`})`}
                </Tag>
              </span>
            ),
          },
          { title: "Uploaded By", dataIndex: ["uploadedBy", "name"] },
          {
            title: "Actions",
            render: (_, r) => (
              <span style={{ display: "flex", gap: 8 }}>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  href={`/api/type-test-certificates/${r.id}/download`}
                  target="_blank"
                >
                  Download
                </Button>
                {canManage && (
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => setRenewTarget(r)}>
                    Renew
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditTarget(r);
                      editForm.setFieldsValue({
                        transformerType: r.transformerType,
                        title: r.title,
                        certificateNo: r.certificateNo,
                      });
                    }}
                  >
                    Edit
                  </Button>
                )}
                {canManage && (
                  <Popconfirm
                    title="Delete this certificate?"
                    description="This removes the record and its file reference permanently."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onDelete(r)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      Delete
                    </Button>
                  </Popconfirm>
                )}
              </span>
            ),
          },
        ]}
      />

      <Modal
        title="Upload Type Test Certificate"
        open={createOpen}
        onOk={onCreate}
        confirmLoading={busy === "create"}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
          setCreateFile(null);
        }}
        okText="Upload"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="transformerType" label="Transformer Type / Rating" rules={[{ required: true }]}>
            <Input placeholder="e.g. 10 MVA, 33/11 kV" />
          </Form.Item>
          <Form.Item name="title" label="Certificate Title" rules={[{ required: true }]}>
            <Input placeholder="e.g. Type Test Certificate - Temperature Rise" />
          </Form.Item>
          <Form.Item name="certificateNo" label="Certificate No (optional)">
            <Input />
          </Form.Item>
          <Form.Item name="expiryDate" label="Expiry Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Certificate File (PDF/JPG/PNG)" required>
            <Upload
              maxCount={1}
              beforeUpload={(file) => {
                setCreateFile(file);
                return false;
              }}
              onRemove={() => setCreateFile(null)}
            >
              <Button icon={<UploadOutlined />}>Select file</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Renew Certificate - ${renewTarget?.title ?? ""}`}
        open={!!renewTarget}
        onOk={onRenew}
        confirmLoading={busy === "renew"}
        onCancel={() => {
          setRenewTarget(null);
          renewForm.resetFields();
          setRenewFile(null);
        }}
        okText="Renew"
      >
        <Form form={renewForm} layout="vertical">
          <Form.Item name="certificateNo" label="Certificate No (optional)" initialValue={renewTarget?.certificateNo}>
            <Input />
          </Form.Item>
          <Form.Item name="expiryDate" label="New Expiry Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Renewed Certificate File (PDF/JPG/PNG)" required>
            <Upload
              maxCount={1}
              beforeUpload={(file) => {
                setRenewFile(file);
                return false;
              }}
              onRemove={() => setRenewFile(null)}
            >
              <Button icon={<UploadOutlined />}>Select file</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit Certificate - ${editTarget?.title ?? ""}`}
        open={!!editTarget}
        onOk={onEdit}
        confirmLoading={busy === "edit"}
        onCancel={() => {
          setEditTarget(null);
          editForm.resetFields();
        }}
        okText="Save"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Corrects details only - the file and expiry date aren't changed here, use Renew for that.
        </Typography.Paragraph>
        <Form form={editForm} layout="vertical">
          <Form.Item name="transformerType" label="Transformer Type / Rating" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="Certificate Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="certificateNo" label="Certificate No (optional)">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
