import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

// A lightweight fetcher just to get the generic latest load
async function fetchLatestLoad() {
  const res = await fetch("/api/loads?limit=1"); 
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null; // Return the first (newest) load
}

export function NewLoadWatcher() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // Store ALL known load IDs to avoid false positives from list reordering
  const knownLoadIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  // Poll every 3 seconds (Fast check)
  const { data: latestLoad } = useQuery({
    queryKey: ["latest-load-check"],
    queryFn: fetchLatestLoad,
    refetchInterval: 3000, 
    refetchIntervalInBackground: true, // Keep checking even if tab is hidden
  });

  useEffect(() => {
    if (!latestLoad) return;

    const loadId = String(latestLoad.id);

    // 1. Initial Load (First run): Just save the ID, don't notify.
    if (!initialized.current) {
      knownLoadIds.current.add(loadId);
      initialized.current = true;
      return;
    }

    // 2. Check if this is a TRULY new load we've never seen before
    if (!knownLoadIds.current.has(loadId)) {
      // Add to known IDs
      knownLoadIds.current.add(loadId);

      // Also verify it was created recently (within last 60 seconds) to avoid false positives
      const createdAt = latestLoad.createdAt ? new Date(latestLoad.createdAt) : null;
      const now = new Date();
      const ageSeconds = createdAt ? (now.getTime() - createdAt.getTime()) / 1000 : 999;
      
      // Only notify if load was created within the last 60 seconds
      if (ageSeconds > 60) {
        console.log(`Skipping notification for old load #${latestLoad.loadNumber} (${ageSeconds}s old)`);
        return;
      }

      // --- PLAY SOUND ---
      // This is a crisp "Success Chime"
      const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      audio.volume = 1.0; // Max volume
      
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.log("Audio Autoplay prevented by browser:", error);
          // Fallback: We could show a visual alert if sound fails
        });
      }

      // --- SHOW POPUP ---
      toast({
        title: "🔔 New Load Detected!",
        description: `Load #${latestLoad.loadNumber} • $${latestLoad.rate}`,
        duration: 8000, 
        className: "bg-emerald-900 border-emerald-800 text-white",
        action: (
          <Button 
            size="sm" 
            className="bg-emerald-500 hover:bg-emerald-400 text-white border-0 font-bold"
            onClick={() => setLocation(`/loads/${latestLoad.id}`)}
          >
            View <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        ),
      });
    }
  }, [latestLoad, toast, setLocation]);

  return null; // This component is invisible
}
