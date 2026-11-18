import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'rp-scroll inline-flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-[var(--rp-bg-sunken)] p-1 text-[var(--rp-fg-muted)]',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
      'hover:text-[var(--rp-fg)] disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-[var(--rp-bg-elevated)] data-[state=active]:text-[var(--rp-fg)] data-[state=active]:shadow-sm',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-3 outline-none data-[state=active]:rp-anim-in', className)}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
