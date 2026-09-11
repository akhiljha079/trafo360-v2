import { Tabs, Typography } from "antd";
import { useMemo } from "react";
import { useLocation, useNavigate, Outlet } from "react-router-dom";

const TABS = [
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles & Permissions" },
  { key: "departments", label: "Departments" },
  { key: "ad-config", label: "AD / LDAP" },
  { key: "smtp", label: "SMTP" },
  { key: "storage", label: "Storage" },
  { key: "whatsapp", label: "WhatsApp Web" },
  { key: "notifications", label: "Notification Rules" },
];

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeKey = useMemo(() => {
    const segment = location.pathname.split("/")[2];
    return TABS.some((t) => t.key === segment) ? segment : "users";
  }, [location.pathname]);

  return (
    <div>
      <Typography.Title level={3}>Administration</Typography.Title>
      <Tabs
        activeKey={activeKey}
        items={TABS}
        onChange={(key) => navigate(`/admin/${key}`)}
      />
      <Outlet />
    </div>
  );
}
