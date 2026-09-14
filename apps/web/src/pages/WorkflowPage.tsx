import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import ReactFlow, { Background, Edge, Node, Position } from "reactflow";
import "reactflow/dist/style.css";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";

interface DocumentType {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  confidentialityLevelId?: string | null;
  multipleFilesAllowed?: boolean;
  versionControlled?: boolean;
  expiryRequired?: boolean;
  retentionYears?: number | null;
}
interface ConfidentialityLevel {
  id: string;
  name: string;
}
interface Requirement {
  id: string;
  mandatory: boolean;
  approvalRequired: boolean;
  slaHours: number | null;
  documentType: DocumentType;
}
interface Stage {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  slaHours: number | null;
  responsibleDepartmentId: string | null;
  responsibleDepartment: { id: string; name: string } | null;
  documentRequirements: Requirement[];
}
interface DepartmentOption {
  id: string;
  name: string;
}
interface ParentStage {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  stages: Stage[];
}
interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  parentStages: ParentStage[];
}
interface TemplateSummary {
  id: string;
  name: string;
  active: boolean;
  _count: { parentStages: number; projects: number };
}

export function WorkflowPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false);
  const [createParentOpen, setCreateParentOpen] = useState(false);
  // IDs, not the objects themselves - a captured object snapshot doesn't
  // update when the underlying query refetches after an edit (e.g. toggling
  // "mandatory" or adding/removing a document requirement), which is
  // exactly what made the workflow drawers look like they weren't
  // refreshing without a full page reload. Deriving the live object from
  // templateQuery.data below means every refetch is reflected immediately.
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [templateForm] = Form.useForm();
  const [parentForm] = Form.useForm();
  const [docTypesOpen, setDocTypesOpen] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ["workflow-templates-list"],
    queryFn: () => api.get<TemplateSummary[]>("/workflow-templates"),
  });

  const currentId = selectedId ?? templatesQuery.data?.[0]?.id ?? null;

  const templateQuery = useQuery({
    queryKey: ["workflow-template", currentId],
    queryFn: () => api.get<WorkflowTemplate>(`/workflow-templates/${currentId}`),
    enabled: !!currentId,
  });

  const activeParent = useMemo(
    () => templateQuery.data?.parentStages.find((p) => p.id === activeParentId) ?? null,
    [templateQuery.data, activeParentId],
  );
  const activeStage = useMemo(
    () => activeParent?.stages.find((s) => s.id === activeStageId) ?? null,
    [activeParent, activeStageId],
  );

  const { nodes, edges } = useMemo(() => {
    const parents = templateQuery.data?.parentStages ?? [];
    const nodes: Node[] = parents.map((p, i) => ({
      id: p.id,
      position: { x: 0, y: i * 90 },
      data: { label: `${p.name} (${p.stages.length} stages)` },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: { width: 260, textAlign: "center" as const },
    }));
    const edges: Edge[] = parents.slice(1).map((p, i) => ({
      id: `${parents[i].id}-${p.id}`,
      source: parents[i].id,
      target: p.id,
      animated: false,
    }));
    return { nodes, edges };
  }, [templateQuery.data]);

  async function onCreateTemplate() {
    const values = await templateForm.validateFields();
    try {
      const template = await api.post<{ id: string }>("/workflow-templates", values);
      message.success("Template created");
      setCreateTemplateOpen(false);
      templateForm.resetFields();
      qc.invalidateQueries({ queryKey: ["workflow-templates-list"] });
      setSelectedId(template.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to create template");
    }
  }

  async function toggleActive(template: WorkflowTemplate) {
    try {
      await api.post(`/workflow-templates/${template.id}/${template.active ? "deactivate" : "activate"}`);
      qc.invalidateQueries({ queryKey: ["workflow-template", currentId] });
      qc.invalidateQueries({ queryKey: ["workflow-templates-list"] });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to change template status");
    }
  }

  async function onCreateParentStage() {
    if (!currentId) return;
    const values = await parentForm.validateFields();
    try {
      await api.post(`/workflow-templates/${currentId}/parent-stages`, values);
      message.success("Parent stage added");
      setCreateParentOpen(false);
      parentForm.resetFields();
      qc.invalidateQueries({ queryKey: ["workflow-template", currentId] });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to add parent stage");
    }
  }

  function refreshTemplate() {
    qc.invalidateQueries({ queryKey: ["workflow-template", currentId] });
  }

  return (
    <div>
      <Typography.Title level={3}>Workflow Templates</Typography.Title>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <Select
          style={{ width: 360 }}
          value={currentId ?? undefined}
          onChange={setSelectedId}
          options={templatesQuery.data?.map((t) => ({
            value: t.id,
            label: `${t.name}${t.active ? "" : " (inactive)"}`,
          }))}
          placeholder="Select a workflow template"
        />
        <Button onClick={() => setCreateTemplateOpen(true)}>Create template</Button>
        <Button onClick={() => setDocTypesOpen(true)}>Manage Document Types</Button>
        {templateQuery.data && (
          <>
            <Switch
              checked={templateQuery.data.active}
              onChange={() => toggleActive(templateQuery.data!)}
              checkedChildren="Active"
              unCheckedChildren="Inactive"
            />
            <Button onClick={() => setCreateParentOpen(true)}>Add parent stage</Button>
          </>
        )}
      </div>

      {templateQuery.data && (
        <>
          <Typography.Paragraph type="secondary">{templateQuery.data.description}</Typography.Paragraph>
          <div style={{ height: Math.max(300, (templateQuery.data.parentStages.length + 1) * 90), border: "1px solid #eee", borderRadius: 8 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodeClick={(_, node) => setActiveParentId(node.id)}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
            >
              <Background />
            </ReactFlow>
          </div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            Click a parent stage to manage its stages and document requirements. Reordering uses the
            move up/down controls in that panel rather than drag-and-drop on the canvas.
          </Typography.Paragraph>
        </>
      )}

      <Modal title="Create workflow template" open={createTemplateOpen} onCancel={() => setCreateTemplateOpen(false)} onOk={onCreateTemplate} okText="Create">
        <Form form={templateForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Add parent stage" open={createParentOpen} onCancel={() => setCreateParentOpen(false)} onOk={onCreateParentStage} okText="Add">
        <Form form={parentForm} layout="vertical">
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input placeholder="e.g. QUALITY_FINAL" />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Final Quality" />
          </Form.Item>
        </Form>
      </Modal>

      <ParentStageDrawer
        parentStage={activeParent}
        onClose={() => setActiveParentId(null)}
        onChanged={refreshTemplate}
        onOpenStage={(stage) => setActiveStageId(stage.id)}
      />
      <StageDrawer stage={activeStage} onClose={() => setActiveStageId(null)} onChanged={refreshTemplate} />
      <DocumentTypesDrawer open={docTypesOpen} onClose={() => setDocTypesOpen(false)} />
    </div>
  );
}

function ParentStageDrawer({
  parentStage,
  onClose,
  onChanged,
  onOpenStage,
}: {
  parentStage: ParentStage | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenStage: (stage: Stage) => void;
}) {
  const [editingStage, setEditingStage] = useState<Stage | "new" | null>(null);
  const [form] = Form.useForm();
  const departmentsQuery = useQuery({
    queryKey: ["departments-for-stage"],
    queryFn: () => api.get<DepartmentOption[]>("/departments"),
    enabled: !!editingStage,
  });

  function openStageForm(stage: Stage | "new") {
    setEditingStage(stage);
    form.resetFields();
    if (stage !== "new") form.setFieldsValue(stage);
  }

  async function saveStage() {
    if (!parentStage || !editingStage) return;
    const values = await form.validateFields();
    try {
      if (editingStage === "new") {
        await api.post(`/parent-stages/${parentStage.id}/stages`, values);
        message.success("Stage added");
      } else {
        await api.patch(`/stages/${editingStage.id}`, values);
        message.success("Stage updated");
      }
      setEditingStage(null);
      onChanged();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to save stage");
    }
  }

  async function move(stage: Stage, direction: -1 | 1) {
    if (!parentStage) return;
    const ordered = [...parentStage.stages].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((s) => s.id === stage.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= ordered.length) return;
    [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
    try {
      await api.patch(`/parent-stages/${parentStage.id}/stages/reorder`, { orderedIds: ordered.map((s) => s.id) });
      onChanged();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to reorder stages");
    }
  }

  async function deleteStage(stage: Stage) {
    try {
      await api.delete(`/stages/${stage.id}`);
      message.success("Stage deleted");
      onChanged();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to delete stage");
    }
  }

  return (
    <Drawer title={parentStage ? `${parentStage.name} — stages` : ""} open={!!parentStage} onClose={onClose} width={480}>
      {parentStage && (
        <>
          <List
            dataSource={[...parentStage.stages].sort((a, b) => a.sortOrder - b.sortOrder)}
            renderItem={(stage) => (
              <List.Item
                actions={[
                  <Button key="up" size="small" onClick={() => move(stage, -1)}>
                    ↑
                  </Button>,
                  <Button key="down" size="small" onClick={() => move(stage, 1)}>
                    ↓
                  </Button>,
                  <Button key="edit" size="small" onClick={() => openStageForm(stage)}>
                    Edit
                  </Button>,
                  <Button key="open" size="small" onClick={() => onOpenStage(stage)}>
                    Documents ({stage.documentRequirements.length})
                  </Button>,
                  <Button key="del" size="small" danger onClick={() => deleteStage(stage)}>
                    Delete
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={`${stage.code} — ${stage.name}`}
                  description={
                    <>
                      {stage.description}
                      {stage.responsibleDepartment && (
                        <div style={{ fontSize: 12 }}>Responsible: {stage.responsibleDepartment.name}</div>
                      )}
                    </>
                  }
                />
              </List.Item>
            )}
          />
          <Button block onClick={() => openStageForm("new")} style={{ marginTop: 12 }}>
            Add stage
          </Button>
          <Modal
            title={editingStage === "new" ? "Add stage" : `Edit ${(editingStage as Stage)?.name ?? ""}`}
            open={!!editingStage}
            onCancel={() => setEditingStage(null)}
            onOk={saveStage}
            okText="Save"
          >
            <Form form={form} layout="vertical">
              <Form.Item name="code" label="Code" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="description" label="Description">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item
                name="responsibleDepartmentId"
                label="Responsible department"
                extra="Its head gets notified whenever a document is uploaded for this stage."
              >
                <Select
                  allowClear
                  options={departmentsQuery.data?.map((d) => ({ value: d.id, label: d.name }))}
                />
              </Form.Item>
              <Form.Item name="slaHours" label="SLA (hours)">
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </Drawer>
  );
}

function StageDrawer({ stage, onClose, onChanged }: { stage: Stage | null; onClose: () => void; onChanged: () => void }) {
  const documentTypesQuery = useQuery({
    queryKey: ["document-types"],
    queryFn: () => api.get<DocumentType[]>("/document-types"),
  });
  const [documentTypeId, setDocumentTypeId] = useState<string | undefined>();
  const [mandatory, setMandatory] = useState(true);

  async function addRequirement() {
    if (!stage || !documentTypeId) return;
    try {
      await api.post(`/stages/${stage.id}/document-requirements`, { documentTypeId, mandatory });
      message.success("Requirement added");
      setDocumentTypeId(undefined);
      onChanged();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to add requirement");
    }
  }

  async function removeRequirement(id: string) {
    try {
      await api.delete(`/document-requirements/${id}`);
      message.success("Requirement removed");
      onChanged();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to remove requirement");
    }
  }

  async function toggleMandatory(req: Requirement) {
    try {
      await api.patch(`/document-requirements/${req.id}`, { mandatory: !req.mandatory });
      onChanged();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to update requirement");
    }
  }

  return (
    <Drawer title={stage ? `${stage.name} — document requirements` : ""} open={!!stage} onClose={onClose} width={480}>
      {stage && (
        <>
          <List
            dataSource={stage.documentRequirements}
            renderItem={(req) => (
              <List.Item
                actions={[
                  <Button key="del" size="small" danger onClick={() => removeRequirement(req.id)}>
                    Remove
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={req.documentType.name}
                  description={
                    <Checkbox checked={req.mandatory} onChange={() => toggleMandatory(req)}>
                      Mandatory
                    </Checkbox>
                  }
                />
              </List.Item>
            )}
          />
          <Card size="small" style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select document type"
                style={{ width: "100%" }}
                value={documentTypeId}
                onChange={setDocumentTypeId}
                options={documentTypesQuery.data
                  ?.filter((dt) => !stage.documentRequirements.some((r) => r.documentType.id === dt.id))
                  .map((dt) => ({ value: dt.id, label: dt.name }))}
              />
              <Checkbox checked={mandatory} onChange={(e) => setMandatory(e.target.checked)}>
                Mandatory
              </Checkbox>
              <Button type="primary" block disabled={!documentTypeId} onClick={addRequirement}>
                Add requirement
              </Button>
            </Space>
          </Card>
        </>
      )}
    </Drawer>
  );
}

/** The master list of document types - separate from attaching/detaching a
 * type to a specific stage (StageDrawer above, which already covers "add/
 * remove document types to a workflow stage"). This is for the types
 * themselves: creating a new one when the right one doesn't exist yet,
 * correcting a name/code, or removing one nothing actually uses. */
function DocumentTypesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const canManage = useAuth((s) => s.hasPermission("document_type.manage"));
  const [editTarget, setEditTarget] = useState<DocumentType | "new" | null>(null);
  const [form] = Form.useForm();

  const query = useQuery({
    queryKey: ["document-types"],
    queryFn: () => api.get<DocumentType[]>("/document-types"),
    enabled: open,
  });
  const confidentialityQuery = useQuery({
    queryKey: ["confidentiality-levels"],
    queryFn: () => api.get<ConfidentialityLevel[]>("/confidentiality-levels"),
    enabled: open,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["document-types"] });
  }

  function openEdit(record: DocumentType | "new") {
    setEditTarget(record);
    form.resetFields();
    if (record !== "new") form.setFieldsValue(record);
  }

  async function onSave() {
    const values = await form.validateFields();
    try {
      if (editTarget === "new") {
        await api.post("/document-types", values);
        message.success("Document type created");
      } else if (editTarget) {
        await api.patch(`/document-types/${editTarget.id}`, values);
        message.success("Document type updated");
      }
      setEditTarget(null);
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to save document type");
    }
  }

  async function onDelete(dt: DocumentType) {
    try {
      await api.delete(`/document-types/${dt.id}`);
      message.success("Document type deleted");
      invalidate();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <Drawer title="Document Types" open={open} onClose={onClose} width={600}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        The master list of document types available across every workflow template. To require a
        type at a specific stage, use "Documents" on that stage instead - this only manages the
        types themselves.
      </Typography.Paragraph>
      {canManage && (
        <Button type="primary" onClick={() => openEdit("new")} style={{ marginBottom: 12 }}>
          Add document type
        </Button>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        pagination={false}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          ...(canManage
            ? [
                {
                  title: "",
                  render: (_: unknown, dt: DocumentType) => (
                    <Space size="small">
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(dt)} />
                      <Popconfirm
                        title="Delete this document type?"
                        description="Only possible if no workflow stage or document uses it."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => onDelete(dt)}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title={editTarget === "new" ? "Add document type" : `Edit ${(editTarget as DocumentType)?.name ?? ""}`}
        open={!!editTarget}
        onCancel={() => setEditTarget(null)}
        onOk={onSave}
        okText="Save"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input placeholder="e.g. GTP_APPROVED" disabled={editTarget !== "new"} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Approved GTP" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="confidentialityLevelId" label="Default confidentiality level">
            <Select
              allowClear
              options={confidentialityQuery.data?.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="expiryRequired" label="Has an expiry date" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="retentionYears" label="Retention (years)">
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
