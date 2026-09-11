import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import trafoLogo from "../assets/trafo-logo.png";

const BRAND_NAVY = "#0f2744";

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setError(null);
    setLoading(true);
    try {
      await login(values.username, values.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <style>{`
        @media (max-width: 900px) {
          .login-brand-panel { display: none !important; }
        }
      `}</style>

      <div
        className="login-brand-panel"
        style={{
          flex: "1 1 50%",
          background: `linear-gradient(160deg, ${BRAND_NAVY} 0%, #071a2f 100%)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          color: "#fff",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -90,
            right: -90,
            width: 320,
            height: 320,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.08)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -130,
            left: -70,
            width: 300,
            height: 300,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.06)",
          }}
        />

        <div style={{ background: "#fff", display: "inline-flex", padding: "10px 18px", borderRadius: 8, width: "fit-content" }}>
          <img src={trafoLogo} alt="Trafo Power and Electricals Pvt. Ltd." style={{ height: 40, display: "block" }} />
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <Typography.Title level={2} style={{ color: "#fff", marginBottom: 12 }}>
            TRAFO 360
          </Typography.Title>
          <Typography.Paragraph style={{ color: "rgba(255,255,255,0.75)", fontSize: 16, maxWidth: 420, marginBottom: 0 }}>
            The manufacturing project workflow, document control, and dispatch tracking system for
            Trafo Power and Electricals Pvt. Ltd. — India's Best Transformer Brand.
          </Typography.Paragraph>
        </div>

        <div style={{ position: "relative", zIndex: 1, color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 1.8 }}>
          <div>C-20, Site &lsquo;C&rsquo;, U.P.S.I.D.C., Industrial Area, Sikandra, Agra — 282007, Uttar Pradesh</div>
          <div>+91-562 2640388</div>
        </div>
      </div>

      <div style={{ flex: "1 1 50%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f7fa", padding: 24 }}>
        <Card style={{ width: 380, boxShadow: "0 8px 32px rgba(15,39,68,0.08)", border: "none" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <Typography.Title level={4} style={{ marginBottom: 0 }}>
              Sign in
            </Typography.Title>
            <Typography.Text type="secondary">Access your TRAFO 360 account</Typography.Text>
          </div>
          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
          <Form layout="vertical" onFinish={onFinish} disabled={loading}>
            <Form.Item name="username" label="Username" rules={[{ required: true, message: "Username is required" }]}>
              <Input prefix={<UserOutlined />} autoFocus autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true, message: "Password is required" }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" block loading={loading} size="large">
                Sign in
              </Button>
            </Form.Item>
          </Form>
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}>
            Most users sign in with their company AD/network account once an administrator connects Active
            Directory under Administration &rarr; AD / LDAP. The local administrator account is only for
            initial setup.
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  );
}
