import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Bell, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

async function fetchLatestLoad() {
  const res = await fetch("/api/loads?limit=1");
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

export function NewLoadWatcher() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const lastKnownLoadId = useRef<string | null>(null);

  const { data: latestLoad } = useQuery({
    queryKey: ["latest-load-check"],
    queryFn: fetchLatestLoad,
    refetchInterval: 5000, 
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!latestLoad) return;

    if (lastKnownLoadId.current === null) {
      lastKnownLoadId.current = latestLoad.id;
      return;
    }

    if (latestLoad.id !== lastKnownLoadId.current) {
      lastKnownLoadId.current = latestLoad.id;

      const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      audio.volume = 0.5;
      audio.play().catch(e => console.log("Audio blocked by browser", e));

      toast({
        title: "🚀 New Load Detected!",
        description: `Load #${latestLoad.loadNumber} from ${latestLoad.brokerName || 'Unknown Broker'}`,
        duration: 8000,
        action: (
          <Button 
            size="sm" 
            className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
            onClick={() => setLocation(`/loads/${latestLoad.id}`)}
          >
            View <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        ),
      });
    }
  }, [latestLoad, toast, setLocation]);

  return null;
}
