import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./api";
export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  enabled: boolean;
  mustChangePassword: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canTest: boolean;
  domainIds?: number[];
  resourceIds?: number[];
}
export function useAuth() {
  return useQuery({
    queryKey: ["auth"],
    queryFn: () => request<{ user: User }>("/api/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}
export function useSessionUpdate() {
  const cache = useQueryClient();
  return (user?: User) => {
    cache.clear();
    if (user) cache.setQueryData(["auth"], { user });
  };
}
export const permits = (
  user: User | undefined,
  permission: "canCreate" | "canEdit" | "canTest",
) => user?.role === "admin" || !!user?.[permission];
