import { useQuery } from "@tanstack/react-query";
import { Card, Empty, List, Tag, Typography } from "antd";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";

interface SearchResults {
  projects: { id: string; projectNo: string; name: string; status: string; customer: { name: string } }[];
  documents: {
    id: string;
    title: string;
    status: string;
    project: { id: string; projectNo: string; name: string };
    documentType: { name: string };
  }[];
  physicalFiles: {
    id: string;
    fileCode: string;
    status: string;
    project: { id: string; projectNo: string; name: string };
  }[];
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";

  const query = useQuery({
    queryKey: ["global-search", q],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

  const results = query.data;
  const totalResults = (results?.projects.length ?? 0) + (results?.documents.length ?? 0) + (results?.physicalFiles.length ?? 0);

  return (
    <div>
      <Typography.Title level={3}>Search results for "{q}"</Typography.Title>
      {q.trim().length < 2 ? (
        <Typography.Text type="secondary">Type at least 2 characters to search.</Typography.Text>
      ) : query.isLoading ? (
        <Typography.Text type="secondary">Searching…</Typography.Text>
      ) : totalResults === 0 ? (
        <Empty description="No matching projects, documents, or physical files" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {results!.projects.length > 0 && (
            <Card title={`Projects (${results!.projects.length})`}>
              <List
                dataSource={results!.projects}
                renderItem={(p) => (
                  <List.Item>
                    <Link to={`/projects/${p.id}`}>
                      {p.projectNo} — {p.name}
                    </Link>
                    <span style={{ marginLeft: "auto" }}>
                      <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                        {p.customer.name}
                      </Typography.Text>
                      <Tag>{p.status}</Tag>
                    </span>
                  </List.Item>
                )}
              />
            </Card>
          )}
          {results!.documents.length > 0 && (
            <Card title={`Documents (${results!.documents.length})`}>
              <List
                dataSource={results!.documents}
                renderItem={(d) => (
                  <List.Item>
                    <Link to={`/projects/${d.project.id}`}>
                      {d.title} <Typography.Text type="secondary">({d.documentType.name})</Typography.Text>
                    </Link>
                    <span style={{ marginLeft: "auto" }}>
                      <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                        {d.project.projectNo}
                      </Typography.Text>
                      <Tag>{d.status}</Tag>
                    </span>
                  </List.Item>
                )}
              />
            </Card>
          )}
          {results!.physicalFiles.length > 0 && (
            <Card title={`Physical Files (${results!.physicalFiles.length})`}>
              <List
                dataSource={results!.physicalFiles}
                renderItem={(f) => (
                  <List.Item>
                    <Link to="/physical-files">{f.fileCode}</Link>
                    <span style={{ marginLeft: "auto" }}>
                      <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                        {f.project.projectNo}
                      </Typography.Text>
                      <Tag>{f.status}</Tag>
                    </span>
                  </List.Item>
                )}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
