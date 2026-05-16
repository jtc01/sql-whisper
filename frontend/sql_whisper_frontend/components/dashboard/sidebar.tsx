"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, MessageSquare, History, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "./mode-toggle";

const MOCK_QUERIES = [
  "Show me starships with a Class 1 hyperdrive",
  "List all TIE variants in the Death Star hangar",
  "Compare atmospheric speed: X-Wing vs A-Wing",
  "Find active Corellian Corvettes near Alderaan",
  "What is the average shielding for Mon Calamari cruisers?",
  "List starships with Hyperdrive Rating < 0.5",
  "Show Imperial fleet composition in the Mid Rim",
];

export function Sidebar({ onNewQuery }: { onNewQuery?: () => void }) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  return (
    <motion.div
      initial={false}
      animate={{ width: isCollapsed ? 80 : 320 }}
      transition={{ 
        type: "spring", 
        stiffness: 400, 
        damping: 40,
        mass: 1
      }}
      className="relative h-full flex flex-col border-r border-border bg-background overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="flex items-center p-4 border-b border-border h-16 shrink-0">
        {!isCollapsed && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 flex-1"
          >
            <History className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-foreground whitespace-nowrap text-sm">Context Ledger</span>
          </motion.div>
        )}
        <div className={cn("flex items-center gap-2", isCollapsed && "w-full justify-center")}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* New Query Button */}
      <div className="p-3 shrink-0">
        <Button 
          variant="outline" 
          onClick={onNewQuery}
          className={cn(
            "w-full justify-start gap-2 border-border bg-accent/20 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-200",
            isCollapsed && "px-0 justify-center"
          )}
        >
          <Plus className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span className="text-sm">New Query</span>}
        </Button>
      </div>

      {/* Query List */}
      <ScrollArea className="flex-1 custom-scrollbar">
        <div className="p-3 space-y-1">
          {MOCK_QUERIES.map((query) => (
            <button
              key={query}
              className={cn(
                "w-full text-left p-2 rounded-md transition-colors hover:bg-accent group flex items-start gap-3",
                isCollapsed && "justify-center px-0"
              )}
            >
              <MessageSquare className="w-4 h-4 mt-0.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors duration-200" />
              {!isCollapsed && (
                <span className="text-sm text-muted-foreground group-hover:text-foreground line-clamp-2">
                  {query}
                </span>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Footer / System Status */}
      <div className="shrink-0">
        {isCollapsed ? (
          <div className="flex justify-center p-4 border-t border-border">
            <ModeToggle />
          </div>
        ) : (
          <div className="p-4 border-t border-border bg-accent/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent border border-border flex items-center justify-center text-[10px] font-mono text-muted-foreground">
                SYS
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-mono text-emerald-500 uppercase tracking-widest leading-none">Online</span>
              </div>
            </div>
            <ModeToggle />
          </div>
        )}
      </div>
    </motion.div>
  );
}
