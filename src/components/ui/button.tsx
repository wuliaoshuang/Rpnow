import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rp-accent)] active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          'bg-[var(--rp-accent)] text-[var(--rp-accent-fg)] shadow-sm hover:bg-[var(--rp-accent)]/90',
        destructive: 'bg-[var(--rp-danger)] text-white shadow-sm hover:bg-[var(--rp-danger)]/90',
        outline:
          'border border-[var(--rp-border-strong)] bg-transparent hover:bg-[var(--rp-bg-sunken)] text-[var(--rp-fg)]',
        secondary:
          'bg-[var(--rp-accent-soft)] text-[var(--rp-fg)] hover:bg-[var(--rp-accent-soft)]/80',
        ghost: 'hover:bg-[var(--rp-bg-sunken)] text-[var(--rp-fg)]',
        link: 'text-[var(--rp-accent)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3 text-[13px]',
        lg: 'h-11 rounded-md px-6',
        // Touch-first size: 44px min target per the design rules.
        touch: 'h-11 min-w-11 px-4',
        icon: 'size-10',
        'icon-sm': 'size-9',
        'icon-touch': 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size }), 'cursor-pointer', className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
