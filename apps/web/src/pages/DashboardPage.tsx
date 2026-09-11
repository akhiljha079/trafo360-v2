import { useQuery } from "@tanstack/react-query";
import { Card, Col, List, Row, Statistic, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { DocumentContentSearch } from "./DocumentContentSearch";

interface DashboardSummary {
  activeProjects: number;
  pendingApprovalsForMe: number;
  filesIssued: number;
  overdueFiles: number;
  stageStatusBreakdown: Record<string, number>;
  recentProjects: { id: string; projectNo: string; name: string; status: string; updatedAt: string }[];
}

const STAGE_STATUS_COLOR: Record<string, string> = {
  COMPLETED: "success",
  UNDER_REVIEW: "processing",
  INCOMPLETE: "default",
};

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const query = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get<DashboardSummary>("/dashboards/summary"),
    refetchInterval: 60000,
  });
  const summary = query.data;

  return (
    <div>
      <Typography.Title level={3}>Welcome, {user?.name}</Typography.Title>
      <Typography.Paragraph type="secondary">
        Signed in as <strong>{user?.roleName ?? "no role assigned"}</strong> with {user?.permissions.length ?? 0}{" "}
        effective permissions.
      </Typography.Paragraph>
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="Active Projects" value={summary?.activeProjects ?? 0} loading={query.isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Pending Approvals (mine)" value={summary?.pendingApprovalsForMe ?? 0} loading={query.isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Files Issued" value={summary?.filesIssued ?? 0} loading={query.isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Overdue Files"
              value={summary?.overdueFiles ?? 0}
              loading={query.isLoading}
              valueStyle={summary && summary.overdueFiles > 0 ? { color: "#cf1322" } : undefined}
            />
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 24 }}>
        <Col span={24}>
          <DocumentContentSearch />
        </Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 24 }}>
        <Col span={12}>
          <Card title="Stage Status Breakdown" loading={query.isLoading}>
            {Object.entries(summary?.stageStatusBreakdown ?? {}).length === 0 ? (
              <Typography.Text type="secondary">No project stages yet.</Typography.Text>
            ) : (
              Object.entries(summary!.stageStatusBreakdown).map(([status, count]) => (
                <div key={status} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <Tag color={STAGE_STATUS_COLOR[status] ?? "default"}>{status}</Tag>
                  <Typography.Text strong>{count}</Typography.Text>
                </div>
              ))
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Recently Updated Projects" loading={query.isLoading}>
            <List
              dataSource={summary?.recentProjects ?? []}
              locale={{ emptyText: "No projects yet." }}
              renderItem={(p) => (
                <List.Item>
                  <Link to={`/projects/${p.id}`}>
                    {p.projectNo} — {p.name}
                  </Link>
                  <Tag>{p.status}</Tag>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
