import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Image, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { api, ApiError } from "../../api/client";

interface WhatsappStatus {
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED";
  connectedAt: string | null;
  lastSeenAt: string | null;
  qrDataUrl: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  DISCONNECTED: "default",
  CONNECTING: "processing",
  CONNECTED: "success",
};

export function WhatsappSettingsPage() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const statusQuery = useQuery({ queryKey: ["whatsapp-status"], queryFn: () => api.get<WhatsappStatus>("/admin/whatsapp/status") });

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ qrDataUrl: string | null; status: string }>("/admin/whatsapp/connect");
      setQrDataUrl(result.qrDataUrl);
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.post("/admin/whatsapp/disconnect");
      setQrDataUrl(null);
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Typography.Paragraph type="secondary">
        WhatsApp Web automation (not the WhatsApp Business API) - a controlled browser session, not
        credential storage. Rides on an unofficial channel that WhatsApp's own policy/UI changes can
        break at any time; email remains the authoritative notification channel. Session data lives
        server-side only and is never exposed through any API response - only connection status is.
      </Typography.Paragraph>

      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space>
            <Typography.Text strong>Status:</Typography.Text>
            <Tag color={STATUS_COLOR[statusQuery.data?.status ?? "DISCONNECTED"]}>{statusQuery.data?.status}</Tag>
          </Space>
          {statusQuery.data?.connectedAt && (
            <Typography.Text type="secondary">
              Connected since {new Date(statusQuery.data.connectedAt).toLocaleString()}
            </Typography.Text>
          )}

          <Space>
            <Button type="primary" loading={busy} onClick={connect} disabled={statusQuery.data?.status === "CONNECTED"}>
              Connect
            </Button>
            <Button danger loading={busy} onClick={disconnect} disabled={statusQuery.data?.status === "DISCONNECTED"}>
              Disconnect
            </Button>
          </Space>

          {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}

          {qrDataUrl && (
            <div style={{ textAlign: "center" }}>
              <Typography.Paragraph>Scan this QR code with WhatsApp on the admin's phone:</Typography.Paragraph>
              <Image src={qrDataUrl} width={240} preview={false} />
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
}
