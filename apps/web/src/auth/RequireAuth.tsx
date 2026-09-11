import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./useAuth";

export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const loadMe = useAuth((s) => s.loadMe);

  useEffect(() => {
    if (status === "unknown") void loadMe();
  }, [status, loadMe]);

  if (status === "unknown") return null;
  if (status === "unauthenticated") return <Navigate to="/login" replace />;
  return <Outlet />;
}
