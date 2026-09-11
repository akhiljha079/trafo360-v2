import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Descriptions, Row, Select, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
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

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
    retry: false,
  });
  const usersQuery = useQuery({
    queryKey: ["users-for-member"],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/users?pageSize=200"),
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
      <Typography.Title level={3}>
        {p.projectNo} — {p.name}
      </Typography.Title>
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
    </div>
  );
}
