"use client";
// Relationships view — nivo force-directed network. Nodes are the two chosen
// dimensions' categories (colored by the theme, sized by weight); links are the
// co-occurrences (thickness = weight). Click a node to filter by it.
import { ResponsiveNetwork } from "@nivo/network";

export type NetNode = { id: string; label: string; dim: string; nkey: string; color: string; weight: number };
export type NetLink = { source: string; target: string; weight: number };

export default function NetworkChart({ nodes, links, maxNode, maxEdge, accent, fmt, onPick }: {
  nodes: NetNode[];
  links: NetLink[];
  maxNode: number;
  maxEdge: number;
  accent: string;
  fmt: (n: number) => string;
  onPick: (dim: string, key: string) => void;
}) {
  const g = (n: { data?: NetNode } & Partial<NetNode>): NetNode => (n.data ?? (n as NetNode));
  return (
    <div style={{ height: 560 }}>
      <ResponsiveNetwork
        data={{ nodes, links } as never}
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        linkDistance={((l: { weight?: number; data?: NetLink }) => 55 + 55 * (1 - ((l.data?.weight ?? l.weight ?? 1) / maxEdge))) as never}
        centeringStrength={0.4}
        repulsivity={24}
        nodeSize={((n: { data?: NetNode } & Partial<NetNode>) => 8 + 22 * ((g(n).weight ?? 1) / maxNode)) as never}
        activeNodeSize={((n: { data?: NetNode } & Partial<NetNode>) => 12 + 26 * ((g(n).weight ?? 1) / maxNode)) as never}
        nodeColor={((n: { data?: NetNode } & Partial<NetNode>) => g(n).color) as never}
        nodeBorderWidth={1.5}
        nodeBorderColor="#FFFFFF"
        linkThickness={((l: { weight?: number; data?: NetLink }) => 1 + 6 * ((l.data?.weight ?? l.weight ?? 1) / maxEdge)) as never}
        linkColor={accent}
        onClick={((n: { data?: NetNode } & Partial<NetNode>) => onPick(g(n).dim, g(n).nkey)) as never}
        nodeTooltip={(({ node }: { node: { data?: NetNode } & Partial<NetNode> }) => (
          <div style={tooltipStyle}>
            {g(node).label} — <strong>{fmt(g(node).weight ?? 0)}</strong>
          </div>
        )) as never}
        animate
      />
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "#FFFFFF", border: "1px solid #D8DEE6", borderRadius: 6,
  padding: "6px 10px", fontSize: 12, color: "#232A2E", boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
};
