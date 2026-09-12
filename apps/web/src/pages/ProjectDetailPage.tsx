import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Row,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { PhysicalFileDrawer } from "./PhysicalFileDrawer";
import { ProjectWorkflowChecklist } from "./ProjectWorkflowChecklist";

interface ProjectDetail {
  id: string;
  projectNo: string;
  name: string;
  status: string;
  customerPo: string | null;
  transformerSerial: string | null;
  transformerType: string | null;
  rating: string | null;
  voltage: string | null;
  quantity: number;
  location: string | null;
  targetDeliveryDate: string | null;
  actualDispatchDate: string | null;
  remarks: string | null;
  customer: { id: string; name: string; code: string };
  projectManager: { id: string; name: string } | null;
  documentCoordinator: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  confidentialityLevel: { code: string; name: string };
  workflowTemplate: { id: string; name: string } | null;
  members: { user: { id: string; name: string; username: string }; roleInProject: string | null }[];
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [addUserId, setAddUserId] = useState<string | undefined>();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  // Deliberately a role check, not a permission check - project.edit is
  // also granted to Document Coordinator by default (they need it for
  // day-to-day project setup fields), but editing/removing a project here
  // is admin-only by explicit request, independent of whatever the
  // permission system happens to grant.
  const isAdmin = useAuth((s) => s.user?.roleName === "System Administrator");

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
    retry: false,
  });
  const usersQuery = useQuery({
    queryKey: ["users-for-member"],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/users?pageSize=200"),
  });
  const workflowTemplatesQuery = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/workflow-templates"),
  });
  const [physicalFileDrawerOpen, setPhysicalFileDrawerOpen] = useState(false);
  const physicalFileQuery = useQuery({
    queryKey: ["physical-file-for-project", id],
    queryFn: () => api.get<{ id: string; fileCode: string } | null>(`/physical-files/projects/${id}`),
    enabled: !!id,
  });

  async function createPhysicalFile() {
    await api.post(`/physical-files/projects/${id}`);
    qc.invalidateQueries({ queryKey: ["physical-file-for-project", id] });
  }

  async function addMember() {
    if (!addUserId) return;
    await api.post(`/projects/${id}/members`, { userId: addUserId });
    setAddUserId(undefined);
    qc.invalidateQueries({ queryKey: ["project", id] });
  }

  async function removeMember(userId: string) {
    await api.delete(`/projects/${id}/members/${userId}`);
    qc.invalidateQueries({ queryKey: ["project", id] });
  }

  async function onEditSave() {
    const values = await editForm.validateFields();
    try {
      await api.patch(`/projects/${id}`, {
        ...values,
        targetDeliveryDate: values.targetDeliveryDate?.toISOString(),
        actualDispatchDate: values.actualDispatchDate?.toISOString(),
      });
      message.success("Project updated");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function onDelete() {
    try {
      await api.delete(`/projects/${id}`);
      message.success("Project deleted");
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  if (projectQuery.error instanceof ApiError && projectQuery.error.status === 403) {
    return (
      <Alert
        type="error"
        showIcon
        message="Access denied"
        description="This project's confidentiality level exceeds your access."
      />
    );
  }
  if (!projectQuery.data) return null;
  const p = projectQuery.data;

  return (
    <div>
      <Button type="link" onClick={() => navigate("/projects")} style={{ paddingLeft: 0 }}>
        ← All Projects
      </Button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Typography.Title level={3} style={{ marginBottom: 8 }}>
          {p.projectNo} — {p.name}
        </Typography.Title>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                editForm.setFieldsValue({
                  ...p,
                  workflowTemplateId: p.workflowTemplate?.id,
                  targetDeliveryDate: p.targetDeliveryDate ? dayjs(p.targetDeliveryDate) : undefined,
                  actualDispatchDate: p.actualDispatchDate ? dayjs(p.actualDispatchDate) : undefined,
                });
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
            <Popconfirm
              title="Delete this project?"
              description="Only possible if it has no documents, physical files, or other records tied to it yet."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={onDelete}
            >
              <Button danger icon={<DeleteOutlined />}>
                Delete
              </Button>
            </Popconfirm>
          </div>
        )}
      </div>
      <div style={{ marginBottom: 16 }}>
        <Tag color="blue">{p.status.replace(/_/g, " ")}</Tag>
        <Tag>{p.confidentialityLevel.name}</Tag>
      </div>

      <Row gutter={16}>
        <Col span={16}>
          <Card title="Project Information" style={{ marginBottom: 16 }}>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Customer">{p.customer.name}</Descriptions.Item>
              <Descriptions.Item label="Customer PO">{p.customerPo ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Transformer Type">{p.transformerType ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Rating">{p.rating ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Voltage">{p.voltage ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Quantity">{p.quantity}</Descriptions.Item>
              <Descriptions.Item label="Serial No">{p.transformerSerial ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Location">{p.location ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Target Delivery">
                {p.targetDeliveryDate ? new Date(p.targetDeliveryDate).toLocaleDateString() : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Actual Dispatch">
                {p.actualDispatchDate ? new Date(p.actualDispatchDate).toLocaleDateString() : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Project Manager">{p.projectManager?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Document Coordinator">{p.documentCoordinator?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Department">{p.department?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Workflow Template">{p.workflowTemplate?.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Remarks" span={2}>
                {p.remarks ?? "—"}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <ProjectWorkflowChecklist projectId={p.id} hasTemplate={!!p.workflowTemplate} />
        </Col>

        <Col span={8}>
          <Card title="Physical File" style={{ marginBottom: 16 }}>
            {physicalFileQuery.data ? (
              <Button block onClick={() => setPhysicalFileDrawerOpen(true)}>
                {physicalFileQuery.data.fileCode}
              </Button>
            ) : (
              <Button block onClick={createPhysicalFile}>
                Create physical file record
              </Button>
            )}
          </Card>

          <Card title="Project Members">
            <Table
              rowKey={(r) => r.user.id}
              dataSource={p.members}
              pagination={false}
              size="small"
              columns={[
                { title: "Name", dataIndex: ["user", "name"] },
                {
                  title: "",
                  render: (_, r) => (
                    <Button type="link" danger size="small" onClick={() => removeMember(r.user.id)}>
                      Remove
                    </Button>
                  ),
                },
              ]}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Add member"
                style={{ flex: 1 }}
                value={addUserId}
                onChange={setAddUserId}
                options={usersQuery.data?.items
                  .filter((u) => !p.members.some((m) => m.user.id === u.id))
                  .map((u) => ({ value: u.id, label: u.name }))}
              />
              <Button onClick={addMember} disabled={!addUserId}>
                Add
              </Button>
            </div>
          </Card>
        </Col>
      </Row>

      <PhysicalFileDrawer
        physicalFileId={physicalFileDrawerOpen ? (physicalFileQuery.data?.id ?? null) : null}
        onClose={() => setPhysicalFileDrawerOpen(false)}
      />

      <Modal title="Edit Project" open={editOpen} onOk={onEditSave} onCancel={() => setEditOpen(false)} okText="Save" width={640}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="Project name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="workflowTemplateId"
            label="Workflow template"
            extra="Assigning or changing this generates the document checklist for that template - existing uploaded documents are kept."
          >
            <Select
              allowClear
              placeholder="No workflow template assigned"
              options={workflowTemplatesQuery.data?.map((w) => ({ value: w.id, label: w.name }))}
            />
          </Form.Item>
          <Form.Item name="customerPo" label="Customer PO">
            <Input />
          </Form.Item>
          <Form.Item name="transformerType" label="Transformer type">
            <Input />
          </Form.Item>
          <Form.Item name="rating" label="Rating">
            <Input />
          </Form.Item>
          <Form.Item name="voltage" label="Voltage">
            <Input />
          </Form.Item>
          <Form.Item name="transformerSerial" label="Serial No">
            <Input />
          </Form.Item>
          <Form.Item name="quantity" label="Quantity">
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="location" label="Location">
            <Input />
          </Form.Item>
          <Form.Item name="targetDeliveryDate" label="Target delivery date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="actualDispatchDate" label="Actual dispatch date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="remarks" label="Remarks">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
