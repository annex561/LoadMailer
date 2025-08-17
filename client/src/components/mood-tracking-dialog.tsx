import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Smile, Users, Clock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Driver } from "@shared/schema";

interface MoodTrackingDialogProps {
  driver: Driver;
  trigger?: React.ReactNode;
}

const MOOD_OPTIONS = [
  { emoji: "😊", label: "Happy", value: "happy", color: "bg-green-100 text-green-800 border-green-200" },
  { emoji: "😐", label: "Neutral", value: "neutral", color: "bg-gray-100 text-gray-800 border-gray-200" },
  { emoji: "😔", label: "Stressed", value: "stressed", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  { emoji: "😤", label: "Frustrated", value: "frustrated", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { emoji: "😴", label: "Tired", value: "tired", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { emoji: "🤒", label: "Sick", value: "sick", color: "bg-red-100 text-red-800 border-red-200" },
];

export function MoodTrackingDialog({ driver, trigger }: MoodTrackingDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedMood, setSelectedMood] = useState<string>("");
  const [note, setNote] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const moodMutation = useMutation({
    mutationFn: async ({ mood, note }: { mood: string; note?: string }) => {
      return apiRequest(`/api/drivers/${driver.id}/mood`, {
        method: "POST",
        body: JSON.stringify({ mood, note }),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      toast({
        title: "Mood Updated",
        description: `${driver.name}'s mood has been updated successfully.`,
      });
      setOpen(false);
      setSelectedMood("");
      setNote("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update driver mood. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!selectedMood) return;
    moodMutation.mutate({ mood: selectedMood, note: note.trim() || undefined });
  };

  const getCurrentMoodDisplay = () => {
    if (!driver.currentMood) return null;
    
    const moodOption = MOOD_OPTIONS.find(m => m.value === driver.currentMood);
    if (!moodOption) return null;

    return (
      <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <span className="text-xl">{moodOption.emoji}</span>
        <div className="flex-1">
          <p className="font-medium text-gray-900">{moodOption.label}</p>
          {driver.moodUpdatedAt && (
            <p className="text-sm text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(driver.moodUpdatedAt).toLocaleString()}
            </p>
          )}
          {driver.moodNote && (
            <p className="text-sm text-gray-600 mt-1">"{driver.moodNote}"</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" data-testid={`mood-tracker-${driver.id}`}>
            <Smile className="w-4 h-4 mr-2" />
            Mood
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-white border border-gray-300 shadow-lg max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Track Mood - {driver.name}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Current Mood Display */}
          {driver.currentMood && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Current Mood</h4>
              {getCurrentMoodDisplay()}
            </div>
          )}

          {/* Mood Selection */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-3">Update Mood</h4>
            <div className="grid grid-cols-2 gap-2">
              {MOOD_OPTIONS.map((mood) => (
                <button
                  key={mood.value}
                  onClick={() => setSelectedMood(mood.value)}
                  className={`p-3 rounded-lg border-2 transition-all hover:scale-105 ${
                    selectedMood === mood.value
                      ? `${mood.color} border-opacity-100 ring-2 ring-blue-500 ring-opacity-50`
                      : "bg-white border-gray-200 hover:border-gray-300"
                  }`}
                  data-testid={`mood-option-${mood.value}`}
                >
                  <div className="text-2xl mb-1">{mood.emoji}</div>
                  <div className="text-sm font-medium">{mood.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Optional Note */}
          <div>
            <label htmlFor="mood-note" className="block text-sm font-medium text-gray-700 mb-2">
              Optional Note
            </label>
            <Textarea
              id="mood-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about the driver's mood or situation..."
              className="bg-white border border-gray-300"
              rows={3}
              data-testid="mood-note-input"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              onClick={handleSubmit}
              disabled={!selectedMood || moodMutation.isPending}
              className="flex-1"
              data-testid="update-mood-button"
            >
              {moodMutation.isPending ? "Updating..." : "Update Mood"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="px-6"
              data-testid="cancel-mood-button"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}