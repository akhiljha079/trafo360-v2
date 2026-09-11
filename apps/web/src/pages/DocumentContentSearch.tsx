import { FileSearchOutlined, SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Card, Empty, Input, List, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface DocumentSearchResult {
  id: string;
  title: string;
  status: string;
  project: { id: string; projectNo: string; name: string };
  documentType: { name: string };
  contentSnippet: string | null;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Dashboard document search - searches inside document *content*, not
 * just titles, via OCR text extracted by the worker's background job (see
 * apps/worker/src/run-ocr.ts). A scanned certificate, drawing, or report
 * becomes findable by anything written on the page, not just what it was
 * named on upload. Reuses the same /search endpoint the header's
 * GlobalSearch hits, filtered down to just the documents portion here. */
export function DocumentContentSearch() {
  const [value, setValue] = useState("");
  const query = useDebounced(value, 400);

  const search = useQuery({
    queryKey: ["document-content-search", query],
    queryFn: () => api.get<{ documents: DocumentSearchResult[] }>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
  });

  const results = search.data?.documents ?? [];

  return (
    <Card>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        <FileSearchOutlined /> Search Document Content
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Searches text extracted from uploaded files (OCR for scans/images, embedded text for
        digital PDFs) - not just the document title.
      </Typography.Paragraph>
      <Input
        prefix={<SearchOutlined />}
        placeholder="Search inside certificates, drawings, reports…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        allowClear
      />
      {query.trim().length >= 2 && (
        <List
          style={{ marginTop: 12 }}
          loading={search.isFetching}
          dataSource={results}
          locale={{ emptyText: <Empty description="No documents match" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(doc) => (
            <List.Item>
              <div style={{ width: "100%" }}>
                <Link to={`/documents?open=${doc.id}`}>
                  <Typography.Text strong>{doc.title}</Typography.Text>
                </Link>{" "}
                <Tag>{doc.documentType.name}</Tag>
                {doc.contentSnippet && <Tag color="blue">content match</Tag>}
                <div style={{ fontSize: 12, color: "#888" }}>
                  {doc.project.projectNo} — {doc.project.name}
                </div>
                {doc.contentSnippet && (
                  <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: 12, marginTop: 4, marginBottom: 0, fontStyle: "italic" }}
                  >
                    "{doc.contentSnippet}"
                  </Typography.Paragraph>
                )}
              </div>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
