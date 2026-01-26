import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, CheckCircle, MapPin, Navigation, UploadCloud, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRef } from "react";

export default function DriverLoadView() {
  const [match, params] = useRoute("/driver/load/:id");
  const id = params?.id;
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: load, isLoading } = useQuery({
    queryKey: [`/api/loads/${id}`],
  });

  const confirmLoad = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/loads/${id}`, { status: "dispatched" });
      await apiRequest("POST", `/api/sop/update-step`, { loadId: id, step: "tripMessage", value: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/loads/${id}`] });
      toast({ title: "Confirmed!", description: "Dispatch has been notified." });
    }
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("loadId", id || "");
      formData.append("documentType", "bol");
      
      const response = await fetch(`/api/loads/${id}/documents`, { 
        method: "POST", 
        body: formData 
      });
      
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/loads/${id}`] });
      toast({ title: "Success", description: "Document uploaded securely." });
    },
    onError: () => {
      toast({ title: "Upload Failed", description: "Please try again.", variant: "destructive" });
    }
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      uploadPhoto.mutate(e.target.files[0]);
    }
  };

  if (isLoading) return <div className="p-8 text-center">Loading Load Details...</div>;
  if (!load) return <div className="p-8 text-center text-red-500">Load not found.</div>;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 p-4 pb-24">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Load #{load.loadNumber}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">TRAQ IQ Logistics</p>
        </div>
        <Badge className="bg-emerald-600 text-sm px-3 py-1">{(load.status || 'pending').toUpperCase()}</Badge>
      </div>

      <Card className="mb-3 shadow-sm border-0 dark:bg-slate-800">
        <CardContent className="pt-4 space-y-4">
          <div className="relative pl-6 border-l-2 border-emerald-500">
            <div className="absolute -left-[7px] top-0 w-3 h-3 rounded-full bg-emerald-500" />
            <h3 className="text-xs font-bold text-slate-400 uppercase">Pickup</h3>
            <p className="text-base font-bold text-slate-900 dark:text-white">{load.originCity || load.pickupAddress || 'TBD'}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{load.pickupDate ? new Date(load.pickupDate).toLocaleDateString() : 'TBD'}</p>
            <Button variant="outline" size="sm" className="mt-2 w-full gap-2 text-emerald-500 border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20">
              <Navigation className="w-4 h-4" /> Start Navigation
            </Button>
          </div>

          <div className="relative pl-6 border-l-2 border-red-500">
            <div className="absolute -left-[7px] top-0 w-3 h-3 rounded-full bg-red-500" />
            <h3 className="text-xs font-bold text-slate-400 uppercase">Delivery</h3>
            <p className="text-base font-bold text-slate-900 dark:text-white">{load.destCity || load.deliveryAddress || 'TBD'}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{load.deliveryDate ? new Date(load.deliveryDate).toLocaleDateString() : 'TBD'}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4 shadow-sm border-0 dark:bg-slate-800">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs uppercase text-slate-500 dark:text-slate-400">Cargo Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0">
          <div className="bg-slate-50 dark:bg-slate-700 p-3 rounded-lg">
            <p className="text-xs text-slate-400">Weight</p>
            <p className="font-bold text-slate-800 dark:text-white">{load.weight ? `${load.weight.toLocaleString()} lbs` : 'TBD'}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-700 p-3 rounded-lg">
            <p className="text-xs text-slate-400">Rate</p>
            <p className="font-bold text-emerald-600 dark:text-emerald-400">${load.rate || 0}</p>
          </div>
        </CardContent>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t dark:border-slate-700 p-4 flex gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <input 
          type="file" 
          accept="image/*" 
          capture="environment" 
          ref={fileInputRef} 
          className="hidden" 
          onChange={handleFileSelect}
        />

        <Button 
          variant="outline" 
          className="flex-1 h-12 gap-2 border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600"
          onClick={() => window.open("tel:4235550100")}
        >
          <Phone className="w-5 h-5" /> Call Dispatch
        </Button>

        {load.status === "booked" ? (
          <Button 
            className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 gap-2 text-base font-semibold"
            onClick={() => confirmLoad.mutate()}
            disabled={confirmLoad.isPending}
          >
            <CheckCircle className="w-5 h-5" />
            {confirmLoad.isPending ? "Confirming..." : "Accept Load"}
          </Button>
        ) : (
          <Button 
            className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 gap-2 text-base font-semibold"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadPhoto.isPending}
          >
            <Camera className="w-5 h-5" /> {uploadPhoto.isPending ? "Uploading..." : "Upload BOL"}
          </Button>
        )}
      </div>
    </div>
  );
}
