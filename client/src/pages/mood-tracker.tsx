import { DriverMoodOverview } from "@/components/driver-mood-overview";

export function MoodTracker() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Driver Mood Tracker</h1>
        <p className="text-gray-600 mt-2">
          Monitor team morale and driver wellbeing with emoji-based mood tracking
        </p>
      </div>
      
      <DriverMoodOverview />
    </div>
  );
}