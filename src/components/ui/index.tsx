import { forwardRef, ButtonHTMLAttributes, InputHTMLAttributes, HTMLAttributes, ReactNode, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { X, ChevronDown } from 'lucide-react';

// Button
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => (
    <button ref={ref} className={cn(
      'inline-flex items-center justify-center font-medium transition-colors rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
      variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
      variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
      variant === 'outline' && 'border border-border bg-transparent hover:bg-accent',
      variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      size === 'sm' && 'h-7 px-3 text-xs',
      size === 'md' && 'h-9 px-4 text-sm',
      size === 'lg' && 'h-10 px-6 text-sm',
      size === 'icon' && 'h-8 w-8 p-0',
      className
    )} {...props} />
  )
);
Button.displayName = 'Button';

// Input
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(
      'flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 transition-colors',
      className
    )} {...props} />
  )
);
Input.displayName = 'Input';

// Label
export const Label = forwardRef<HTMLLabelElement, HTMLAttributes<HTMLLabelElement> & { htmlFor?: string }>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-sm font-medium text-foreground leading-none', className)} {...props} />
  )
);
Label.displayName = 'Label';

// Separator
export const Separator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('h-px w-full bg-border', className)} {...props} />
  )
);
Separator.displayName = 'Separator';

// Card
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('rounded-lg border border-border bg-card text-card-foreground', className)} {...props} />
));
Card.displayName = 'Card';
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';
export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('font-semibold leading-none tracking-tight text-foreground', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';
export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';
export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';
export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-5 pt-0', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

// Skeleton
export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('animate-pulse rounded-md bg-muted/60', className)} {...props} />
));
Skeleton.displayName = 'Skeleton';

// Dialog
interface DialogProps { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode; }
export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onOpenChange(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      {children}
    </div>
  );
}
export function DialogContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('relative z-50 w-full max-w-md bg-card border border-border rounded-lg shadow-2xl p-6', className)}>{children}</div>;
}
export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="flex flex-col space-y-1.5 mb-4">{children}</div>;
}
export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold text-foreground">{children}</h2>;
}
export function DialogDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 mt-4">{children}</div>;
}

// Select
interface SelectProps extends HTMLAttributes<HTMLSelectElement> {
  value?: string;
  onValueChange?: (v: string) => void;
  id?: string;
}
export function Select({ className, children, onValueChange, onChange, value, id, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        className={cn('flex h-9 w-full appearance-none rounded-md border border-border bg-input px-3 py-1 pr-8 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-colors', className)}
        onChange={(e) => { (onChange as React.ChangeEventHandler<HTMLSelectElement>)?.(e); onValueChange?.(e.target.value); }}
        {...(props as HTMLAttributes<HTMLSelectElement>)}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
    </div>
  );
}
export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return <option value={value}>{children}</option>;
}

// Tooltip
export function Tooltip({ children }: { children: ReactNode }) {
  return <div className="relative inline-flex group">{children}</div>;
}
export function TooltipTrigger({ children, asChild }: { children: ReactNode; asChild?: boolean }) {
  if (asChild) return <>{children}</>;
  return <>{children}</>;
}
export function TooltipContent({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-card border border-border text-foreground rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
      {children}
    </div>
  );
}
