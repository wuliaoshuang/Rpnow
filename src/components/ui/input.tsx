import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { vibrate } from '@/lib/haptics';

// ------------------------------------------------------------------ Label
export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'flex items-center gap-1 text-[13px] font-medium leading-none text-[var(--rp-fg)]',
      className,
    )}
    {...props}
  >
    {children}
    {required && (
      <span className="text-[var(--rp-danger)]" aria-hidden="true">
        *
      </span>
    )}
  </LabelPrimitive.Root>
));
Label.displayName = 'Label';

// ------------------------------------------------------------------ Input
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-[var(--rp-border-strong)] bg-[var(--rp-bg)] px-3 py-2 text-sm text-[var(--rp-fg)] shadow-sm transition-colors',
        'placeholder:text-[var(--rp-fg-subtle)]',
        'focus-visible:border-[var(--rp-accent)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--rp-accent-ring)]',
        'aria-[invalid=true]:border-[var(--rp-danger)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

// --------------------------------------------------------------- Textarea
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex w-full resize-y rounded-md border border-[var(--rp-border-strong)] bg-[var(--rp-bg)] px-3 py-2 font-sans text-sm leading-relaxed text-[var(--rp-fg)] shadow-sm transition-colors',
      'placeholder:text-[var(--rp-fg-subtle)]',
      'focus-visible:border-[var(--rp-accent)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--rp-accent-ring)]',
      'aria-[invalid=true]:border-[var(--rp-danger)]',
      'disabled:cursor-not-allowed disabled:opacity-55',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

// ---------------------------------------------------------------- Switch
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    // Toggles are deliberate acts; a short buzz confirms the change.
    onCheckedChange={(checked) => {
      vibrate(checked ? 'toggle' : 'tap');
      props.onCheckedChange?.(checked);
    }}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rp-accent)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-[var(--rp-accent)] data-[state=unchecked]:bg-[var(--rp-border-strong)]',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-5 rounded-full bg-white shadow-sm ring-0 transition-transform',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

// ---------------------------------------------------------------- Select
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-[var(--rp-border-strong)] bg-[var(--rp-bg)] px-3 py-2 text-sm text-[var(--rp-fg)] shadow-sm transition-colors',
      'placeholder:text-[var(--rp-fg-subtle)] focus-visible:border-[var(--rp-accent)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--rp-accent-ring)]',
      'disabled:cursor-not-allowed disabled:opacity-55 [&>span]:truncate',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 shrink-0 opacity-60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-[60] max-h-72 min-w-[8rem] overflow-hidden rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] text-[var(--rp-fg)] shadow-rp',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn('rp-scroll p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-fg-subtle)]', className)}
    {...props}
  />
));
SelectLabel.displayName = 'SelectLabel';

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none',
      'focus:bg-[var(--rp-accent-soft)] focus:text-[var(--rp-fg)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-[var(--rp-accent)]" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

// ---------------------------------------------------------------- Slider
export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center py-2', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[var(--rp-border-strong)]">
      <SliderPrimitive.Range className="absolute h-full bg-[var(--rp-accent)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block size-4 cursor-grab rounded-full border-2 border-[var(--rp-accent)] bg-[var(--rp-bg-elevated)] shadow transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rp-accent)] active:cursor-grabbing" />
  </SliderPrimitive.Root>
));
Slider.displayName = 'Slider';
