"use client";
// Treemap view powered by nivo (@nivo/treemap) — a real charting library,
// replacing the hand-rolled SVG mosaic. Data is still our client-side fact
// aggregation; nivo only handles layout + rendering. Colors come from the
// color-blind-safe theme; leaves are colored by the secondary dimension, orgs
// (parents) are labelled, and hover/click are wired to our drill-down.
import { ResponsiveTreeMap } from "@nivo/treemap";

export type TreeNode = {
  id: string;
  name: string;
  pkey?: string; // primary (parent) key — present on parent nodes
  tkey?: string; // secondary (leaf) key — present on leaf nodes
  pname?: string; // parent label, denormalized onto leaves for the tooltip
  value?: number;
  children?: TreeNode[];
};

export default function TreemapChart({ data, colorOf, onDrill }: {
  data: TreeNode;
  colorOf: (secondaryKey: string) => string;
  onDrill: (level: "primary" | "secondary", key: string) => void;
}) {
  return (
    <div style={{ height: 560 }}>
      <ResponsiveTreeMap
        data={data as never}
        identity="id"
        value="value"
        tile="squarify"
        leavesOnly={false}
        enableLabel={false}
        enableParentLabel
        parentLabel={((node: { data: TreeNode }) => node.data.name) as never}
        parentLabelSize={13}
        parentLabelTextColor="#232A2E"
        nodeOpacity={1}
        borderWidth={2}
        borderColor="#FFFFFF"
        colors={((node: { data: TreeNode }) => (node.data.tkey ? colorOf(node.data.tkey) : "#FFFFFF")) as never}
        onClick={((node: { data: TreeNode }) => {
          if (node.data.tkey) onDrill("secondary", node.data.tkey);
          else if (node.data.pkey) onDrill("primary", node.data.pkey);
        }) as never}
        tooltip={(({ node }: { node: { data: TreeNode; formattedValue: string | number; value: number } }) => (
          <div style={{
            background: "#FFFFFF", border: "1px solid #D8DEE6", borderRadius: 6,
            padding: "6px 10px", fontSize: 12, color: "#232A2E", boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
          }}>
            {node.data.pname ? `${node.data.pname} · ` : ""}{node.data.name} —{" "}
            <strong>{node.formattedValue ?? node.value}</strong>
          </div>
        )) as never}
        theme={{ text: { fontFamily: "inherit", fontSize: 11 } }}
        margin={{ top: 6, right: 4, bottom: 4, left: 4 }}
        animate
      />
    </div>
  );
}
