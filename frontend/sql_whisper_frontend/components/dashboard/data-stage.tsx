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

const STARSHIP_DATA = [
  { name: "Millennium Falcon", class: "YT-1300 Freighter", affiliation: "Rebel Alliance", speed: "1,050", hyperdrive: "0.5", status: "Active" },
  { name: "Devastator", class: "Star Destroyer", affiliation: "Galactic Empire", speed: "975", hyperdrive: "2.0", status: "Patrol" },
  { name: "Red Five", class: "X-Wing Starfighter", affiliation: "Rebel Alliance", speed: "1,050", hyperdrive: "1.0", status: "Active" },
  { name: "Slave I", class: "Firespray-31", affiliation: "Bounty Hunter", speed: "1,000", hyperdrive: "0.7", status: "Docked" },
  { name: "Naboo N-1", class: "Starfighter", affiliation: "Galactic Republic", speed: "1,100", hyperdrive: "1.0", status: "Standby" },
  { name: "Tantive IV", class: "CR90 Corvette", affiliation: "Rebel Alliance", speed: "950", hyperdrive: "2.0", status: "Active" },
  { name: "Eta-2 Actis", class: "Jedi Interceptor", affiliation: "Galactic Republic", speed: "1,500", hyperdrive: "1.0", status: "Active" },
  { name: "TIE Interceptor", class: "Starfighter", affiliation: "Galactic Empire", speed: "1,250", hyperdrive: "N/A", status: "Patrol" },
];

const getAffiliationColor = (affiliation: string) => {
  switch (affiliation) {
    case "Rebel Alliance": return "text-rose-500 bg-rose-500/10 border-rose-500/20";
    case "Galactic Empire": return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
    case "Galactic Republic": return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    default: return "text-muted-foreground bg-accent border-border";
  }
};

export function DataStage({ hasData = true }: { hasData?: boolean }) {
  const [time, setTime] = React.useState<string>("");

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour12: false }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
      {/* Header */}
      <header className="p-6 border-b border-border flex items-center justify-between h-16 bg-background/50 backdrop-blur-sm shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground tracking-tight">Holonet Starship Registry</h1>
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest opacity-70">Secure Uplink // {time}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border bg-accent/20">
            <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Scanning Sectors</span>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <div className="flex-1 p-6 overflow-auto custom-scrollbar">
        <AnimatePresence mode="wait">
          {hasData ? (
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
                      <TableHead className="text-muted-foreground font-medium py-4 text-[11px] uppercase tracking-wider">Vessel</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Class</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Faction</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Atmospheric Speed</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider">Hyperdrive</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-[11px] uppercase tracking-wider text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {STARSHIP_DATA.map((ship, idx) => (
                      <motion.tr
                        key={ship.name}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.03 }}
                        className="border-border hover:bg-muted/40 transition-colors duration-200"
                      >
                        <TableCell className="font-semibold text-foreground py-3.5">{ship.name}</TableCell>
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
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {ship.status}
                        </TableCell>
                      </motion.tr>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: "Detected Vessels", value: "1,204", color: "text-foreground" },
                  { label: "Imperial Presence", value: "62%", color: "text-emerald-500" },
                  { label: "Alliance Uplinks", value: "24", color: "text-rose-500" },
                  { label: "Lane Safety", value: "94.1%", color: "text-amber-500" },
                ].map((stat, i) => (
                  <motion.div 
                    key={stat.label}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 + (i * 0.05) }}
                    className="p-5 rounded-lg border border-border bg-card/10 hover:bg-card/20 transition-colors duration-200"
                  >
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">{stat.label}</div>
                    <div className={cn("text-2xl font-bold mt-1.5 tracking-tight", stat.color)}>{stat.value}</div>
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
                Engagement protocol required. Initialize voice uplink or manual entry to begin telemetry sweep.
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
