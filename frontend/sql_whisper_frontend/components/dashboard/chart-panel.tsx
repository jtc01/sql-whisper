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
  const [isDark, setIsDark] = React.useState(true);

  // Detect theme changes
  React.useEffect(() => {
    const checkTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    checkTheme();

    // Watch for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  if (!data || data.length === 0) return null;

  const traces = buildTraces(spec, data);

  // Theme-aware colors
  const fontColor = isDark ? "#e5e5e5" : "#1a1a1a";
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const zeroLineColor = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";

  /**
   * Plotly layout — edit freely.
   * transparent paper_bgcolor / plot_bgcolor makes it respect the app theme.
   */
  const layout: Partial<Plotly.Layout> = {
    title: { text: spec.title, font: { size: 14, color: fontColor } },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { color: fontColor, size: 11 },
    margin: { t: 48, r: 24, b: 48, l: 48 },
    xaxis: {
      title: { text: spec.x },
      gridcolor: gridColor,
      zerolinecolor: zeroLineColor,
      tickfont: { color: fontColor },
    },
    yaxis: {
      title: { text: spec.y },
      gridcolor: gridColor,
      zerolinecolor: zeroLineColor,
      tickfont: { color: fontColor },
    },
    legend: { orientation: "h", y: -0.2, font: { color: fontColor } },
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
