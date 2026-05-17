"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Database, Terminal, ZapOff, Loader2 } from "lucide-react";
import { apiService, type TableInfo, type TableSample } from "@/lib/api-service";

export function DataStage({ 
  hasData = true, 
  activeConnectionName,
  activeConnectionId,
  queryData = [],
  queryStats = [],
  queryText,
  view = "telemetry",
  isProcessing = false
}: { 
  hasData?: boolean;
  activeConnectionName?: string;
  activeConnectionId?: string;
  queryData?: Record<string, any>[];
  queryStats?: { label: string; value: string; color?: string }[];
  queryText?: string;
  view?: "telemetry" | "explorer";
  isProcessing?: boolean;
}) {
  const [dateTime, setDateTime] = React.useState<string>("");
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [activeTable, setActiveTable] = React.useState<string | null>(null);
  const [tableSample, setTableSample] = React.useState<TableSample | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (view === "explorer" && activeConnectionId) {
      setError(null);
      // Must load schema first (backend caches it for /sample calls)
      apiService.loadSchema(activeConnectionId)
        .then(() => apiService.listTables(activeConnectionId))
        .then((data) => {
          setTables(data);
          if (data.length > 0) setActiveTable(data[0].name);
        }).catch((err) => {
          console.error("Failed to list tables:", err);
          setError("Failed to initialize telemetry sweep.");
          setTables([]);
        });
    }
  }, [view, activeConnectionId]);

  React.useEffect(() => {
    if (view === "explorer" && activeConnectionId && activeTable) {
      setTableSample(null);
      setError(null);
      apiService.getTableSample(activeConnectionId, activeTable).then((data) => {
        setTableSample(data);
      }).catch((err) => {
        console.error("Failed to get table sample:", err);
        setError(`Uplink Error: Table "${activeTable}" could not be decoded.`);
        setTableSample(null);
      });
    }
  }, [view, activeConnectionId, activeTable]);

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", { 
        month: "short", 
        day: "2-digit", 
        year: "numeric" 
      }).toUpperCase();
      const timeStr = now.toLocaleTimeString("en-US", { 
        hour12: false, 
        hour: "2-digit", 
        minute: "2-digit", 
        second: "2-digit" 
      });
      setDateTime(`${dateStr} // ${timeStr}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentTableInfo = tables.find((t) => t.name === activeTable);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
      {isProcessing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {/* Header */}
      <header className="p-6 border-b border-border flex items-center justify-between h-16 bg-background/50 backdrop-blur-sm shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground tracking-tight">
            {activeConnectionName || "Holonet Starship Registry"}
          </h1>
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest opacity-70 leading-none">
            {view === "explorer" ? `SCHEMA EXPLORER // ${activeTable || "STANDBY"}` : (queryText || "Database Connected")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border bg-accent/20">
            <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">{dateTime}</span>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <div className="flex-1 p-6 overflow-auto custom-scrollbar">
        <AnimatePresence mode="wait">
          {view === "explorer" ? (
            <motion.div 
              key="explorer-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex gap-6 h-full"
            >
              {/* Table List */}
              <div className="w-64 shrink-0 flex flex-col gap-2">
                <h3 className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em] px-2 mb-2">Tables</h3>
                {tables.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setActiveTable(t.name)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border border-border bg-card/10 font-mono text-xs transition-all",
                      activeTable === t.name
                        ? "bg-primary/10 border-primary/20 text-primary"
                        : "bg-muted/30 border-transparent text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{t.name.toUpperCase()}</span>
                      <span className="opacity-40">{t.row_count ?? "—"}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Data View */}
              <div className="flex-1 min-w-0 flex flex-col gap-6">
                {error ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-12 border border-dashed border-destructive/30 rounded-lg bg-destructive/5">
                    <ZapOff className="w-10 h-10 text-destructive opacity-80 mb-4" />
                    <h3 className="text-lg font-bold text-foreground uppercase tracking-tight mb-2">Telemetry Interrupted</h3>
                    <p className="max-w-md text-muted-foreground text-xs font-mono uppercase leading-relaxed opacity-70">
                      {error}
                    </p>
                  </div>
                ) : tableSample ? (
                  <>
                    <div className="rounded-lg border border-border bg-card/10 overflow-hidden shadow-sm">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow className="border-border hover:bg-transparent">
                            {tableSample.columns.map((col) => (
                              <TableHead key={col} className="text-muted-foreground font-medium py-4 text-[11px] uppercase tracking-wider px-6">
                                {col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tableSample.rows.map((row, idx) => (
                            <TableRow key={idx} className="border-border hover:bg-muted/40">
                              {tableSample.columns.map((col) => (
                                <TableCell key={col} className="font-mono text-xs py-3.5 px-6">
                                  {String(row[col] ?? "")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="p-4 rounded-lg border border-dashed border-border bg-accent/5">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase opacity-60">
                        Displaying first {tableSample.rows.length} of {Math.max(tableSample.row_count || 0, currentTableInfo?.row_count || 0, tableSample.rows.length || 0)} records for local vector analysis.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-center p-12 opacity-50">
                    <p className="font-mono text-xs uppercase tracking-widest">Select a table to initialize telemetry</p>
                  </div>
                )}
              </div>
            </motion.div>
          ) : hasData && queryData.length > 0 ? (
            <motion.div 
              key="data-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="space-y-6"
            >
              <div className="rounded-lg border border-border bg-card/10 overflow-hidden shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow className="border-border hover:bg-transparent">
                      {Object.keys(queryData[0] || {}).map((col) => (
                        <TableHead key={col} className="text-muted-foreground font-medium py-4 text-[11px] uppercase tracking-wider px-6">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queryData.map((row, idx) => (
                      <motion.tr
                        key={idx}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.03 }}
                        className="border-border hover:bg-muted/40 transition-colors duration-200"
                      >
                        {Object.keys(row).map((col) => (
                          <TableCell key={col} className="font-mono text-xs py-3.5 px-6">
                            {String(row[col] ?? "")}
                          </TableCell>
                        ))}
                      </motion.tr>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {queryStats.map((stat, i) => (
                  <motion.div 
                    key={`${stat.label}-${i}`}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 + (i * 0.05) }}
                    className="p-5 rounded-lg border border-border bg-card/10 hover:bg-card/20 transition-colors duration-200"
                  >
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">{stat.label}</div>
                    <div className={cn("text-2xl font-bold mt-1.5 tracking-tight", stat.color || "text-foreground")}>{stat.value}</div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="empty-view"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.01 }}
              className="h-full flex flex-col items-center justify-center text-center p-12"
            >
              <div className="relative mb-10">
                <div className="absolute inset-0 bg-primary/10 blur-[80px] rounded-full" />
                <div className="relative w-24 h-24 rounded-2xl border border-primary/20 flex items-center justify-center bg-card shadow-lg">
                  <Terminal className="w-10 h-10 text-primary opacity-80" />
                </div>
              </div>
              <h2 className="text-3xl font-bold text-foreground mb-3 tracking-tight uppercase">Registry Standby</h2>
              <p className="max-w-md text-muted-foreground text-base mb-8 leading-relaxed opacity-80">
                {hasData 
                  ? "Select a telemetry record from the Query History to initialize visualization."
                  : "Engagement protocol required. Initialize voice uplink or manual entry to begin telemetry sweep."}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted/20 text-[10px] font-mono text-muted-foreground uppercase tracking-widest shadow-sm">
                  <Database className="w-3 h-3" />
                  Cache Online
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted/20 text-[10px] font-mono text-muted-foreground uppercase tracking-widest shadow-sm">
                  <Search className="w-3 h-3" />
                  Sensors Active
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
