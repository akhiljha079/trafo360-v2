import { useQuery } from "@tanstack/react-query";
import { Input, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { api } from "../api/client";
import { DocumentDetailDrawer } from "./DocumentDetailDrawer";

interface DocumentRow {
  id: string;
  title: string;
  status: string;
  documentType: { name: string };
  confidentialityLevel: { code: string; name: string };
  project: { id: string; projectNo: string; name: string };
  createdBy: { name: string };
  createdAt: string;
  versions: { versionNo: number }[];
}

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "success",
  REJECTED: "error",
  UNDER_REVIEW: "warning",
  DRAFT: "default",
};

export function DocumentLibraryPage() {
  const [search, setSearch] = useState("");
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["document-library", search],
    queryFn: () => api.get<DocumentRow[]>(`/documents?search=${encodeURIComponent(search)}`),
  });

  return (
    <div>
      <Typography.Title level={3}>Document Library</Typography.Title>
      <Typography.Paragraph type="secondary">
        Every document across every project your confidentiality level permits. Downloads and
        approvals are always authorization-checked server-side, never a raw file link.
      </Typography.Paragraph>
      <Input.Search
        placeholder="Search by title, project number, or project name"
        onSearch={setSearch}
        style={{ width: 360, marginBottom: 16 }}
        allowClear
      />
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        onRow={(record) => ({ onClick: () => setOpenDocumentId(record.id), style: { cursor: "pointer" } })}
        columns={[
          { title: "Title", dataIndex: "title" },
          { title: "Type", dataIndex: ["documentType", "name"] },
          { title: "Project", render: (_, r) => `${r.project.projectNo} — ${r.project.name}` },
          { title: "Version", render: (_, r) => `v${r.versions[0]?.versionNo ?? 0}` },
          {
            title: "Confidentiality",
            dataIndex: ["confidentialityLevel", "name"],
            render: (v) => <Tag>{v}</Tag>,
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (v: string) => <Tag color={STATUS_COLOR[v] ?? "default"}>{v.replace(/_/g, " ")}</Tag>,
          },
          { title: "Uploaded By", dataIndex: ["createdBy", "name"] },
          { title: "Date", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleDateString() },
        ]}
      />

      <DocumentDetailDrawer documentId={openDocumentId} onClose={() => setOpenDocumentId(null)} />
    </div>
  );
}
