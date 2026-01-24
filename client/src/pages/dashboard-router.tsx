import { useUser } from "@/hooks/use-user";
import LoadOpsDashboard from "./loadops-dashboard";
import DispatcherWorkbench from "./dispatcher-workbench";
import MobileDriverDashboard from "./mobile-driver-dashboard";
import { Loader2 } from "lucide-react";

export default function DashboardRouter() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-slate-100 dark:bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <LoadOpsDashboard />;
  }

  if (user.role === "admin" || user.role === "executive") {
    return <LoadOpsDashboard />;
  }

  if (user.role === "dispatcher") {
    return <DispatcherWorkbench />;
  }

  if (user.role === "driver") {
    return <MobileDriverDashboard />;
  }

  return <LoadOpsDashboard />;
}
