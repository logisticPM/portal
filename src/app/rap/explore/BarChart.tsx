"use client";
// Contribution view — nivo horizontal bar chart. Each bar is a category colored
// by the theme; value labels use contrast-aware text; tooltip shows the share.
import { ResponsiveBar } from "@nivo/bar";
import { textOn } from "@/lib/rap/palette";

export type BarDatum = { id: string; value: number; color: string; key: string; share: number };

export default function BarChart({ data, fmt, onPick }: {
  data: BarDatum[]; // sorted descending by value
  fmt: (n: number) => string;
  onPick: (key: string) => void;
}) {
  return (
    <div style={{ height: Math.max(200, data.length * 40 + 50) }}>
      <ResponsiveBar
        data={[...data].reverse() as never}
        keys={["value"]}
        indexBy="id"
        layout="horizontal"
        margin={{ top: 4, right: 28, bottom: 40, left: 180 }}
        padding={0.3}
        valueScale={{ type: "linear" }}
        colors={((bar: { data?: BarDatum }) => bar?.data?.color ?? "#888888") as never}
        borderRadius={2}
        enableGridX
        enableGridY={false}
        axisBottom={{ tickSize: 0, tickPadding: 6 }}
        axisLeft={{ tickSize: 0, tickPadding: 8 }}
        enableLabel
        label={((d: { value: number }) => fmt(d.value)) as never}
        labelTextColor={((d: { data?: BarDatum; color?: string }) => textOn(d?.data?.color ?? d?.color)) as never}
        labelSkipWidth={24}
        onClick={((bar: { data: BarDatum }) => onPick(bar.data.key)) as never}
        tooltip={(({ data }: { data: BarDatum }) => (
          <div style={tooltipStyle}>
            {data.id} — <strong>{fmt(data.value)}</strong>{data.share > 0 ? ` · ${Math.round(data.share * 100)}%` : ""}
          </div>
        )) as never}
        theme={{ text: { fontFamily: "inherit", fontSize: 11, fill: "#59606A" }, grid: { line: { stroke: "#EDEFF2" } } }}
        animate
      />
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "#FFFFFF", border: "1px solid #D8DEE6", borderRadius: 6,
  padding: "6px 10px", fontSize: 12, color: "#232A2E", boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
};
