import { useQuery } from "@tanstack/react-query";
import { Input, Table, Typography } from "antd";
import { useState } from "react";
import { api } from "../api/client";

interface AuditLogRow {
  id: string;
  action: string;
  objectType: string;
  objectId: string | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; username: string } | null;
}

export function AuditLogsPage() {
  const [objectType, setObjectType] = useState("");
  const [action, setAction] = useState("");

  const query = useQuery({
    queryKey: ["audit-logs", objectType, action],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "100" });
      if (objectType) params.set("objectType", objectType);
      if (action) params.set("action", action);
      return api.get<{ items: AuditLogRow[]; total: number }>(`/audit-logs?${params}`);
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Audit Logs</Typography.Title>
      <Typography.Paragraph type="secondary">
        Read-only. There is no edit or delete path for audit entries anywhere in the system.
      </Typography.Paragraph>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Input
          placeholder="Filter by object type (e.g. User, Role)"
          value={objectType}
          onChange={(e) => setObjectType(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />
        <Input
          placeholder="Filter by action (e.g. USER_LOGGED_IN)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "When", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
          { title: "User", dataIndex: ["user", "name"], render: (v, r) => v ?? r.user?.username ?? "system" },
          { title: "Action", dataIndex: "action" },
          { title: "Object", render: (_, r) => `${r.objectType}${r.objectId ? ` (${r.objectId.slice(0, 8)}…)` : ""}` },
          { title: "IP", dataIndex: "ipAddress" },
        ]}
      />
    </div>
  );
}
