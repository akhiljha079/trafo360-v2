import { FileExcelOutlined, FilePdfOutlined, FileTextOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";

const REPORTS: { type: string; title: string; description: string }[] = [
  {
    type: "project-status",
    title: "Project Status Report",
    description: "Every visible project with its stage-completion percentage and current status.",
  },
  {
    type: "document-register",
    title: "Document Register",
    description: "All documents visible to you, with type, confidentiality, status, and current version.",
  },
  {
    type: "physical-file-register",
    title: "Physical File Register",
    description: "All physical file records visible to you, with storage location and status.",
  },
  {
    type: "overdue-extensions",
    title: "Overdue / Extension-Requested Files",
    description: "Physical files currently overdue or with a pending extension request.",
  },
];

export function ReportsPage() {
  return (
    <div>
      <Typography.Title level={3}>Reports</Typography.Title>
      <Typography.Paragraph type="secondary">
        Every report is filtered by your confidentiality access, exactly like the rest of the app - exporting
        never shows more than the UI would.
      </Typography.Paragraph>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {REPORTS.map((r) => (
          <Card key={r.type} title={r.title}>
            <Typography.Paragraph type="secondary">{r.description}</Typography.Paragraph>
            <Space>
              <Button icon={<FileTextOutlined />} href={`/api/reports/${r.type}?format=csv`} target="_blank">
                CSV
              </Button>
              <Button icon={<FileExcelOutlined />} href={`/api/reports/${r.type}?format=xlsx`} target="_blank">
                Excel
              </Button>
              <Button icon={<FilePdfOutlined />} href={`/api/reports/${r.type}?format=pdf`} target="_blank">
                PDF
              </Button>
            </Space>
          </Card>
        ))}
      </Space>
    </div>
  );
}
