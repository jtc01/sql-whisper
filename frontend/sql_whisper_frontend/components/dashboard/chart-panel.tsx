"use client";

/**
 * ChartPanel
 * ----------
 * Renders a Plotly chart from a ChartSpec produced by the agent's
 * create_chart tool. Loaded dynamically so Plotly never touches SSR.
 *
 * Props
 *   spec      — the ChartSpec from the agent (see type below)
 *   data      — the raw query rows from run_query
 *   className — optional extra Tailwind classes for the wrapper div
 *
 * To customise the chart appearance, edit the `layout` object below.
 * To support new chart types, add cases to `buildTraces`.
 *
 * The component is intentionally kept flat — no sub-components —
 * so the frontend developer can find everything in one place.
 */

import * as React from "react";
import dynamic from "next/dynamic";

// Plotly is large; load it only on the client, never during SSR.
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * ChartSpec mirrors the output of the agent's create_chart tool.
 * If you add fields to the tool definition in agent.py, add them here too.
 */
export interface ChartSpec {
  chart_type: "bar" | "line" | "pie" | "scatter";
  x: string;          // column name for x-axis (or labels on pie)
  y: string;          // column name for y-axis (or values on pie)
  title: string;
  color?: string;     // optional column to group/color traces by
}

interface ChartPanelProps {
  spec: ChartSpec;
  data: Record<string, any>[];
  className?: string;
}

// ── Trace builder ─────────────────────────────────────────────────────────────

/**
 * Converts raw query rows + a ChartSpec into Plotly trace objects.
 * Add new chart types here if the agent ever produces them.
 */
function buildTraces(spec: ChartSpec, data: Record<string, any>[]): Plotly.Data[] {
  const xs = data.map((r) => r[spec.x]);
  const ys = data.map((r) => r[spec.y]);

  if (spec.chart_type === "pie") {
    return [{ type: "pie", labels: xs, values: ys, hole: 0.3 } as Plotly.Data];
  }

  // If a color/group column is provided, split into one trace per group.
  if (spec.color) {
    const groups = [...new Set(data.map((r) => r[spec.color!]))];
    return groups.map((g) => {
      const rows = data.filter((r) => r[spec.color!] === g);
      return {
        type: spec.chart_type as any,
        name: String(g),
        x: rows.map((r) => r[spec.x]),
        y: rows.map((r) => r[spec.y]),
        mode: spec.chart_type === "scatter" ? "markers" : undefined,
      } as Plotly.Data;
    });
  }

  // Single trace for bar / line / scatter.
  return [
    {
      type: spec.chart_type as any,
      x: xs,
      y: ys,
      mode: spec.chart_type === "scatter" ? "markers" : undefined,
    } as Plotly.Data,
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChartPanel({ spec, data, className }: ChartPanelProps) {
  if (!data || data.length === 0) return null;

  const traces = buildTraces(spec, data);

  /**
   * Plotly layout — edit freely.
   * transparent paper_bgcolor / plot_bgcolor makes it respect the app theme.
   * font.color inherits from CSS so it works in both light and dark mode.
   */
  const layout: Partial<Plotly.Layout> = {
    title: { text: spec.title, font: { size: 14 } },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { color: "var(--foreground, #fff)", size: 11 },
    margin: { t: 48, r: 24, b: 48, l: 48 },
    xaxis: {
      title: { text: spec.x },
      gridcolor: "rgba(255,255,255,0.07)",
      zerolinecolor: "rgba(255,255,255,0.15)",
    },
    yaxis: {
      title: { text: spec.y },
      gridcolor: "rgba(255,255,255,0.07)",
      zerolinecolor: "rgba(255,255,255,0.15)",
    },
    legend: { orientation: "h", y: -0.2 },
    autosize: true,
  };

  const config: Partial<Plotly.Config> = {
    displayModeBar: false,   // hide the Plotly toolbar — set to true if you want it
    responsive: true,
  };

  return (
    <div className={className}>
      <Plot
        data={traces}
        layout={layout}
        config={config}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
