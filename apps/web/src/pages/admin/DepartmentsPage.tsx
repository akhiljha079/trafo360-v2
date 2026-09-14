import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, message, Modal, Select, Switch, Table, Tag } from "antd";
import { useState } from "react";
import { api } from "../../api/client";

interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
  head: { id: string; name: string } | null;
  _count: { users: number };
}

export function DepartmentsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<DepartmentRow | "new" | null>(null);
  const [form] = Form.useForm();

  const departmentsQuery = useQuery({
    queryKey: ["departments-full"],
    queryFn: () => api.get<DepartmentRow[]>("/departments"),
  });
  const usersQuery = useQuery({
    queryKey: ["users-for-head"],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/users?pageSize=100"),
  });

  function openEdit(record: DepartmentRow | "new") {
    setOpen(record);
    if (record === "new") {
      form.resetFields();
    } else {
      form.setFieldsValue({ code: record.code, name: record.name, headId: record.head?.id, active: record.active });
    }
  }

  async function onSave() {
    const values = await form.validateFields();
    try {
      if (open === "new") {
        await api.post("/departments", values);
        message.success("Department created");
      } else if (open) {
        await api.patch(`/departments/${open.id}`, values);
        message.success("Department updated");
      }
      setOpen(null);
      qc.invalidateQueries({ queryKey: ["departments-full"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save department");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button type="primary" onClick={() => openEdit("new")}>
          Create department
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={departmentsQuery.isLoading}
        dataSource={departmentsQuery.data ?? []}
        pagination={false}
        onRow={(record) => ({ onClick: () => openEdit(record), style: { cursor: "pointer" } })}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          { title: "Head", dataIndex: ["head", "name"], render: (v) => v ?? "—" },
          { title: "Users", render: (_, r) => r._count.users },
          {
            title: "Status",
            dataIndex: "active",
            render: (v: boolean) => <Tag color={v ? "green" : "red"}>{v ? "Active" : "Inactive"}</Tag>,
          },
        ]}
      />

      <Modal
        title={open === "new" ? "Create department" : `Edit ${(open as DepartmentRow)?.name}`}
        open={!!open}
        onCancel={() => setOpen(null)}
        onOk={onSave}
        okText="Save"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input disabled={open !== "new"} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="headId" label="Department head">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={usersQuery.data?.items.map((u) => ({ value: u.id, label: u.name }))}
            />
          </Form.Item>
          {open !== "new" && (
            <Form.Item name="active" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
