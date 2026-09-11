import { BellOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dropdown, Empty, List, Typography } from "antd";
import { api } from "../api/client";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const qc = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count"),
    refetchInterval: 30000,
  });
  const listQuery = useQuery({
    queryKey: ["notifications-recent"],
    queryFn: () => api.get<NotificationRow[]>("/notifications"),
    enabled: false,
  });

  async function onOpenChange(open: boolean) {
    if (open) {
      await listQuery.refetch();
    }
  }

  async function markRead(id: string) {
    await api.patch(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    listQuery.refetch();
  }

  async function markAllRead() {
    await api.post("/notifications/mark-all-read");
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    listQuery.refetch();
  }

  return (
    <Dropdown
      trigger={["click"]}
      onOpenChange={onOpenChange}
      dropdownRender={() => (
        <div style={{ width: 360, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", padding: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px" }}>
            <Typography.Text strong>Notifications</Typography.Text>
            <Button type="link" size="small" onClick={markAllRead}>
              Mark all read
            </Button>
          </div>
          <List
            style={{ maxHeight: 400, overflowY: "auto" }}
            dataSource={listQuery.data ?? []}
            locale={{ emptyText: <Empty description="No notifications" /> }}
            renderItem={(n) => (
              <List.Item
                onClick={() => !n.readAt && markRead(n.id)}
                style={{ cursor: n.readAt ? "default" : "pointer", background: n.readAt ? "transparent" : "#e6f4ff", padding: 8 }}
              >
                <List.Item.Meta
                  title={n.title}
                  description={
                    <>
                      <div>{n.body}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(n.createdAt).toLocaleString()}
                      </Typography.Text>
                    </>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      )}
    >
      <Badge count={unreadQuery.data?.count ?? 0} size="small">
        <BellOutlined style={{ fontSize: 18, cursor: "pointer" }} />
      </Badge>
    </Dropdown>
  );
}
