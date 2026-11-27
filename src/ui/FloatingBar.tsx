import clsx from "clsx";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import styles from "./FloatingBar.module.css";

type FloatingBarProps = ComponentPropsWithoutRef<"fieldset">;

export const FloatingBar = forwardRef<HTMLFieldSetElement, FloatingBarProps>(
  function FloatingBar({ className, ...props }, ref) {
    return (
      <fieldset {...props} ref={ref} className={clsx(styles.bar, className)} />
    );
  },
);
