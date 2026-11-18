import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------ DropdownMenu
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        'z-[60] min-w-[10rem] overflow-hidden rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-1 text-[var(--rp-fg)] shadow-rp',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-[13px] outline-none transition-colors',
      'focus:bg-[var(--rp-accent-soft)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      destructive && 'text-[var(--rp-danger)] focus:bg-[var(--rp-danger)]/10',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-fg-subtle)]', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="my-1 h-px bg-[var(--rp-border)]" />;
}

// ---------------------------------------------------------------- Tooltip
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[70] max-w-[16rem] rounded-md bg-[var(--rp-fg)] px-2.5 py-1.5 text-xs font-medium text-[var(--rp-bg)] shadow-md',
        'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/** Convenience wrapper: icon buttons always get an accessible label this way. */
export function Hint({
  label,
  children,
  side = 'bottom',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

// -------------------------------------------------------------- Separator
export const Separator = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-[var(--rp-border)]',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separator.displayName = 'Separator';

// ------------------------------------------------------------------ Badge
export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'outline' | 'accent' | 'ok' | 'warn' | 'danger';
}) {
  const styles: Record<string, string> = {
    default: 'bg-[var(--rp-bg-sunken)] text-[var(--rp-fg-muted)]',
    outline: 'border border-[var(--rp-border-strong)] text-[var(--rp-fg-muted)]',
    accent: 'bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]',
    ok: 'bg-[var(--rp-ok)]/15 text-[var(--rp-ok)]',
    warn: 'bg-[var(--rp-warn)]/15 text-[var(--rp-warn)]',
    danger: 'bg-[var(--rp-danger)]/15 text-[var(--rp-danger)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-5',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ Skeleton
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--rp-bg-sunken)]', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

// ------------------------------------------------------------------ EmptyState
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-[var(--rp-bg-sunken)] text-[var(--rp-fg-subtle)]">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-[var(--rp-fg)]">{title}</p>
        {description && <p className="mx-auto max-w-sm text-[13px] text-[var(--rp-fg-muted)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}
