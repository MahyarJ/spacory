import clsx from "clsx";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import styles from "./Button.module.css";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "filled" | "text" | "icon";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, type = "button", variant = "filled", ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        className={clsx(styles.button, styles[variant], className)}
      />
    );
  },
);

type IconButtonProps = Omit<ButtonProps, "variant" | "aria-label"> & {
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, title = label, ...props }, ref) {
    return (
      <Button
        {...props}
        ref={ref}
        variant="icon"
        aria-label={label}
        title={title}
      />
    );
  },
);
