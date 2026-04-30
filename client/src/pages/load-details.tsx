import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { EVChecklist } from "@/components/load-lifecycle/EVChecklist";
import {
  Loader2,
  MapPin,
  Truck,
  DollarSign,
  Weight,
  ArrowRight,
  Calendar,
  FileText,
  Phone,
  Building,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LoadDetailsPageProps {
  /** Optional explicit id, used when this page is rendered outside a wouter Route
   *  (e.g. from the loadops-dashboard renderContent switch). When omitted, the
   *  id is read from useParams and then from the location pathname as fallback. */
  id?: string;
}

export default function LoadDetailsPage({ id: idProp }: LoadDetailsPageProps = {}) {
  const params = useParams<{ id: string }>();
  const [location] = useLocation();
  // Resolve id from (1) explicit prop (2) wouter useParams (3) /loads/<id> path
  const fallbackFromPath = location.match(/^\/loads\/([^/]+)$/)?.[1];
  const id = idProp ?? params.id ?? fallbackFromPath;

  const { data: load, isLoading, error } = useQuery<any>({
    queryKey: [`/api/loads/${id}`],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-4rem)] bg-slate-100 dark:bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !load) {
    return (
      <div className="flex flex-col justify-center items-center h-[calc(100vh-4rem)] bg-slate-100 dark:bg-slate-900">
        <p className="text-slate-500 dark:text-slate-400 text-lg">Load not found</p>
        <p className="text-slate-400 dark:text-slate-500 text-sm mt-2">
          The requested load could not be loaded.
        </p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    new: "bg-gray-100 text-gray-800",
    offered: "bg-blue-100 text-blue-800",
    booked: "bg-purple-100 text-purple-800",
    scheduled: "bg-indigo-100 text-indigo-800",
    in_transit: "bg-amber-100 text-amber-800",
    delivered: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    expired: "bg-gray-100 text-gray-600",
  };

  const lifecycleStatus = load.lifecycleStatus || load.status || "unknown";

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row bg-slate-100 dark:bg-slate-900 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start gap-4 bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Load #{load.loadNumber}
              </h1>
              <Badge className={statusColors[lifecycleStatus] || "bg-gray-100"}>
                {lifecycleStatus.replace("_", " ").toUpperCase()}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <MapPin className="w-4 h-4" />
              <span>
                {load.originCity || load.pickupAddress?.split(",")[0]},{" "}
                {load.originState || ""}
              </span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              <span>
                {load.destCity || load.deliveryAddress?.split(",")[0]},{" "}
                {load.destState || ""}
              </span>
            </div>
            {load.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {load.description}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-600">
              ${load.rate?.toLocaleString() || "0"}
            </div>
            {load.rpm && (
              <div className="text-sm text-slate-400">Rate Per Mile: ${load.rpm.toFixed(2)}</div>
            )}
            {load.miles && (
              <div className="text-sm text-slate-400">{load.miles.toLocaleString()} miles</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Truck className="w-4 h-4" /> Equipment & Weight
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Equipment:</span>
                  <span className="font-medium">{load.equipmentType || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Weight:</span>
                  <span className="font-medium">
                    {load.weight ? `${load.weight.toLocaleString()} lbs` : "N/A"}
                  </span>
                </div>
                {load.length && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Length:</span>
                    <span className="font-medium">{load.length} ft</span>
                  </div>
                )}
                {load.temperatureRequired && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Temp Range:</span>
                    <span className="font-medium">
                      {load.minTemperature}° - {load.maxTemperature}° {load.temperatureUnit}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Pickup:</span>
                  <span className="font-medium">
                    {load.pickupDate
                      ? new Date(load.pickupDate).toLocaleDateString()
                      : "Not set"}
                    {load.pickupTime && ` @ ${load.pickupTime}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Delivery:</span>
                  <span className="font-medium">
                    {load.deliveryDate
                      ? new Date(load.deliveryDate).toLocaleDateString()
                      : "Not set"}
                    {load.deliveryTime && ` @ ${load.deliveryTime}`}
                  </span>
                </div>
                {load.bookedAt && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Booked:</span>
                    <span className="font-medium">
                      {new Date(load.bookedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Building className="w-4 h-4" /> Contact Info
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {load.company && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Company:</span>
                    <span className="font-medium">{load.company}</span>
                  </div>
                )}
                {load.contactPhone && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phone:</span>
                    <span className="font-medium">{load.contactPhone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Source:</span>
                  <span className="font-medium capitalize">{load.sourceBoard || "manual"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <DocumentCard
                title="Rate Confirmation"
                path={load.rateconPath}
                icon={<FileText className="w-8 h-8" />}
              />
              <DocumentCard
                title="Proof of Delivery"
                path={load.podPath}
                icon={<FileText className="w-8 h-8" />}
              />
              <DocumentCard
                title="Bill of Lading"
                path={null}
                icon={<FileText className="w-8 h-8" />}
              />
              <DocumentCard
                title="Lumper Receipt"
                path={null}
                icon={<FileText className="w-8 h-8" />}
              />
            </div>
          </CardContent>
        </Card>

        {load.specialInstructions && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Special Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                {load.specialInstructions}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="w-full md:w-96 bg-white dark:bg-slate-800 border-l dark:border-slate-700 z-10 overflow-y-auto">
        <EVChecklist load={load} />
      </div>
    </div>
  );
}

function DocumentCard({
  title,
  path,
  icon,
}: {
  title: string;
  path: string | null;
  icon: React.ReactNode;
}) {
  const hasDoc = !!path;

  return (
    <div
      className={`p-4 rounded-lg border text-center transition-colors ${
        hasDoc
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30"
          : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600"
      }`}
    >
      <div
        className={`mx-auto mb-2 ${
          hasDoc ? "text-green-600 dark:text-green-400" : "text-slate-300 dark:text-slate-500"
        }`}
      >
        {icon}
      </div>
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <p className={`text-[10px] mt-1 ${hasDoc ? "text-green-600" : "text-slate-400"}`}>
        {hasDoc ? "Uploaded" : "Pending"}
      </p>
    </div>
  );
}
