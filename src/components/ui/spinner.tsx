import { type VariantProps, cva } from "class-variance-authority";
import { mdiLoading } from "@mdi/js";

import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";

const spinnerVariants = cva("size-4 animate-spin", {
  variants: {
    variant: {
      default: "text-neutral-fg",
      primary: "text-primary-fg",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Spinner({
  className,
  variant,
  ...props
}: React.ComponentProps<"svg"> & VariantProps<typeof spinnerVariants>) {
  return (
    <Icon
      path={mdiLoading}
      role="status"
      aria-label="Loading"
      className={cn(spinnerVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Spinner, spinnerVariants };
