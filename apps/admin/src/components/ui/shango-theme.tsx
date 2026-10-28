import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// All components inherit semantic CSS variables from the closest data-theme boundary.
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent font-semibold transition-colors select-none touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        'primary-contained': 'bg-primary-500 text-primary-foreground hover:bg-primary-600',
        'primary-outlined':
          'border-primary-500 bg-transparent text-primary-500 hover:bg-primary-50',
        'primary-ghost': 'bg-transparent text-primary-500 hover:bg-primary-50',
        secondary: 'bg-muted text-foreground hover:bg-muted/70',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive',
        link: 'h-auto rounded-sm bg-transparent p-0 text-primary-500 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'min-h-9 px-3 py-2 text-xs',
        md: 'min-h-11 px-4 py-2.5 text-sm',
        lg: 'min-h-12 px-5 py-3 text-base',
        icon: 'size-11 p-0',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    compoundVariants: [{ variant: 'link', className: 'min-h-0 px-0 py-0' }],
    defaultVariants: { variant: 'primary-contained', size: 'md', fullWidth: false },
  },
);

type ButtonProps = React.ComponentPropsWithRef<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    'data-slot'?: string;
  };

function Button({
  asChild = false,
  variant,
  size,
  fullWidth,
  loading = false,
  disabled = false,
  className,
  children,
  type,
  onClickCapture,
  onKeyDownCapture,
  'data-slot': slot = 'button',
  ...props
}: ButtonProps) {
  const blocked = disabled || loading;
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);
  // Capture prevents a disabled slotted link's own bubble handlers/navigation.
  const capture: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClickCapture?.(event);
  };
  const keyCapture: React.KeyboardEventHandler<HTMLButtonElement> = (event) => {
    if (blocked && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onKeyDownCapture?.(event);
  };
  if (asChild) {
    const child =
      blocked && React.isValidElement<Record<string, unknown>>(children)
        ? React.cloneElement(children, {
            tabIndex: -1,
            'aria-disabled': true,
            'aria-busy': loading || undefined,
            onClick: undefined,
            onClickCapture: capture,
            onKeyDown: undefined,
            onKeyDownCapture: keyCapture,
            ...(children.type === 'button' ? { disabled: true } : {}),
          })
        : children;
    return (
      <Slot
        {...props}
        data-slot={slot}
        data-disabled={blocked || undefined}
        data-loading={loading || undefined}
        aria-disabled={blocked || undefined}
        aria-busy={loading || undefined}
        className={classes}
        tabIndex={blocked ? -1 : props.tabIndex}
        onClickCapture={capture}
        onKeyDownCapture={keyCapture}
      >
        {child}
      </Slot>
    );
  }
  return (
    <button
      {...props}
      type={type ?? 'button'}
      data-slot={slot}
      data-disabled={blocked || undefined}
      data-loading={loading || undefined}
      disabled={blocked}
      aria-busy={loading || undefined}
      className={classes}
      onClickCapture={capture}
      onKeyDownCapture={keyCapture}
    >
      {loading && <ButtonSpinner />}
      {children}
    </button>
  );
}
function ButtonSpinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      {...props}
      data-slot="button-spinner"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".25" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const cardVariants = cva('relative flex flex-col rounded-2xl text-card-foreground', {
  variants: {
    variant: {
      default: 'border border-border bg-card',
      elevated: 'border border-border bg-card shadow-sm',
      soft: 'border border-transparent bg-primary-50',
      outlined: 'border border-primary-500/40 bg-card',
    },
    density: { compact: 'gap-3 py-4', comfortable: 'gap-5 py-6' },
    status: {
      default: '',
      success: 'border-success/50',
      warning: 'border-warning/50',
      error: 'border-destructive/60',
    },
  },
  defaultVariants: { variant: 'default', density: 'comfortable', status: 'default' },
});
type CardProps = React.ComponentPropsWithRef<'div'> & VariantProps<typeof cardVariants>;
function Card({ variant, density, status, className, ...props }: CardProps) {
  return (
    <div
      {...props}
      data-slot="card"
      data-density={density ?? 'comfortable'}
      data-status={status ?? 'default'}
      className={cn('group/card', cardVariants({ variant, density, status }), className)}
    />
  );
}
function CardHeader({ className, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      {...props}
      data-slot="card-header"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-6 group-data-[density=compact]/card:px-4',
        className,
      )}
    />
  );
}
function CardTitle({ className, ...props }: React.ComponentPropsWithRef<'h3'>) {
  return (
    <h3
      {...props}
      data-slot="card-title"
      className={cn(
        'col-start-1 m-0 text-base leading-snug font-semibold tracking-tight',
        className,
      )}
    />
  );
}
function CardDescription({ className, ...props }: React.ComponentPropsWithRef<'p'>) {
  return (
    <p
      {...props}
      data-slot="card-description"
      className={cn('col-start-1 m-0 text-sm leading-relaxed text-muted-foreground', className)}
    />
  );
}
function CardAction({ className, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      {...props}
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start', className)}
    />
  );
}
function CardContent({ className, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      {...props}
      data-slot="card-content"
      className={cn('min-w-0 px-6 group-data-[density=compact]/card:px-4', className)}
    />
  );
}
function CardFooter({ className, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      {...props}
      data-slot="card-footer"
      className={cn(
        'flex flex-wrap items-center gap-3 px-6 group-data-[density=compact]/card:px-4',
        className,
      )}
    />
  );
}

type FieldContextValue = {
  id: string;
  descriptionId: string;
  errorId: string;
  disabled: boolean;
  invalid: boolean;
  hasDescription: boolean;
  hasError: boolean;
  setHasDescription: React.Dispatch<React.SetStateAction<boolean>>;
  setHasError: React.Dispatch<React.SetStateAction<boolean>>;
};
const FieldContext = React.createContext<FieldContextValue | null>(null);
type FieldProps = React.ComponentPropsWithRef<'div'> & {
  disabled?: boolean;
  invalid?: boolean;
  controlId?: string;
};
function InputField({
  className,
  disabled = false,
  invalid = false,
  controlId,
  ...props
}: FieldProps) {
  const generatedId = React.useId();
  const id = controlId ?? `input-${generatedId}`;
  const [hasDescription, setHasDescription] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);
  return (
    <FieldContext.Provider
      value={{
        id,
        descriptionId: `${id}-description`,
        errorId: `${id}-error`,
        disabled,
        invalid,
        hasDescription,
        hasError,
        setHasDescription,
        setHasError,
      }}
    >
      <div
        {...props}
        data-slot="input-field"
        data-disabled={disabled || undefined}
        data-invalid={invalid || undefined}
        className={cn('group/field grid w-full gap-2', className)}
      />
    </FieldContext.Provider>
  );
}
function InputLabel({ className, htmlFor, ...props }: React.ComponentPropsWithRef<'label'>) {
  const field = React.useContext(FieldContext);
  return (
    <label
      {...props}
      htmlFor={htmlFor ?? field?.id}
      data-slot="input-label"
      className={cn(
        'm-0 block text-sm font-medium text-foreground group-data-[disabled=true]/field:opacity-60',
        className,
      )}
    />
  );
}

const inputVariants = cva(
  'm-0 block w-full min-w-0 rounded-xl border bg-card text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground/80 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25 motion-reduce:transition-none',
  {
    variants: {
      variant: { outline: 'border-border', soft: 'border-transparent bg-muted' },
      size: {
        sm: 'min-h-9 px-3 py-2 text-sm',
        md: 'min-h-11 px-3.5 py-2.5 text-base',
        lg: 'min-h-12 px-4 py-3 text-base',
      },
      grouped: {
        true: 'min-h-0 rounded-none border-0 bg-transparent px-0 focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent',
        false: '',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md', grouped: false },
  },
);
const inputGroupVariants = cva(
  'group/input-group flex w-full items-center gap-2 rounded-xl border px-3 transition-colors focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-ring/25 data-[invalid=true]:border-destructive data-[invalid=true]:focus-within:ring-destructive/25 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:bg-muted data-[disabled=true]:opacity-60 motion-reduce:transition-none',
  {
    variants: {
      variant: { outline: 'border-border bg-card', soft: 'border-transparent bg-muted' },
      size: { sm: 'min-h-9', md: 'min-h-11', lg: 'min-h-12' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);
type GroupContextValue = { disabled: boolean; invalid: boolean; size: 'sm' | 'md' | 'lg' };
const GroupContext = React.createContext<GroupContextValue | null>(null);
type InputGroupProps = React.ComponentPropsWithRef<'div'> &
  VariantProps<typeof inputGroupVariants> & { disabled?: boolean; invalid?: boolean };
function InputGroup({
  variant,
  size = 'md',
  disabled = false,
  invalid = false,
  className,
  ...props
}: InputGroupProps) {
  const field = React.useContext(FieldContext);
  const isDisabled = disabled || Boolean(field?.disabled);
  const isInvalid = invalid || Boolean(field?.invalid);
  return (
    <GroupContext.Provider value={{ disabled: isDisabled, invalid: isInvalid, size: size ?? 'md' }}>
      <div
        {...props}
        data-slot="input-group"
        data-disabled={isDisabled || undefined}
        data-invalid={isInvalid || undefined}
        className={cn(inputGroupVariants({ variant, size }), className)}
      />
    </GroupContext.Provider>
  );
}
type InputProps = Omit<React.ComponentPropsWithRef<'input'>, 'size'> &
  Omit<VariantProps<typeof inputVariants>, 'grouped'> & { htmlSize?: number; invalid?: boolean };
function Input({
  className,
  variant,
  size,
  htmlSize,
  invalid = false,
  disabled = false,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const field = React.useContext(FieldContext);
  const group = React.useContext(GroupContext);
  const isInvalid =
    invalid ||
    Boolean(field?.invalid) ||
    Boolean(group?.invalid) ||
    ariaInvalid === true ||
    ariaInvalid === 'true';
  const description =
    [
      describedBy,
      field?.hasDescription ? field.descriptionId : '',
      isInvalid && field?.hasError ? field.errorId : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <input
      {...props}
      id={field?.id ?? id}
      size={htmlSize}
      data-slot="input"
      disabled={disabled || Boolean(field?.disabled) || Boolean(group?.disabled)}
      aria-invalid={isInvalid || undefined}
      aria-describedby={description}
      className={cn(
        inputVariants({ variant, size: size ?? group?.size, grouped: Boolean(group) }),
        className,
      )}
    />
  );
}
function InputIcon({ className, ...props }: React.ComponentPropsWithRef<'span'>) {
  return (
    <span
      {...props}
      data-slot="input-icon"
      aria-hidden="true"
      className={cn(
        'pointer-events-none inline-flex shrink-0 items-center text-muted-foreground [&_svg]:size-4',
        className,
      )}
    />
  );
}
type InputActionProps = ButtonProps;
function InputAction({
  className,
  variant = 'primary-ghost',
  size = 'icon',
  disabled,
  ...props
}: InputActionProps) {
  const field = React.useContext(FieldContext);
  const group = React.useContext(GroupContext);
  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      disabled={disabled || field?.disabled || group?.disabled}
      className={cn('size-9 shrink-0 rounded-lg', className)}
      data-slot="input-action"
    />
  );
}
function InputDescription({ className, id, ...props }: React.ComponentPropsWithRef<'p'>) {
  const field = React.useContext(FieldContext);
  const register = field?.setHasDescription;
  React.useEffect(() => {
    register?.(true);
    return () => register?.(false);
  }, [register]);
  return (
    <p
      {...props}
      id={field?.descriptionId ?? id}
      data-slot="input-description"
      className={cn('m-0 text-xs leading-relaxed text-muted-foreground', className)}
    />
  );
}
function InputError({ className, id, ...props }: React.ComponentPropsWithRef<'p'>) {
  const field = React.useContext(FieldContext);
  const register = field?.setHasError;
  React.useEffect(() => {
    register?.(true);
    return () => register?.(false);
  }, [register]);
  return (
    <p
      {...props}
      id={field?.errorId ?? id}
      data-slot="input-error"
      aria-live="polite"
      className={cn('m-0 text-xs leading-relaxed text-destructive', className)}
    />
  );
}

export {
  Button,
  ButtonSpinner,
  buttonVariants,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  cardVariants,
  InputField,
  InputLabel,
  InputGroup,
  Input,
  InputIcon,
  InputAction,
  InputDescription,
  InputError,
  inputVariants,
  inputGroupVariants,
};
export type { ButtonProps, CardProps, FieldProps, InputProps, InputGroupProps, InputActionProps };
