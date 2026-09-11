import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, message, Modal, Select, Switch, Table, Typography } from "antd";
import { useState } from "react";
import { api } from "../../api/client";

interface NotificationRule {
  id: string;
  eventKey: string;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  inAppEnabled: boolean;
}
interface NotificationTemplate {
  id: string;
  eventKey: string;
  channel: "EMAIL" | "WHATSAPP" | "INAPP";
  subject: string | null;
  body: string;
  active: boolean;
}

export function NotificationSettingsPage() {
  const qc = useQueryClient();
  const [templateForm] = Form.useForm();
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  const eventKeysQuery = useQuery({
    queryKey: ["notification-event-keys"],
    queryFn: () => api.get<string[]>("/notification-templates/event-keys"),
  });
  const rulesQuery = useQuery({ queryKey: ["notification-rules"], queryFn: () => api.get<NotificationRule[]>("/notification-rules") });
  const templatesQuery = useQuery({
    queryKey: ["notification-templates"],
    queryFn: () => api.get<NotificationTemplate[]>("/notification-templates"),
  });

  const ruleByEvent = new Map((rulesQuery.data ?? []).map((r) => [r.eventKey, r]));

  async function toggleRule(eventKey: string, field: "emailEnabled" | "whatsappEnabled" | "inAppEnabled", value: boolean) {
    const current = ruleByEvent.get(eventKey) ?? { emailEnabled: true, whatsappEnabled: false, inAppEnabled: true };
    await api.put("/notification-rules", { eventKey, ...current, [field]: value });
    qc.invalidateQueries({ queryKey: ["notification-rules"] });
  }

  async function saveTemplate() {
    const values = await templateForm.validateFields();
    await api.post("/notification-templates", values);
    message.success("Template saved");
    setTemplateModalOpen(false);
    templateForm.resetFields();
    qc.invalidateQueries({ queryKey: ["notification-templates"] });
  }

  return (
    <div>
      <Typography.Title level={5}>Notification Rules</Typography.Title>
      <Typography.Paragraph type="secondary">
        Per-event channel toggles. Every notification in the app goes through these - flip a switch
        here and every call site respects it without a code change.
      </Typography.Paragraph>
      <Table
        rowKey={(k) => k}
        dataSource={eventKeysQuery.data ?? []}
        pagination={false}
        columns={[
          { title: "Event", render: (key: string) => key.replace(/_/g, " ") },
          {
            title: "Email",
            render: (_, key: string) => (
              <Switch
                checked={ruleByEvent.get(key)?.emailEnabled ?? true}
                onChange={(v) => toggleRule(key, "emailEnabled", v)}
              />
            ),
          },
          {
            title: "WhatsApp",
            render: (_, key: string) => (
              <Switch
                checked={ruleByEvent.get(key)?.whatsappEnabled ?? false}
                onChange={(v) => toggleRule(key, "whatsappEnabled", v)}
              />
            ),
          },
          {
            title: "In-app",
            render: (_, key: string) => (
              <Switch
                checked={ruleByEvent.get(key)?.inAppEnabled ?? true}
                onChange={(v) => toggleRule(key, "inAppEnabled", v)}
              />
            ),
          },
        ]}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        Templates
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Optional per-event, per-channel content with <code>{"{{variable}}"}</code> substitution. Events
        without a template use a generic fallback message.
      </Typography.Paragraph>
      <Button onClick={() => setTemplateModalOpen(true)} style={{ marginBottom: 12 }}>
        Add / edit template
      </Button>
      <Table
        rowKey="id"
        dataSource={templatesQuery.data ?? []}
        columns={[
          { title: "Event", dataIndex: "eventKey" },
          { title: "Channel", dataIndex: "channel" },
          { title: "Subject", dataIndex: "subject", render: (v) => v ?? "—" },
          { title: "Active", dataIndex: "active", render: (v: boolean) => (v ? "Yes" : "No") },
        ]}
      />

      <Modal title="Save notification template" open={templateModalOpen} onCancel={() => setTemplateModalOpen(false)} onOk={saveTemplate}>
        <Form form={templateForm} layout="vertical">
          <Form.Item name="eventKey" label="Event" rules={[{ required: true }]}>
            <Select options={eventKeysQuery.data?.map((k) => ({ value: k, label: k.replace(/_/g, " ") }))} />
          </Form.Item>
          <Form.Item name="channel" label="Channel" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "EMAIL", label: "Email" },
                { value: "WHATSAPP", label: "WhatsApp" },
                { value: "INAPP", label: "In-app" },
              ]}
            />
          </Form.Item>
          <Form.Item name="subject" label="Subject (email/in-app title)">
            <Input />
          </Form.Item>
          <Form.Item name="body" label="Body" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="e.g. Your document {{documentTitle}} was rejected: {{comment}}" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
