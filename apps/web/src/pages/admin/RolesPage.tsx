import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Drawer, Form, Input, message, Modal, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface Permission {
  id: string;
  code: string;
  category: string;
  description: string;
}
interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: Permission }[];
  _count: { users: number };
}

export function RolesPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleRow | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [createForm] = Form.useForm();

  const rolesQuery = useQuery({ queryKey: ["roles-full"], queryFn: () => api.get<RoleRow[]>("/roles") });
  const permissionsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api.get<Permission[]>("/permissions"),
  });

  useEffect(() => {
    if (editRole) setChecked(new Set(editRole.permissions.map((p) => p.permission.code)));
  }, [editRole]);

  const grouped = (permissionsQuery.data ?? []).reduce<Record<string, Permission[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  async function onCreate() {
    const values = await createForm.validateFields();
    try {
      await api.post("/roles", values);
      message.success("Role created");
      setCreateOpen(false);
      createForm.resetFields();
      qc.invalidateQueries({ queryKey: ["roles-full"] });
      qc.invalidateQueries({ queryKey: ["roles"] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to create role");
    }
  }

  async function onSavePermissions() {
    if (!editRole) return;
    try {
      await api.put(`/roles/${editRole.id}/permissions`, { permissionCodes: [...checked] });
      message.success("Permissions saved");
      qc.invalidateQueries({ queryKey: ["roles-full"] });
      setEditRole(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save permissions");
    }
  }

  function toggle(code: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          Create role
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={rolesQuery.isLoading}
        dataSource={rolesQuery.data ?? []}
        onRow={(record) => ({ onClick: () => setEditRole(record), style: { cursor: "pointer" } })}
        columns={[
          { title: "Role", dataIndex: "name" },
          { title: "Description", dataIndex: "description", render: (v) => v ?? "—" },
          { title: "Permissions", render: (_, r) => r.permissions.length },
          { title: "Users", render: (_, r) => r._count.users },
          {
            title: "",
            render: (_, r) => (r.isSystem ? <Tag>Default role</Tag> : null),
          },
        ]}
      />

      <Modal title="Create role" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={onCreate} okText="Create">
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="Role name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title={editRole?.name} open={!!editRole} onClose={() => setEditRole(null)} width={480} destroyOnClose>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Changes take effect immediately for every user with this role - no re-login required.
        </Typography.Paragraph>
        {Object.entries(grouped).map(([category, perms]) => (
          <div key={category} style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ textTransform: "capitalize" }}>
              {category.replace("_", " ")}
            </Typography.Text>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 8, gap: 4 }}>
              {perms.map((p) => (
                <Checkbox key={p.code} checked={checked.has(p.code)} onChange={() => toggle(p.code)}>
                  <span title={p.description}>{p.code}</span>
                </Checkbox>
              ))}
            </div>
          </div>
        ))}
        <Button type="primary" block onClick={onSavePermissions}>
          Save permissions
        </Button>
      </Drawer>
    </div>
  );
}
