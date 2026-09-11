import { useQuery } from "@tanstack/react-query";
import { Input, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { api } from "../api/client";
import { PhysicalFileDrawer } from "./PhysicalFileDrawer";

interface PhysicalFileRow {
  id: string;
  fileCode: string;
  status: string;
  building: string | null;
  floor: string | null;
  room: string | null;
  rack: string | null;
  shelf: string | null;
  box: string | null;
  project: { projectNo: string; name: string; customer: { name: string } };
  confidentialityLevel: { name: string };
}

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "success",
  ISSUED: "processing",
  ARCHIVED: "default",
  LOST: "error",
};

export function PhysicalFilesPage() {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["physical-files-list", search],
    queryFn: () => api.get<PhysicalFileRow[]>(`/physical-files?search=${encodeURIComponent(search)}`),
  });

  return (
    <div>
      <Typography.Title level={3}>Physical Files</Typography.Title>
      <Typography.Paragraph type="secondary">
        Physical project file register. Create a physical file record from a project's detail page.
      </Typography.Paragraph>
      <Input.Search
        placeholder="Search by file code, project number, or project name"
        onSearch={setSearch}
        style={{ width: 360, marginBottom: 16 }}
        allowClear
      />
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        onRow={(record) => ({ onClick: () => setOpenId(record.id), style: { cursor: "pointer" } })}
        columns={[
          { title: "File Code", dataIndex: "fileCode" },
          { title: "Project", render: (_, r) => `${r.project.projectNo} — ${r.project.name}` },
          { title: "Customer", dataIndex: ["project", "customer", "name"] },
          {
            title: "Location",
            render: (_, r) => [r.building, r.floor, r.room, r.rack, r.shelf, r.box].filter(Boolean).join(" / ") || "—",
          },
          { title: "Confidentiality", dataIndex: ["confidentialityLevel", "name"], render: (v) => <Tag>{v}</Tag> },
          { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={STATUS_COLOR[v] ?? "default"}>{v}</Tag> },
        ]}
      />

      <PhysicalFileDrawer physicalFileId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
