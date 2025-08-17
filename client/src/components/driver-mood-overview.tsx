import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Smile, Users, Clock, AlertTriangle, TrendingUp } from "lucide-react";
import { MoodTrackingDialog } from "@/components/mood-tracking-dialog";
import type { Driver } from "@shared/schema";

const MOOD_CONFIG = {
  happy: { emoji: "😊", label: "Happy", color: "bg-green-100 text-green-800 border-green-200" },
  neutral: { emoji: "😐", label: "Neutral", color: "bg-gray-100 text-gray-800 border-gray-200" },
  stressed: { emoji: "😔", label: "Stressed", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  frustrated: { emoji: "😤", label: "Frustrated", color: "bg-orange-100 text-orange-800 border-orange-200" },
  tired: { emoji: "😴", label: "Tired", color: "bg-blue-100 text-blue-800 border-blue-200" },
  sick: { emoji: "🤒", label: "Sick", color: "bg-red-100 text-red-800 border-red-200" },
};

export function DriverMoodOverview() {
  const { data: drivers = [], isLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  if (isLoading) {
    return (
      <Card className="bg-white border border-gray-300 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smile className="w-5 h-5" />
            Driver Mood Tracker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-gray-500">Loading driver moods...</div>
        </CardContent>
      </Card>
    );
  }

  const driversWithMood = drivers.filter(driver => driver.currentMood);
  const driversWithoutMood = drivers.filter(driver => !driver.currentMood);
  
  const moodStats = drivers.reduce((acc, driver) => {
    if (driver.currentMood) {
      acc[driver.currentMood] = (acc[driver.currentMood] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const needsAttention = drivers.filter(driver => 
    driver.currentMood && ['stressed', 'frustrated', 'sick'].includes(driver.currentMood)
  );

  return (
    <div className="space-y-4">
      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white border border-gray-300 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Drivers</p>
                <p className="text-2xl font-bold">{drivers.length}</p>
              </div>
              <Users className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white border border-gray-300 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Mood Tracked</p>
                <p className="text-2xl font-bold">{driversWithMood.length}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white border border-gray-300 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Need Attention</p>
                <p className="text-2xl font-bold text-orange-600">{needsAttention.length}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white border border-gray-300 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">No Mood Data</p>
                <p className="text-2xl font-bold text-gray-500">{driversWithoutMood.length}</p>
              </div>
              <Smile className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Drivers Needing Attention */}
      {needsAttention.length > 0 && (
        <Card className="bg-white border border-orange-200 shadow-sm">
          <CardHeader className="bg-orange-50">
            <CardTitle className="flex items-center gap-2 text-orange-800">
              <AlertTriangle className="w-5 h-5" />
              Drivers Needing Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid gap-3">
              {needsAttention.map((driver) => {
                const moodConfig = MOOD_CONFIG[driver.currentMood as keyof typeof MOOD_CONFIG];
                return (
                  <div key={driver.id} className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{moodConfig?.emoji}</span>
                      <div>
                        <p className="font-medium">{driver.name}</p>
                        <div className="flex items-center gap-2">
                          <Badge className={moodConfig?.color}>{moodConfig?.label}</Badge>
                          {driver.moodUpdatedAt && (
                            <span className="text-sm text-gray-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(driver.moodUpdatedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {driver.moodNote && (
                          <p className="text-sm text-gray-600 mt-1">"{driver.moodNote}"</p>
                        )}
                      </div>
                    </div>
                    <MoodTrackingDialog
                      driver={driver}
                      trigger={
                        <Button variant="outline" size="sm" data-testid={`update-mood-${driver.id}`}>
                          Update
                        </Button>
                      }
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Drivers Mood Status */}
      <Card className="bg-white border border-gray-300 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            All Drivers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {drivers.map((driver) => {
              const moodConfig = driver.currentMood 
                ? MOOD_CONFIG[driver.currentMood as keyof typeof MOOD_CONFIG]
                : null;

              return (
                <div key={driver.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      {moodConfig ? (
                        <span className="text-xl">{moodConfig.emoji}</span>
                      ) : (
                        <Users className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{driver.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={driver.status === "available" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {driver.status}
                        </Badge>
                        {moodConfig ? (
                          <Badge className={moodConfig.color}>{moodConfig.label}</Badge>
                        ) : (
                          <Badge variant="outline">No mood data</Badge>
                        )}
                        {driver.moodUpdatedAt && (
                          <span className="text-sm text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(driver.moodUpdatedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {driver.moodNote && (
                        <p className="text-sm text-gray-600 mt-1">"{driver.moodNote}"</p>
                      )}
                    </div>
                  </div>
                  <MoodTrackingDialog
                    driver={driver}
                    trigger={
                      <Button variant="outline" size="sm" data-testid={`mood-track-${driver.id}`}>
                        <Smile className="w-4 h-4 mr-2" />
                        {moodConfig ? "Update" : "Track"}
                      </Button>
                    }
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Mood Distribution */}
      {Object.keys(moodStats).length > 0 && (
        <Card className="bg-white border border-gray-300 shadow-sm">
          <CardHeader>
            <CardTitle>Mood Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Object.entries(moodStats).map(([mood, count]) => {
                const moodConfig = MOOD_CONFIG[mood as keyof typeof MOOD_CONFIG];
                return (
                  <div key={mood} className="text-center p-4 bg-gray-50 rounded-lg">
                    <div className="text-3xl mb-2">{moodConfig?.emoji}</div>
                    <div className="font-medium">{moodConfig?.label}</div>
                    <div className="text-2xl font-bold text-blue-600">{count}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}