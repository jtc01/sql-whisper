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
import { Search, Database, Terminal } from "lucide-react";
import { type StarshipTelemetry } from "@/app/page";
import { apiService, type DBSchema } from "@/lib/api-service";

const getAffiliationColor = (affiliation: string) => {
  switch (affiliation) {
    case "Rebel Alliance": return "text-rose-500 bg-rose-500/10 border-rose-500/20";
    case "Galactic Empire": return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
    case "Galactic Republic": return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    default: return "text-muted-foreground bg-accent border-border";
  }
};

export function DataStage({ 
  hasData = true, 
  activeConnectionName,
  activeConnectionId,
  queryData = [],
  queryStats = [],
  queryText,
  view = "telemetry"
}: { 
  hasData?: boolean;
  activeConnectionName?: string;
  activeConnectionId?: string;
  queryData?: StarshipTelemetry[];
  queryStats?: { label: string; value: string; color?: string }[];
  queryText?: string;
  view?: "telemetry" | "explorer";
}) {
  const [dateTime, setDateTime] = React.useState<string>("");
  const [schema, setSchema] = React.useState<DBSchema | null>(null);
  const [activeTable, setActiveTable] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (view === "explorer" && activeConnectionId) {
      apiService.getDatabaseSchema(activeConnectionId).then((data: DBSchema) => {
        setSchema(data);
        if (data.tables.length > 0) setActiveTable(data.tables[0].name);
      });
    }
  }, [view, activeConnectionId]);

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

  const currentTableData = schema?.tables.find((t) => t.name === activeTable);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
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
                {schema?.tables.map((t) => (
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
                      <span className="opacity-40">{t.rowCount}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Data View */}
              <div className="flex-1 min-w-0 flex flex-col gap-6">
                {currentTableData ? (
                  <>
                    <div className="rounded-lg border border-border bg-card/10 overflow-hidden shadow-sm">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow className="border-border hover:bg-transparent">
                            {currentTableData.columns.map((col: string) => (
                              <TableHead key={col} className="text-muted-foreground font-medium py-4 text-[11px] uppercase tracking-wider px-6">
                                {col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentTableData.sample.map((row, idx) => (
                            <TableRow key={idx} className="border-border hover:bg-muted/40">
                              {currentTableData.columns.map((col) => (
                                <TableCell key={col} className="font-mono text-xs py-3.5 px-6">
                                  {row[col]}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="p-4 rounded-lg border border-dashed border-border bg-accent/5">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase opacity-60">
                        Displaying first {currentTableData.sample.length} of {currentTableData.rowCount} records for local vector analysis.
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
                      <TableHead className="text-muted-foreground font-medium py-4 text-[11px] uppercase tracking-wider px-6">Vessel</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Class</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Faction</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Atmospheric Speed</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Hyperdrive</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider text-right px-6">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queryData.map((ship, idx) => (
                      <motion.tr
                        key={`${ship.name}-${idx}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.03 }}
                        className="border-border hover:bg-muted/40 transition-colors duration-200"
                      >
                        <TableCell className="font-semibold text-foreground py-3.5 px-6">{ship.name}</TableCell>
                        <TableCell className="text-muted-foreground text-xs uppercase tracking-tight">{ship.class}</TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border", getAffiliationColor(ship.affiliation))}>
                            {ship.affiliation}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-foreground text-sm">{ship.speed} km/h</TableCell>
                        <TableCell className="font-mono text-foreground text-sm opacity-80">
                          {ship.hyperdrive === "N/A" ? "—" : `CLASS ${ship.hyperdrive}`}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground px-6">
                          {ship.status}
                        </TableCell>
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
