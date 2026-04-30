import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

interface RequireRoleProps {
  roles: string[];
  children: ReactNode;
  redirectTo?: string;
}

export function RequireRole({ roles, children, redirectTo = "/dashboard" }: RequireRoleProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const allowed = !!user && roles.includes(user.role);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLocation("/auth");
      return;
    }
    if (!allowed) {
      toast({
        title: "Access denied",
        description: `This page requires ${roles.join(" or ")} access.`,
        variant: "destructive",
      });
      setLocation(redirectTo);
    }
  }, [isLoading, isAuthenticated, allowed, roles, redirectTo, setLocation, toast]);

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!isAuthenticated || !allowed) {
    return null;
  }

  return <>{children}</>;
}
