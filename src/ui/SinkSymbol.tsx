import { getSinkSymbol } from "@geometry/fixtures";
import type { SVGProps } from "react";
import { ICON_SIZE } from "./constants";

type RimStyle = Pick<
  SVGProps<SVGRectElement>,
  "fill" | "fillOpacity" | "strokeWidth" | "vectorEffect"
>;

export function SinkSymbol({
  symbol: { rim, basin, drain, tap },
  rimStyle,
}: {
  symbol: ReturnType<typeof getSinkSymbol>;
  rimStyle?: RimStyle;
}) {
  return (
    <>
      <rect {...rim} {...rimStyle} />
      <rect {...basin} fill="none" />
      <circle {...drain} fill="none" />
      <path d={tap} fill="none" />
    </>
  );
}

const iconSymbol = getSinkSymbol(20, 20);

export function SinkIcon({ size = ICON_SIZE }: { size?: string | number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-12 -2 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <SinkSymbol symbol={iconSymbol} />
    </svg>
  );
}
