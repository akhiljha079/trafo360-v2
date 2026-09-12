import {
  AuditOutlined,
  BarChartOutlined,
  DashboardOutlined,
  FileProtectOutlined,
  FolderOpenOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Dropdown, Layout, Menu, Typography } from "antd";
import { useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";

const { Header, Sider, Content } = Layout;

// Permissions that unlock at least one tab under Administration - if the
// user holds none of these, the whole section is dead weight in their nav,
// not just individually-inaccessible sub-pages.
const ADMIN_SECTION_PERMISSIONS = [
  "user.manage",
  "role.manage",
  "department.manage",
  "ad.manage",
  "notification.manage",
  "storage.manage",
];

const NAV_ITEMS = [
  { key: "/", icon: <DashboardOutlined />, label: <Link to="/">Dashboard</Link> },
  {
    key: "/projects",
    icon: <FolderOpenOutlined />,
    label: <Link to="/projects">Projects</Link>,
  },
  {
    key: "/documents",
    icon: <FileProtectOutlined />,
    label: <Link to="/documents">Document Library</Link>,
  },
  {
    key: "/physical-files",
    icon: <FileProtectOutlined />,
    label: <Link to="/physical-files">Physical Files</Link>,
  },
  {
    key: "/certificates",
    icon: <SafetyCertificateOutlined />,
    label: <Link to="/certificates">Type Test Certificates</Link>,
  },
  {
    key: "/workflow",
    icon: <BarChartOutlined />,
    label: <Link to="/workflow">Workflow</Link>,
  },
  { key: "/customers", icon: <TeamOutlined />, label: <Link to="/customers">Customers</Link> },
  { key: "/reports", icon: <BarChartOutlined />, label: <Link to="/reports">Reports</Link> },
  {
    key: "/admin",
    icon: <SettingOutlined />,
    label: <Link to="/admin">Administration</Link>,
    show: (hasPermission: (code: string) => boolean) => ADMIN_SECTION_PERMISSIONS.some(hasPermission),
  },
  {
    key: "/audit-logs",
    icon: <AuditOutlined />,
    label: <Link to="/audit-logs">Audit Logs</Link>,
    show: (hasPermission: (code: string) => boolean) => hasPermission("audit.view"),
  },
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const hasPermission = useAuth((s) => s.hasPermission);
  const logout = useAuth((s) => s.logout);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.show || item.show(hasPermission)),
    [hasPermission],
  );

  const selectedKey = useMemo(() => {
    const match = visibleNavItems.find((item) => item.key !== "/" && location.pathname.startsWith(item.key));
    return match?.key ?? "/";
  }, [location.pathname, visibleNavItems]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ color: "#fff", padding: "16px", fontWeight: 600, fontSize: 18 }}>TRAFO 360</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={visibleNavItems} />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
          <GlobalSearch />
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <NotificationBell />
          <Dropdown
            menu={{
              items: [
                { key: "change-password", label: "Change Password" },
                { key: "logout", label: "Sign out" },
              ],
              onClick: async ({ key }) => {
                if (key === "change-password") {
                  setChangePasswordOpen(true);
                } else if (key === "logout") {
                  await logout();
                  navigate("/login", { replace: true });
                }
              },
            }}
          >
            <span style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar icon={<UserOutlined />} size="small" />
              <Typography.Text>{user?.name}</Typography.Text>
            </span>
          </Dropdown>
          </div>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </Layout>
  );
}
