import { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  change: {
    value: string;
    trend: "up" | "down";
  };
  icon: LucideIcon;
  iconBgColor: string;
  iconColor: string;
}

export default function StatsCard({ 
  title, 
  value, 
  change, 
  icon: Icon, 
  iconBgColor, 
  iconColor 
}: StatsCardProps) {
  const TrendIcon = change.trend === "up" ? TrendingUp : TrendingDown;
  const trendColor = change.trend === "up" ? "text-success" : "text-danger";

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6" data-testid={`stats-card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-3xl font-bold text-gray-900" data-testid={`stats-value-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </p>
        </div>
        <div className={`w-12 h-12 ${iconBgColor} rounded-lg flex items-center justify-center`}>
          <Icon className={`${iconColor} w-6 h-6`} />
        </div>
      </div>
      <div className="mt-4 flex items-center">
        <TrendIcon className={`${trendColor} w-4 h-4 mr-1`} />
        <span className={`text-sm ${trendColor} font-medium`}>{change.value}</span>
        <span className="text-sm text-gray-500 ml-1">from last week</span>
      </div>
    </div>
  );
}
