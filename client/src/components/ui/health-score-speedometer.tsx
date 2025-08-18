import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface HealthScoreSpeedometerProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  driverName?: string;
  className?: string;
}

export function HealthScoreSpeedometer({ 
  score, 
  size = 'md', 
  showLabel = true, 
  driverName,
  className = '' 
}: HealthScoreSpeedometerProps) {
  // Ensure score is between 0 and 100
  const normalizedScore = Math.max(0, Math.min(100, score));
  
  // Calculate angle for the needle (180 degrees sweep, from -90 to +90)
  const angle = (normalizedScore / 100) * 180 - 90;
  
  // Size configurations
  const sizeConfig = {
    sm: { 
      radius: 40, 
      strokeWidth: 6, 
      needleLength: 25, 
      fontSize: 'text-xs',
      containerSize: 'w-24 h-16',
      textSize: 'text-sm'
    },
    md: { 
      radius: 60, 
      strokeWidth: 8, 
      needleLength: 35, 
      fontSize: 'text-sm',
      containerSize: 'w-32 h-20',
      textSize: 'text-base'
    },
    lg: { 
      radius: 80, 
      strokeWidth: 10, 
      needleLength: 50, 
      fontSize: 'text-lg',
      containerSize: 'w-40 h-28',
      textSize: 'text-lg'
    }
  };
  
  const config = sizeConfig[size];
  const { radius, strokeWidth, needleLength, fontSize, containerSize, textSize } = config;
  
  // Calculate circumference for the semicircle
  const circumference = Math.PI * radius;
  const strokeDasharray = `${circumference} ${circumference}`;
  const strokeDashoffset = circumference - (normalizedScore / 100) * circumference;
  
  // Get color based on score
  const getScoreColor = (score: number) => {
    if (score >= 90) return { color: '#10B981', bg: 'bg-green-100', text: 'text-green-800' }; // Green
    if (score >= 80) return { color: '#059669', bg: 'bg-green-50', text: 'text-green-700' }; // Light Green
    if (score >= 70) return { color: '#FBBF24', bg: 'bg-yellow-100', text: 'text-yellow-800' }; // Yellow
    if (score >= 60) return { color: '#F59E0B', bg: 'bg-orange-100', text: 'text-orange-800' }; // Orange
    if (score >= 50) return { color: '#EF4444', bg: 'bg-red-100', text: 'text-red-800' }; // Red
    return { color: '#DC2626', bg: 'bg-red-200', text: 'text-red-900' }; // Dark Red
  };
  
  const scoreColor = getScoreColor(normalizedScore);
  
  // Get status text
  const getStatusText = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Very Good';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Fair';
    if (score >= 50) return 'Poor';
    return 'Critical';
  };
  
  const statusText = getStatusText(normalizedScore);
  
  // SVG dimensions
  const svgSize = radius * 2 + strokeWidth + 10;
  const centerX = svgSize / 2;
  const centerY = svgSize / 2;
  
  return (
    <div className={`flex flex-col items-center ${className}`} data-testid={`speedometer-${driverName || 'driver'}`}>
      <div className={`relative ${containerSize}`}>
        <svg 
          width={svgSize} 
          height={svgSize / 1.6} 
          viewBox={`0 0 ${svgSize} ${svgSize / 1.6}`}
          className="overflow-visible"
        >
          {/* Background arc */}
          <path
            d={`M ${centerX - radius} ${centerY} A ${radius} ${radius} 0 0 1 ${centerX + radius} ${centerY}`}
            fill="none"
            stroke="#E5E7EB"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          
          {/* Progress arc */}
          <path
            d={`M ${centerX - radius} ${centerY} A ${radius} ${radius} 0 0 1 ${centerX + radius} ${centerY}`}
            fill="none"
            stroke={scoreColor.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
            style={{
              transition: 'stroke-dashoffset 1s ease-in-out',
              transformOrigin: `${centerX}px ${centerY}px`,
            }}
          />
          
          {/* Needle */}
          <line
            x1={centerX}
            y1={centerY}
            x2={centerX + needleLength * Math.cos((angle * Math.PI) / 180)}
            y2={centerY + needleLength * Math.sin((angle * Math.PI) / 180)}
            stroke="#374151"
            strokeWidth="3"
            strokeLinecap="round"
            style={{
              transition: 'all 1s ease-in-out',
            }}
          />
          
          {/* Center dot */}
          <circle
            cx={centerX}
            cy={centerY}
            r="4"
            fill="#374151"
          />
          
          {/* Score labels */}
          <text
            x={centerX - radius * 0.8}
            y={centerY + 15}
            className="text-xs fill-gray-500"
            textAnchor="middle"
          >
            0
          </text>
          <text
            x={centerX}
            y={centerY - radius * 0.8}
            className="text-xs fill-gray-500"
            textAnchor="middle"
          >
            50
          </text>
          <text
            x={centerX + radius * 0.8}
            y={centerY + 15}
            className="text-xs fill-gray-500"
            textAnchor="middle"
          >
            100
          </text>
        </svg>
        
        {/* Score display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center mt-6">
          <span className={`font-bold ${fontSize} ${scoreColor.text}`} data-testid={`score-${normalizedScore}`}>
            {Math.round(normalizedScore)}
          </span>
          {showLabel && (
            <Badge 
              variant="secondary" 
              className={`${scoreColor.bg} ${scoreColor.text} text-xs mt-1 px-2 py-0.5`}
              data-testid={`status-${statusText.toLowerCase()}`}
            >
              {statusText}
            </Badge>
          )}
        </div>
      </div>
      
      {driverName && showLabel && (
        <p className={`${textSize} font-medium text-center mt-2 text-gray-700 dark:text-gray-300`}>
          {driverName}
        </p>
      )}
    </div>
  );
}

// Health Score calculation utility
export function calculateHealthScore({
  averageRating = 0,
  onTimeDeliveries = 0,
  lateDeliveries = 0,
  completedLoads = 0,
  cancelledLoads = 0,
  currentStreak = 0,
  safetyScore = 100,
  maintenanceScore = 100,
  totalLoads = 0
}: {
  averageRating?: number;
  onTimeDeliveries?: number;
  lateDeliveries?: number;
  completedLoads?: number;
  cancelledLoads?: number;
  currentStreak?: number;
  safetyScore?: number;
  maintenanceScore?: number;
  totalLoads?: number;
}): number {
  let score = 0;
  
  // Base score from ratings (0-25 points)
  if (averageRating > 0) {
    score += (averageRating / 5) * 25;
  } else {
    score += 15; // Default if no ratings yet
  }
  
  // On-time delivery ratio (0-30 points)
  const totalDeliveries = onTimeDeliveries + lateDeliveries;
  if (totalDeliveries > 0) {
    const onTimeRatio = onTimeDeliveries / totalDeliveries;
    score += onTimeRatio * 30;
  } else {
    score += 20; // Default if no deliveries yet
  }
  
  // Completion ratio (0-20 points)
  if (totalLoads > 0) {
    const completionRatio = completedLoads / totalLoads;
    score += completionRatio * 20;
  } else {
    score += 15; // Default if no loads yet
  }
  
  // Current streak bonus (0-10 points)
  score += Math.min(currentStreak * 2, 10);
  
  // Safety score (0-10 points)
  score += (safetyScore / 100) * 10;
  
  // Maintenance score (0-5 points)
  score += (maintenanceScore / 100) * 5;
  
  // Penalty for cancellations
  if (totalLoads > 0) {
    const cancellationRatio = cancelledLoads / totalLoads;
    score -= cancellationRatio * 15;
  }
  
  return Math.max(0, Math.min(100, score));
}