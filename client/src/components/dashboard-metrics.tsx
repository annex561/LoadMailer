import { cn } from '@/lib/utils';

interface CircularMetricProps {
  value: number;
  label: string;
  sublabel?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function CircularMetric({ value, label, sublabel, color = 'primary', size = 'md' }: CircularMetricProps) {
  const sizeClasses = {
    sm: 'w-20 h-20',
    md: 'w-28 h-28',
    lg: 'w-36 h-36'
  };
  
  const textSizes = {
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-4xl'
  };

  const colorClasses = {
    primary: 'text-primary border-primary/20 bg-primary/5',
    success: 'text-success border-success/20 bg-success/5',
    warning: 'text-warning border-warning/20 bg-warning/5',
    destructive: 'text-destructive border-destructive/20 bg-destructive/5',
    muted: 'text-muted-foreground border-border bg-muted/50'
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={cn(
        "rounded-full border-4 flex items-center justify-center",
        sizeClasses[size],
        colorClasses[color as keyof typeof colorClasses] || colorClasses.primary
      )}>
        <span className={cn("font-bold", textSizes[size])}>{value}</span>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </div>
    </div>
  );
}

interface ProgressMetricProps {
  title: string;
  value: string;
  target?: string;
  progress: number;
  icon?: React.ReactNode;
  color?: 'primary' | 'success' | 'warning' | 'destructive';
}

export function ProgressMetric({ title, value, target, progress, icon, color = 'primary' }: ProgressMetricProps) {
  const colorClasses = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive'
  };

  const iconBgClasses = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive'
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {target && <p className="text-xs text-muted-foreground">Target: {target}</p>}
        </div>
        {icon && (
          <div className={cn("p-2.5 rounded-lg", iconBgClasses[color])}>
            {icon}
          </div>
        )}
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all duration-500", colorClasses[color])}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
}

interface StatusDotProps {
  label: string;
  value: string | number;
  status: 'success' | 'warning' | 'error' | 'neutral';
}

export function StatusDot({ label, value, status }: StatusDotProps) {
  const dotColors = {
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-destructive',
    neutral: 'bg-muted-foreground'
  };

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{value}</span>
        <div className={cn("w-3 h-3 rounded-full", dotColors[status])} />
      </div>
    </div>
  );
}

interface AvailabilitySplitProps {
  title: string;
  available: number;
  unavailable: number;
  availableLabel?: string;
  unavailableLabel?: string;
}

export function AvailabilitySplit({ 
  title, 
  available, 
  unavailable, 
  availableLabel = 'Available',
  unavailableLabel = 'Not Available'
}: AvailabilitySplitProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-destructive/10 border-2 border-destructive flex items-center justify-center">
            <span className="text-sm font-bold text-destructive">{unavailable}</span>
          </div>
          <span className="text-xs text-muted-foreground">{unavailableLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-success/10 border-2 border-success flex items-center justify-center">
            <span className="text-sm font-bold text-success">{available}</span>
          </div>
          <span className="text-xs text-muted-foreground">{availableLabel}</span>
        </div>
      </div>
    </div>
  );
}

interface CompactBarProps {
  label: string;
  value: number;
  color?: 'primary' | 'success' | 'warning' | 'destructive';
  maxWidth?: number;
}

export function CompactBar({ label, value, color = 'primary', maxWidth = 100 }: CompactBarProps) {
  const colorClasses = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive'
  };

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className={cn("w-3 h-8 rounded", colorClasses[color])} />
      <span className="text-sm text-muted-foreground flex-1">{label}</span>
      <span className="text-lg font-bold text-foreground">{value}</span>
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export function SectionHeader({ title, icon, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

interface MetricCardProps {
  children: React.ReactNode;
  className?: string;
}

export function MetricCard({ children, className }: MetricCardProps) {
  return (
    <div className={cn(
      "bg-card rounded-xl border border-border/50 p-5 shadow-sm hover:shadow-md transition-shadow",
      className
    )}>
      {children}
    </div>
  );
}
