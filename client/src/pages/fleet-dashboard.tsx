import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Truck, Wrench, ClipboardCheck, AlertTriangle, Users, FileText, Calendar, ArrowRight } from "lucide-react";

export default function FleetDashboard() {
  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['/api/fleet/dashboard'],
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const fleetSummary = dashboard?.fleetSummary || { totalTrucks: 0, activeTrucks: 0, trucksInShop: 0, outOfService: 0 };
  const workOrderStats = dashboard?.workOrders || { total: 0, open: 0, critical: 0, byStatus: {} };
  const compliance = dashboard?.compliance || { expiringDocuments: 0, documentsExpiringIn30Days: [] };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Fleet Reliability Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400">Monitor your fleet's health, maintenance, and compliance</p>
        </div>
        <div className="flex gap-2">
          <Link href="/fleet/trucks">
            <Button variant="outline">
              <Truck className="w-4 h-4 mr-2" />
              Manage Trucks
            </Button>
          </Link>
          <Link href="/fleet/work-orders">
            <Button>
              <Wrench className="w-4 h-4 mr-2" />
              Work Orders
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Fleet</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fleetSummary.totalTrucks}</div>
            <div className="flex gap-2 mt-2">
              <Badge variant="default">{fleetSummary.activeTrucks} Active</Badge>
              {fleetSummary.trucksInShop > 0 && (
                <Badge variant="secondary">{fleetSummary.trucksInShop} In Shop</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Work Orders</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workOrderStats.open}</div>
            {workOrderStats.critical > 0 && (
              <Badge variant="destructive" className="mt-2">
                {workOrderStats.critical} Critical
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Documents</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{compliance.expiringDocuments}</div>
            <p className="text-xs text-muted-foreground mt-2">Next 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Trucks Out of Service</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fleetSummary.outOfService}</div>
            <p className="text-xs text-muted-foreground mt-2">
              {fleetSummary.outOfService === 0 ? "All units operational" : "Need attention"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              Work Order Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(workOrderStats.byStatus || {}).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{status.replace(/_/g, ' ').toLowerCase()}</span>
                  <Badge variant={status === 'OPEN' || status === 'TRIAGED' ? 'default' : 'secondary'}>
                    {count as number}
                  </Badge>
                </div>
              ))}
            </div>
            <Link href="/fleet/work-orders">
              <Button variant="ghost" className="w-full mt-4">
                View All Work Orders
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Expiring Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {compliance.documentsExpiringIn30Days?.length > 0 ? (
              <div className="space-y-2">
                {compliance.documentsExpiringIn30Days.slice(0, 5).map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                    <div>
                      <p className="text-sm font-medium">{doc.docType?.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        Expires: {new Date(doc.expiryDate).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {Math.ceil((new Date(doc.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">No documents expiring soon</p>
            )}
            <Link href="/fleet/documents">
              <Button variant="ghost" className="w-full mt-4">
                Manage Documents
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/fleet/trucks">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Truck className="w-6 h-6 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <h3 className="font-semibold">Truck Management</h3>
                <p className="text-sm text-muted-foreground">View and manage your fleet</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/fleet/inspections">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
                <ClipboardCheck className="w-6 h-6 text-green-600 dark:text-green-300" />
              </div>
              <div>
                <h3 className="font-semibold">Inspections</h3>
                <p className="text-sm text-muted-foreground">Conduct and review inspections</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/fleet/vendors">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <Users className="w-6 h-6 text-purple-600 dark:text-purple-300" />
              </div>
              <div>
                <h3 className="font-semibold">Vendor Directory</h3>
                <p className="text-sm text-muted-foreground">Manage service providers</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
