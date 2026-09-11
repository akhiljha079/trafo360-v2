import { useQuery } from "@tanstack/react-query";
import { Alert, Spin } from "antd";
import { Navigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";

interface PhysicalFile {
  id: string;
  fileCode: string;
  project: { id: string };
}

/** Spec §26: scanning a physical file's QR opens its project page after
 * authentication - the QR itself only ever contains this token, never
 * document content or a raw path. `RequireAuth` (this route sits inside it)
 * already handles the "after authentication" part. */
export function QrResolverPage() {
  const { token } = useParams<{ token: string }>();
  const query = useQuery({
    queryKey: ["pf-resolve", token],
    queryFn: () => api.get<PhysicalFile>(`/pf/${token}`),
    retry: false,
  });

  if (query.error instanceof ApiError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Could not open this physical file"
        description={query.error.message}
        style={{ margin: 24 }}
      />
    );
  }
  if (query.data) return <Navigate to={`/projects/${query.data.project.id}`} replace />;
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
      <Spin size="large" />
    </div>
  );
}
