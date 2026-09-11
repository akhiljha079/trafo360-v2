import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, InputNumber, Space, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordSet: boolean;
  fromEmail: string;
  fromName: string;
}

export function SmtpSettingsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const configQuery = useQuery({ queryKey: ["smtp-config"], queryFn: () => api.get<SmtpConfig>("/admin/smtp-config") });

  useEffect(() => {
    if (configQuery.data) form.setFieldsValue(configQuery.data);
  }, [configQuery.data, form]);

  async function onSave() {
    const values = await form.validateFields();
    setBusy("save");
    try {
      await api.put("/admin/smtp-config", values);
      qc.invalidateQueries({ queryKey: ["smtp-config"] });
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const result = await api.post<{ success: boolean; message: string }>("/admin/smtp-config/test-email", { toEmail: testEmail });
      setTestResult(result);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Typography.Paragraph type="secondary">
        Email is the authoritative notification channel (WhatsApp Web, configured separately, is
        supplementary and policy-fragile). Save your settings, then send a test email to confirm
        before enabling.
      </Typography.Paragraph>

      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="enabled" label="SMTP enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="host" label="SMTP host" rules={[{ required: true }]}>
            <Input placeholder="smtp.company.com" />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="port" label="Port" style={{ width: "50%" }}>
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="secure" label="Use TLS" valuePropName="checked" style={{ width: "50%" }}>
              <Switch />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="user" label="Username">
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={`Password${configQuery.data?.passwordSet ? " (leave blank to keep current)" : ""}`}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="fromEmail" label="From email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="fromName" label="From name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Button type="primary" loading={busy === "save"} onClick={onSave}>
            Save configuration
          </Button>
        </Form>
      </Card>

      <Space direction="vertical" style={{ width: "100%" }}>
        <Space.Compact style={{ width: "100%" }}>
          <Input placeholder="test@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
          <Button loading={busy === "test"} disabled={!testEmail} onClick={onTest}>
            Send test email
          </Button>
        </Space.Compact>
        {testResult && (
          <Alert
            type={testResult.success ? "success" : "error"}
            message={testResult.message}
            showIcon
            closable
            onClose={() => setTestResult(null)}
          />
        )}
      </Space>
    </div>
  );
}
