"use client";
// Cross-tab view — nivo heatmap. Value intensity on a single-hue sequential
// scale (color-blind-safe by construction). Click a cell to drill both dims.
import { ResponsiveHeatMap } from "@nivo/heatmap";

export type HeatDatum = { x: string; y: number | null; rowKey: string; colKey: string };
export type HeatSerie = { id: string; data: HeatDatum[] };

export default function HeatmapChart({ series, max, fmt, onDrill }: {
  series: HeatSerie[];
  max: number;
  fmt: (n: number) => string;
  onDrill: (rowKey: string, colKey: string) => void;
}) {
  return (
    <div style={{ height: Math.max(240, series.length * 52 + 100) }}>
      <ResponsiveHeatMap
        data={series as never}
        margin={{ top: 80, right: 20, bottom: 16, left: 160 }}
        valueFormat={((v: number) => fmt(v)) as never}
        colors={{ type: "sequential", scheme: "blues", minValue: 0, maxValue: max } as never}
        emptyColor="#F1F3F5"
        enableLabels
        labelTextColor={((cell: { value: number | null }) => ((cell.value ?? 0) > max * 0.55 ? "#FFFFFF" : "#232A2E")) as never}
        axisTop={{ tickSize: 0, tickPadding: 8, tickRotation: -32 }}
        axisLeft={{ tickSize: 0, tickPadding: 8 }}
        borderRadius={2}
        borderWidth={2}
        borderColor="#FFFFFF"
        onClick={((cell: { data: HeatDatum }) => {
          if (cell?.data?.y != null) onDrill(cell.data.rowKey, cell.data.colKey);
          return () => {};
        }) as never}
        tooltip={(({ cell }: { cell: { serieId: string; data: HeatDatum } }) => (
          <div style={tooltipStyle}>
            {cell.serieId} · {cell.data.x} — <strong>{cell.data.y == null ? 0 : fmt(cell.data.y)}</strong>
          </div>
        )) as never}
        theme={{ text: { fontFamily: "inherit", fontSize: 11, fill: "#59606A" } }}
        animate
      />
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "#FFFFFF", border: "1px solid #D8DEE6", borderRadius: 6,
  padding: "6px 10px", fontSize: 12, color: "#232A2E", boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
};
