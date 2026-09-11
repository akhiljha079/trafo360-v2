import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface AdConfig {
  enabled: boolean;
  host: string;
  port: number;
  protocol: "ldap" | "ldaps";
  baseDn: string;
  userSearchDn: string;
  bindUser: string;
  bindPasswordSet: boolean;
  userSearchFilter: string;
  groupSearchBase: string;
  domain: string;
  connectTimeoutMs: number;
}

export function AdConfigPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; total: number } | null>(null);
  const [busy, setBusy] = useState<"test" | "sync" | "save" | null>(null);

  const configQuery = useQuery({ queryKey: ["ad-config"], queryFn: () => api.get<AdConfig>("/admin/ad-config") });

  useEffect(() => {
    if (configQuery.data) form.setFieldsValue(configQuery.data);
  }, [configQuery.data, form]);

  async function onSave() {
    const values = await form.validateFields();
    setBusy("save");
    try {
      await api.put("/admin/ad-config", values);
      qc.invalidateQueries({ queryKey: ["ad-config"] });
      setTestResult(null);
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const result = await api.post<{ success: boolean; message: string }>("/admin/ad-config/test-connection");
      setTestResult(result);
    } finally {
      setBusy(null);
    }
  }

  async function onSync() {
    setBusy("sync");
    setSyncResult(null);
    try {
      const result = await api.post<{ created: number; updated: number; total: number }>(
        "/admin/ad-config/sync-now",
      );
      setSyncResult(result);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">
        Configure how this application authenticates against your organization's Active Directory /
        LDAP. Save your settings first, then use "Test connection" to verify the service account can
        bind before enabling AD sign-in for everyone. The seeded local administrator account still
        works as a break-glass fallback regardless of this configuration.
      </Typography.Paragraph>

      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="enabled" label="AD/LDAP sign-in enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="host" label="Host" rules={[{ required: true }]}>
            <Input placeholder="dc01.company.local" />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="protocol" label="Protocol" style={{ width: "35%" }}>
              <Select
                options={[
                  { value: "ldaps", label: "LDAPS (recommended)" },
                  { value: "ldap", label: "LDAP (unencrypted)" },
                ]}
              />
            </Form.Item>
            <Form.Item name="port" label="Port" style={{ width: "35%" }}>
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="connectTimeoutMs" label="Timeout (ms)" style={{ width: "30%" }}>
              <InputNumber min={500} max={60000} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="baseDn" label="Base DN" rules={[{ required: true }]}>
            <Input placeholder="DC=company,DC=local" />
          </Form.Item>
          <Form.Item name="userSearchDn" label="User search DN (optional, defaults to Base DN)">
            <Input placeholder="OU=Users,DC=company,DC=local" />
          </Form.Item>
          <Form.Item name="bindUser" label="Service account (bind DN or UPN)" rules={[{ required: true }]}>
            <Input placeholder="svc-trafo360@company.local" />
          </Form.Item>
          <Form.Item
            name="bindPassword"
            label={`Service account password${configQuery.data?.bindPasswordSet ? " (leave blank to keep current)" : ""}`}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="userSearchFilter" label="User search filter" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="groupSearchBase" label="Group search base (optional)">
            <Input placeholder="OU=Groups,DC=company,DC=local" />
          </Form.Item>
          <Form.Item name="domain" label="Domain (optional, for display only)">
            <Input placeholder="company.local" />
          </Form.Item>
          <Button type="primary" loading={busy === "save"} onClick={onSave}>
            Save configuration
          </Button>
        </Form>
      </Card>

      <Space direction="vertical" style={{ width: "100%" }}>
        <Space>
          <Button loading={busy === "test"} onClick={onTest}>
            Test connection
          </Button>
          <Button loading={busy === "sync"} onClick={onSync}>
            Sync now
          </Button>
        </Space>

        {testResult && (
          <Alert
            type={testResult.success ? "success" : "error"}
            message={testResult.message}
            showIcon
            closable
            onClose={() => setTestResult(null)}
          />
        )}
        {syncResult && (
          <Alert
            type="success"
            message={`Sync complete: ${syncResult.created} created, ${syncResult.updated} updated (${syncResult.total} total).`}
            showIcon
            closable
            onClose={() => setSyncResult(null)}
          />
        )}
      </Space>
    </div>
  );
}
