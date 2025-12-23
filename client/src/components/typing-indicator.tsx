import { cn } from "@/lib/utils";

interface TypingIndicatorProps {
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function TypingIndicator({ name, className, size = 'md' }: TypingIndicatorProps) {
  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5'
  };

  const containerPadding = {
    sm: 'px-3 py-2',
    md: 'px-4 py-3',
    lg: 'px-5 py-4'
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn(
        "flex items-center gap-1 bg-muted rounded-2xl rounded-tl-sm",
        containerPadding[size]
      )}>
        <div className="flex items-center gap-1">
          <span 
            className={cn(
              "rounded-full bg-muted-foreground/60 animate-bounce",
              dotSizes[size]
            )}
            style={{ animationDelay: '0ms', animationDuration: '600ms' }}
          />
          <span 
            className={cn(
              "rounded-full bg-muted-foreground/60 animate-bounce",
              dotSizes[size]
            )}
            style={{ animationDelay: '150ms', animationDuration: '600ms' }}
          />
          <span 
            className={cn(
              "rounded-full bg-muted-foreground/60 animate-bounce",
              dotSizes[size]
            )}
            style={{ animationDelay: '300ms', animationDuration: '600ms' }}
          />
        </div>
      </div>
      {name && (
        <span className={cn("text-muted-foreground italic", textSizes[size])}>
          {name} is typing...
        </span>
      )}
    </div>
  );
}

export function TypingIndicatorInline({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <span 
        className="w-1 h-1 rounded-full bg-current animate-bounce"
        style={{ animationDelay: '0ms', animationDuration: '600ms' }}
      />
      <span 
        className="w-1 h-1 rounded-full bg-current animate-bounce"
        style={{ animationDelay: '150ms', animationDuration: '600ms' }}
      />
      <span 
        className="w-1 h-1 rounded-full bg-current animate-bounce"
        style={{ animationDelay: '300ms', animationDuration: '600ms' }}
      />
    </span>
  );
}
