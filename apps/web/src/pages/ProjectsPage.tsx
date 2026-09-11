import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, message, Modal, Select, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

interface ProjectRow {
  id: string;
  projectNo: string;
  name: string;
  status: string;
  transformerType: string | null;
  rating: string | null;
  customer: { id: string; name: string };
  confidentialityLevel: { code: string; name: string };
  workflowTemplate: { name: string } | null;
  targetDeliveryDate: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "default",
  ORDER_RECEIVED: "blue",
  ENGINEERING: "geekblue",
  PROCUREMENT: "purple",
  MANUFACTURING: "gold",
  TESTING: "orange",
  QA_REVIEW: "cyan",
  READY_FOR_DISPATCH: "lime",
  DISPATCHED: "green",
  PROJECT_CLOSURE: "green",
  COMPLETED: "success",
  ON_HOLD: "warning",
  CANCELLED: "error",
};

export function ProjectsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const projectsQuery = useQuery({
    queryKey: ["projects", search],
    queryFn: () => api.get<{ items: ProjectRow[]; total: number }>(`/projects?search=${encodeURIComponent(search)}&pageSize=100`),
  });
  const customersQuery = useQuery({
    queryKey: ["customers-all"],
    queryFn: () => api.get<{ items: { id: string; name: string; code: string }[] }>("/customers?pageSize=200"),
  });
  const confidentialityQuery = useQuery({
    queryKey: ["confidentiality-levels"],
    queryFn: () => api.get<{ id: string; code: string; name: string }[]>("/confidentiality-levels"),
  });
  const workflowTemplatesQuery = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/workflow-templates"),
  });

  async function onCreate() {
    const values = await form.validateFields();
    try {
      const project = await api.post<ProjectRow>("/projects", {
        ...values,
        poDate: values.poDate?.toISOString(),
        startDate: values.startDate?.toISOString(),
        targetDeliveryDate: values.targetDeliveryDate?.toISOString(),
      });
      message.success(`Project ${project.projectNo} created`);
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to create project");
    }
  }

  return (
    <div>
      <Typography.Title level={3}>Projects</Typography.Title>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Input.Search
          placeholder="Search by project no, name, PO, or serial number"
          onSearch={setSearch}
          style={{ width: 360 }}
          allowClear
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          Create project
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={projectsQuery.isLoading}
        dataSource={projectsQuery.data?.items ?? []}
        onRow={(record) => ({ onClick: () => navigate(`/projects/${record.id}`), style: { cursor: "pointer" } })}
        columns={[
          { title: "Project No", dataIndex: "projectNo" },
          { title: "Name", dataIndex: "name" },
          { title: "Customer", dataIndex: ["customer", "name"] },
          { title: "Type / Rating", render: (_, r) => [r.transformerType, r.rating].filter(Boolean).join(" · ") || "—" },
          {
            title: "Confidentiality",
            dataIndex: ["confidentialityLevel", "name"],
            render: (v) => <Tag>{v}</Tag>,
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (v: string) => <Tag color={STATUS_COLORS[v] ?? "default"}>{v.replace(/_/g, " ")}</Tag>,
          },
          {
            title: "Target Delivery",
            dataIndex: "targetDeliveryDate",
            render: (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—"),
          },
        ]}
      />

      <Modal
        title="Create project"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreate}
        okText="Create"
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={customersQuery.data?.items.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
            />
          </Form.Item>
          <Form.Item name="name" label="Project name" rules={[{ required: true }]}>
            <Input placeholder="e.g. 10 MVA Distribution Transformer" />
          </Form.Item>
          <Form.Item name="customerPo" label="Customer PO">
            <Input />
          </Form.Item>
          <Form.Item name="poDate" label="PO date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="transformerType" label="Transformer type">
            <Input placeholder="e.g. Distribution Transformer" />
          </Form.Item>
          <Form.Item name="rating" label="Rating">
            <Input placeholder="e.g. 10 MVA" />
          </Form.Item>
          <Form.Item name="voltage" label="Voltage">
            <Input placeholder="e.g. 33/11 kV" />
          </Form.Item>
          <Form.Item name="quantity" label="Quantity" initialValue={1}>
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="targetDeliveryDate" label="Target delivery date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="confidentialityLevelId" label="Confidentiality level" rules={[{ required: true }]}>
            <Select options={confidentialityQuery.data?.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="workflowTemplateId" label="Workflow template">
            <Select
              allowClear
              options={workflowTemplatesQuery.data?.map((w) => ({ value: w.id, label: w.name }))}
            />
          </Form.Item>
          <Form.Item name="remarks" label="Remarks">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
