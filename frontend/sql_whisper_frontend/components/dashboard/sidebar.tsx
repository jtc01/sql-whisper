"use client";

import * as React from "react";
import { Trash2, Database as DbIcon, Settings2, MoreVertical, History, MessageSquare, Plus, ChevronRight, ChevronLeft } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "./mode-toggle";
import { AddDatabaseDialog } from "./add-database-dialog";
import { type Connection, type QueryResult } from "@/app/page";

interface ConnectionWithQueries extends Connection {
  queries: QueryResult[];
}

interface SidebarProps {
  connections: ConnectionWithQueries[];
  activeConnectionId: string;
  activeQueryId: string | null;
  onSelectConnection: (id: string) => void;
  onSelectQuery: (id: string) => void;
  onAddDatabase: (db: {
    name: string;
    host: string;
    port: number;
    db_name: string;
    username: string;
    password?: string;
    db_type: string;
  }) => Promise<void>;
  onDeleteConnection: (id: string) => void;
  onDeleteQuery?: (id: string) => void;
  onNewQuery?: () => void;
}

export function Sidebar({
  connections,
  activeConnectionId,
  activeQueryId,
  onSelectConnection,
  onSelectQuery,
  onAddDatabase,
  onDeleteConnection,
  onDeleteQuery,
  onNewQuery
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  return (
    <motion.div
      initial={false}
      animate={{ width: isCollapsed ? 80 : 400 }}
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
            <span className="font-semibold text-foreground whitespace-nowrap text-sm">Query History</span>
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

      {/* New Query & Add Source Buttons */}
      <div className="p-3 space-y-2 shrink-0 flex flex-col items-center border-b border-border">
        <Button 
          variant="outline" 
          onClick={onNewQuery}
          className={cn(
            "w-full justify-start gap-2 border-border bg-accent/10 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-200 h-10",
            isCollapsed && "w-10 px-0 justify-center"
          )}
        >
          <Plus className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span className="text-xs font-bold uppercase tracking-wider">New Query</span>}
        </Button>

        <AddDatabaseDialog 
          isCollapsed={isCollapsed} 
          onAddDatabase={onAddDatabase}
        />
      </div>

      {/* Main Navigation */}
      <ScrollArea className="flex-1 custom-scrollbar">
        <div className="p-3 space-y-6">
          {/* Connections Section */}
          <div className="space-y-2">
            {!isCollapsed && (
              <h3 className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em] px-2 mb-3">Connections</h3>
            )}
            
            <div className="space-y-1">
              {connections.map((conn) => (
                <div key={conn.id} className="relative group flex min-w-0 w-full">
                  <button
                    onClick={() => onSelectConnection(conn.id)}
                    className={cn(
                      "w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left min-w-0",
                      activeConnectionId === conn.id 
                        ? "bg-primary/10 text-primary border border-primary/20 pr-10" 
                        : "text-muted-foreground hover:bg-accent border border-transparent pr-10",
                      isCollapsed && "justify-center px-0"
                    )}
                  >
                    <div className="relative shrink-0">
                      <DbIcon className={cn("w-4 h-4", activeConnectionId === conn.id ? "text-primary" : "text-muted-foreground")} />
                      {conn.status === "online" && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full border-2 border-background" />
                      )}
                    </div>
                    {!isCollapsed && (
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <p className="text-[11px] font-mono font-bold truncate tracking-wider leading-tight w-full">{conn.name}</p>
                        <p className="text-[9px] font-mono opacity-50 truncate uppercase tracking-tighter mt-0.5 w-full">{conn.type}{" // "}{conn.host}</p>
                      </div>
                    )}
                  </button>
                  
                  {!isCollapsed && activeConnectionId === conn.id && (
                    <div className="absolute right-1.5 top-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-xl border-border">
                          <DropdownMenuItem className="text-[10px] font-mono uppercase cursor-pointer">
                            <Settings2 className="w-3 h-3 mr-2" />
                            Edit Config
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-[10px] font-mono uppercase text-destructive cursor-pointer"
                            onClick={() => onDeleteConnection(conn.id)}
                          >
                            <Trash2 className="w-3 h-3 mr-2" />
                            Terminate Uplink
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Active Connection History */}
          {activeConnection && (
            <div className="space-y-2 pt-2">
              {!isCollapsed && (
                <div className="flex items-center justify-between px-2 mb-3">
                  <h3 className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">Context Store</h3>
                  <span className="text-[9px] font-mono bg-accent px-1.5 py-0.5 rounded opacity-50 uppercase">{activeConnection.queries.length} Entries</span>
                </div>
              )}
              
              <div className="space-y-1">
                {activeConnection.queries.map((query) => (
                  <div key={query.id} className="relative group flex min-w-0 w-full">
                    <button
                      onClick={() => onSelectQuery(query.id)}
                      className={cn(
                        "w-full text-left p-2.5 rounded-lg transition-all border border-transparent min-w-0 overflow-hidden",
                        activeQueryId === query.id
                          ? "bg-accent text-foreground border-border"
                          : "hover:bg-accent/50 text-muted-foreground",
                        isCollapsed && "justify-center px-0"
                      )}
                    >
                      <div className="flex items-start gap-3 min-w-0 w-full pr-8">
                        <MessageSquare className={cn(
                          "w-4 h-4 mt-0.5 shrink-0 transition-colors duration-200",
                          activeQueryId === query.id ? "text-primary" : "group-hover:text-primary"
                        )} />
                        {!isCollapsed && (
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <span className="text-[11px] font-mono block truncate leading-tight uppercase font-bold tracking-tight mb-0.5 max-w-[200px]">
                              {query.text}
                            </span>
                            <span className="text-[8px] font-mono opacity-50 uppercase tracking-widest block">
                              {new Date(query.created_at).toLocaleTimeString([], { hour12: false })}
                            </span>
                          </div>
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-xl border-border">
                            <DropdownMenuItem
                              className="text-[10px] font-mono uppercase text-destructive cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteQuery?.(query.id);
                              }}
                            >
                              <Trash2 className="w-3 h-3 mr-2" />
                              Delete Entry
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                ))}
                
                {activeConnection.queries.length === 0 && !isCollapsed && (
                  <div className="p-8 text-center border border-dashed border-border rounded-lg bg-accent/5">
                    <History className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-[10px] font-mono text-muted-foreground uppercase opacity-40">No telemetry recorded</p>
                  </div>
                )}
              </div>
            </div>
          )}
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
