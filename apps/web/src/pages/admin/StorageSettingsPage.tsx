import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Form, Input, Switch, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface StorageConfig {
  nfsEnabled: boolean;
  nfsHost: string;
  nfsExportPath: string;
  nfsMountPath: string;
}

interface StorageHealth {
  nfsOnline: boolean;
  totalDocuments: number;
  nfsDocuments: number;
  localPendingDocuments: number;
  syncFailedDocuments: number;
  storageUsedBytes: string;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function StorageSettingsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const configQuery = useQuery({ queryKey: ["storage-config"], queryFn: () => api.get<StorageConfig>("/admin/storage-config") });
  const healthQuery = useQuery({
    queryKey: ["storage-health"],
    queryFn: () => api.get<StorageHealth>("/storage/health"),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (configQuery.data) form.setFieldsValue(configQuery.data);
  }, [configQuery.data, form]);

  async function onSave() {
    const values = await form.validateFields();
    setBusy("save");
    setTestResult(null);
    try {
      await api.put("/admin/storage-config", values);
      qc.invalidateQueries({ queryKey: ["storage-config"] });
      qc.invalidateQueries({ queryKey: ["storage-health"] });
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const result = await api.post<{ success: boolean; message: string }>("/admin/storage-config/test-connection", {});
      setTestResult(result);
      qc.invalidateQueries({ queryKey: ["storage-health"] });
    } finally {
      setBusy(null);
    }
  }

  const health = healthQuery.data;

  return (
    <div style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">
        Documents are written to the NFS directory below when it's reachable, and automatically fall
        back to local storage on this server otherwise - a background job syncs anything stored
        locally back to NFS once it comes back online. Test the connection after saving, before
        relying on it.
      </Typography.Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="This page only tells the app where to read/write - it does not mount the Synology share itself"
        description="The NFS mount path below must already be a real OS-level NFS mount (set up by a server admin via /etc/fstab or similar) pointing at the Synology export. Saving a path here that isn't actually mounted just means every write falls back to local storage - not an error, but not using the Synology either."
      />

      <Card title="NFS configuration" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="nfsEnabled" label="Use NFS when reachable" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="nfsHost" label="Synology host (for reference only)">
            <Input placeholder="192.168.0.221" />
          </Form.Item>
          <Form.Item name="nfsExportPath" label="NFS export path (for reference only)">
            <Input placeholder="/volume1/trafo360" />
          </Form.Item>
          <Form.Item
            name="nfsMountPath"
            label="Local mount directory the app reads/writes through"
            rules={[{ required: true }]}
            extra="Must be a real, already-mounted directory on this server - e.g. /mnt/synology-nfs"
          >
            <Input placeholder="/mnt/synology-nfs" />
          </Form.Item>
          <Button type="primary" loading={busy === "save"} onClick={onSave}>
            Save configuration
          </Button>{" "}
          <Button loading={busy === "test"} onClick={onTest}>
            Test connection
          </Button>
        </Form>
        {testResult && (
          <Alert
            style={{ marginTop: 16 }}
            type={testResult.success ? "success" : "error"}
            message={testResult.message}
            showIcon
            closable
            onClose={() => setTestResult(null)}
          />
        )}
      </Card>

      <Card title="Storage health" loading={healthQuery.isLoading}>
        {health && (
          <Descriptions column={1} size="small">
            <Descriptions.Item label="NFS status">
              <Tag color={health.nfsOnline ? "green" : "red"}>{health.nfsOnline ? "Online" : "Offline (using local fallback)"}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Documents on NFS">{health.nfsDocuments} / {health.totalDocuments}</Descriptions.Item>
            <Descriptions.Item label="Pending sync to NFS">{health.localPendingDocuments}</Descriptions.Item>
            <Descriptions.Item label="Failed sync">{health.syncFailedDocuments}</Descriptions.Item>
            <Descriptions.Item label="Total storage used">{formatBytes(Number(health.storageUsedBytes))}</Descriptions.Item>
            <Descriptions.Item label="Last successful sync">
              {health.lastSuccessfulSyncAt ? new Date(health.lastSuccessfulSyncAt).toLocaleString() : "—"}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>
    </div>
  );
}
