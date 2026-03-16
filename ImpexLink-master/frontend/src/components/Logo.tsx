import { Cog } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { icon: 24, text: 'text-lg' },
  md: { icon: 32, text: 'text-xl' },
  lg: { icon: 48, text: 'text-2xl' },
  xl: { icon: 64, text: 'text-4xl' },
};

export function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  const { icon, text } = sizeMap[size];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative">
        <Cog className="text-primary animate-pulse-slow" size={icon} strokeWidth={1.5} />
        <Cog
          className="absolute top-0 left-0 text-primary/30"
          size={icon}
          strokeWidth={1.5}
          style={{ transform: 'rotate(22.5deg)' }}
        />
      </div>
      {showText && (
        <div className="flex flex-col leading-none">
          <span className={`font-bold text-foreground ${text}`}>ImpexLink</span>
          {size === 'lg' || size === 'xl' ? (
            <span className="text-xs text-muted-foreground tracking-wide">
              Smarter Inventory. Faster Delivery.
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
