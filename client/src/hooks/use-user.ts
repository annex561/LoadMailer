import { useQuery } from "@tanstack/react-query";

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "dispatcher" | "executive" | "driver" | "ev";
  companyId?: string;
  profileImageUrl?: string;
}

export function useUser() {
  const { data: user, isLoading, error } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    error,
  };
}

export function useUserRole() {
  const { user, isLoading } = useUser();
  
  return {
    role: user?.role || null,
    isAdmin: user?.role === "admin" || user?.role === "executive",
    isDispatcher: user?.role === "dispatcher",
    isDriver: user?.role === "driver",
    isEV: user?.role === "ev",
    isLoading,
  };
}
