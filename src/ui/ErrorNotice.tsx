import clsx from "clsx";
import styles from "./ErrorNotice.module.css";

type ErrorNoticeProps = {
  message: string;
  className?: string;
};

export function ErrorNotice({ message, className }: ErrorNoticeProps) {
  return (
    <div className={clsx(styles.notice, className)} role="alert">
      {message}
    </div>
  );
}
