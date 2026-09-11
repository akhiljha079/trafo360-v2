import { create } from "zustand";
import { api } from "../api/client";

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
}

interface AuthState {
  user: AuthenticatedUser | null;
  status: "unknown" | "authenticated" | "unauthenticated";
  loadMe: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (code: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: "unknown",
  async loadMe() {
    try {
      const user = await api.get<AuthenticatedUser>("/auth/me");
      set({ user, status: "authenticated" });
    } catch {
      set({ user: null, status: "unauthenticated" });
    }
  },
  async login(username, password) {
    const user = await api.post<AuthenticatedUser>("/auth/login", { username, password });
    set({ user, status: "authenticated" });
  },
  async logout() {
    await api.post("/auth/logout");
    set({ user: null, status: "unauthenticated" });
  },
  hasPermission(code) {
    return get().user?.permissions.includes(code) ?? false;
  },
}));
