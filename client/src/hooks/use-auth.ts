import { useUser } from "./use-user";

export function useAuth() {
  const { user, isLoading, isAuthenticated, error } = useUser();
  
  return {
    user: user ? {
      ...user,
      username: user.name || user.email || "User",
      role: user.role || "dispatcher"
    } : null,
    isLoading,
    isAuthenticated,
    error,
  };
}
