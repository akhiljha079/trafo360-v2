import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Select,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from "antd";
import { useState } from "react";
import { api } from "../../api/client";

interface UserRow {
  id: string;
  username: string;
  employeeId: string | null;
  name: string;
  email: string;
  mobile: string | null;
  designation: string | null;
  source: "LOCAL" | "AD";
  status: "ACTIVE" | "INACTIVE";
  department: { id: string; name: string } | null;
  role: { id: string; name: string } | null;
}

interface Department {
  id: string;
  name: string;
}
interface Role {
  id: string;
  name: string;
}
interface Permission {
  id: string;
  code: string;
  category: string;
  description: string;
}
interface LoginHistoryRow {
  id: string;
  success: boolean;
  ipAddress: string | null;
  failureReason: string | null;
  createdAt: string;
}

export function UsersPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ items: UserRow[] }>("/users"),
  });
  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Department[]>("/departments"),
  });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/roles") });
  const permissionsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api.get<Permission[]>("/permissions"),
  });

  const editDetailQuery = useQuery({
    queryKey: ["user", editUser?.id],
    queryFn: () =>
      api.get<UserRow & { permissionOverrides: { permission: Permission; effect: string }[] }>(
        `/users/${editUser!.id}`,
      ),
    enabled: !!editUser,
  });
  const loginHistoryQuery = useQuery({
    queryKey: ["user-login-history", editUser?.id],
    queryFn: () => api.get<LoginHistoryRow[]>(`/users/${editUser!.id}/login-history`),
    enabled: !!editUser,
  });

  async function onCreate() {
    const values = await createForm.validateFields();
    try {
      await api.post("/users", values);
      message.success("User created");
      setCreateOpen(false);
      createForm.resetFields();
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to create user");
    }
  }

  async function onSaveEdit() {
    if (!editUser) return;
    const values = await editForm.validateFields();
    try {
      await api.patch(`/users/${editUser.id}`, values);
      message.success("User updated");
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["user", editUser.id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  async function onSaveOverrides(grants: string[], revokes: string[]) {
    if (!editUser) return;
    const overrides = [
      ...grants.map((permissionCode) => ({ permissionCode, effect: "GRANT" as const })),
      ...revokes.map((permissionCode) => ({ permissionCode, effect: "REVOKE" as const })),
    ];
    try {
      await api.put(`/users/${editUser.id}/permission-overrides`, { overrides });
      message.success("Permission overrides saved");
      qc.invalidateQueries({ queryKey: ["user", editUser.id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save overrides");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          Create local user
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={usersQuery.isLoading}
        dataSource={usersQuery.data?.items ?? []}
        onRow={(record) => ({ onClick: () => setEditUser(record), style: { cursor: "pointer" } })}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Username", dataIndex: "username" },
          { title: "Email", dataIndex: "email" },
          { title: "Department", dataIndex: ["department", "name"], render: (v) => v ?? "—" },
          { title: "Role", dataIndex: ["role", "name"], render: (v) => v ?? "—" },
          {
            title: "Source",
            dataIndex: "source",
            render: (v: string) => <Tag color={v === "AD" ? "blue" : "default"}>{v}</Tag>,
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (v: string) => <Tag color={v === "ACTIVE" ? "green" : "red"}>{v}</Tag>,
          },
        ]}
      />

      <Modal
        title="Create local user"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreate}
        okText="Create"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Local accounts bypass AD. Use only for break-glass or non-AD service accounts - regular
          staff should sign in with their AD account once AD/LDAP is connected.
        </Typography.Paragraph>
        <Form form={createForm} layout="vertical">
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Temporary password" rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="departmentId" label="Department">
            <Select
              allowClear
              options={departmentsQuery.data?.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="roleId" label="Role">
            <Select allowClear options={rolesQuery.data?.map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={editUser?.name}
        open={!!editUser}
        onClose={() => setEditUser(null)}
        width={480}
        destroyOnClose
      >
        {editUser && (
          <Tabs
            items={[
              {
                key: "profile",
                label: "Profile",
                children: (
                  <Form
                    form={editForm}
                    layout="vertical"
                    initialValues={{
                      name: editUser.name,
                      mobile: editUser.mobile,
                      designation: editUser.designation,
                      employeeId: editUser.employeeId,
                      departmentId: editUser.department?.id,
                      roleId: editUser.role?.id,
                      status: editUser.status,
                    }}
                  >
                    <Form.Item name="name" label="Full name">
                      <Input disabled={editUser.source === "AD"} />
                    </Form.Item>
                    <Form.Item name="mobile" label="Mobile">
                      <Input />
                    </Form.Item>
                    <Form.Item name="designation" label="Designation">
                      <Input />
                    </Form.Item>
                    <Form.Item name="employeeId" label="Employee ID">
                      <Input />
                    </Form.Item>
                    <Form.Item name="departmentId" label="Department">
                      <Select
                        allowClear
                        options={departmentsQuery.data?.map((d) => ({ value: d.id, label: d.name }))}
                      />
                    </Form.Item>
                    <Form.Item name="roleId" label="Role">
                      <Select
                        allowClear
                        options={rolesQuery.data?.map((r) => ({ value: r.id, label: r.name }))}
                      />
                    </Form.Item>
                    <Form.Item name="status" label="Status">
                      <Select
                        options={[
                          { value: "ACTIVE", label: "Active" },
                          { value: "INACTIVE", label: "Inactive" },
                        ]}
                      />
                    </Form.Item>
                    <Button type="primary" onClick={onSaveEdit} block>
                      Save
                    </Button>
                  </Form>
                ),
              },
              {
                key: "permissions",
                label: "Permission overrides",
                children: (
                  <PermissionOverridesEditor
                    permissions={permissionsQuery.data ?? []}
                    current={editDetailQuery.data?.permissionOverrides ?? []}
                    onSave={onSaveOverrides}
                  />
                ),
              },
              {
                key: "history",
                label: "Login history",
                children: (
                  <Timeline
                    items={(loginHistoryQuery.data ?? []).map((h) => ({
                      color: h.success ? "green" : "red",
                      children: (
                        <div>
                          <div>{h.success ? "Successful login" : `Failed: ${h.failureReason}`}</div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(h.createdAt).toLocaleString()} · {h.ipAddress}
                          </Typography.Text>
                        </div>
                      ),
                    }))}
                  />
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}

function PermissionOverridesEditor({
  permissions,
  current,
  onSave,
}: {
  permissions: Permission[];
  current: { permission: Permission; effect: string }[];
  onSave: (grants: string[], revokes: string[]) => void;
}) {
  const [grants, setGrants] = useState<string[]>(
    current.filter((o) => o.effect === "GRANT").map((o) => o.permission.code),
  );
  const [revokes, setRevokes] = useState<string[]>(
    current.filter((o) => o.effect === "REVOKE").map((o) => o.permission.code),
  );

  const options = permissions.map((p) => ({ value: p.code, label: `${p.code} — ${p.description}` }));

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Individual overrides on top of this user's role. A revoke always wins over a grant.
      </Typography.Paragraph>
      <Typography.Text strong>Additional permissions granted</Typography.Text>
      <Select mode="multiple" style={{ width: "100%", marginTop: 8, marginBottom: 16 }} value={grants} onChange={setGrants} options={options} />
      <Typography.Text strong>Permissions explicitly revoked</Typography.Text>
      <Select mode="multiple" style={{ width: "100%", marginTop: 8, marginBottom: 16 }} value={revokes} onChange={setRevokes} options={options} />
      <Button type="primary" block onClick={() => onSave(grants, revokes)}>
        Save overrides
      </Button>
    </div>
  );
}
