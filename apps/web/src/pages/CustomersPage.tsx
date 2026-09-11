import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, message, Modal, Select, Switch, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { api } from "../api/client";

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  customerType: string | null;
  active: boolean;
  _count: { projects: number };
}

export function CustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<CustomerRow | "new" | null>(null);
  const [form] = Form.useForm();

  const query = useQuery({
    queryKey: ["customers", search],
    queryFn: () => api.get<{ items: CustomerRow[]; total: number }>(`/customers?search=${encodeURIComponent(search)}&pageSize=100`),
  });

  function openEdit(record: CustomerRow | "new") {
    setOpen(record);
    form.resetFields();
    if (record !== "new") form.setFieldsValue(record);
  }

  async function onSave() {
    const values = await form.validateFields();
    try {
      if (open === "new") {
        await api.post("/customers", values);
        message.success("Customer created");
      } else if (open) {
        await api.patch(`/customers/${open.id}`, values);
        message.success("Customer updated");
      }
      setOpen(null);
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save customer");
    }
  }

  return (
    <div>
      <Typography.Title level={3}>Customers</Typography.Title>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Input.Search
          placeholder="Search by name, code, or contact"
          onSearch={setSearch}
          style={{ width: 320 }}
          allowClear
        />
        <Button type="primary" onClick={() => openEdit("new")}>
          Create customer
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items ?? []}
        onRow={(record) => ({ onClick: () => openEdit(record), style: { cursor: "pointer" } })}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          { title: "Contact", dataIndex: "contactPerson", render: (v) => v ?? "—" },
          { title: "Email", dataIndex: "email", render: (v) => v ?? "—" },
          { title: "Country", dataIndex: "country", render: (v) => v ?? "—" },
          { title: "Projects", render: (_, r) => r._count.projects },
          {
            title: "Status",
            dataIndex: "active",
            render: (v: boolean) => <Tag color={v ? "green" : "red"}>{v ? "Active" : "Inactive"}</Tag>,
          },
        ]}
      />

      <Modal
        title={open === "new" ? "Create customer" : `Edit ${(open as CustomerRow)?.name}`}
        open={!!open}
        onCancel={() => setOpen(null)}
        onOk={onSave}
        okText="Save"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Customer code" rules={[{ required: true }]}>
            <Input disabled={open !== "new"} />
          </Form.Item>
          <Form.Item name="name" label="Customer name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactPerson" label="Contact person">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="country" label="Country">
            <Input />
          </Form.Item>
          <Form.Item name="taxId" label="GST / VAT / Tax ID">
            <Input />
          </Form.Item>
          <Form.Item name="customerType" label="Customer type">
            <Select
              allowClear
              options={[
                { value: "Government", label: "Government" },
                { value: "Private", label: "Private" },
                { value: "Export", label: "Export" },
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} />
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
