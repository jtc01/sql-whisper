"use client";

import * as React from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DataStage } from "@/components/dashboard/data-stage";
import { VoiceControls } from "@/components/dashboard/voice-controls";
import { apiService } from "@/lib/api-service";
import { pingBackend } from "@/lib/api-config";
import { Loader2, ZapOff, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface QueryResult {
  id: string;
  connection_id: string;
  text: string;
  created_at: string; // ISO-8601
  data: Record<string, any>[];
  stats: { label: string; value: string; color?: string }[];
}

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  type: string;
  status: "online" | "offline";
}

export default function Home() {
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [queryHistory, setQueryHistory] = React.useState<QueryResult[]>([]);
  
  const [activeConnectionId, setActiveConnectionId] = React.useState<string>("");
  const [activeQueryId, setActiveQueryId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"telemetry" | "explorer">("telemetry");
  
  const [isLoading, setIsLoading] = React.useState(true);
  const [isBackendDown, setIsBackendDown] = React.useState(false);
  const [hasData, setHasData] = React.useState(false);
  const [isQueryPending, setIsQueryPending] = React.useState(false);

  // 1. Initial Load: Reachability + Connections
  React.useEffect(() => {
    const initializeSystem = async () => {
      setIsLoading(true);
      setIsBackendDown(false);
      
      try {
        const isUp = await pingBackend();
        if (!isUp) {
          setIsBackendDown(true);
          setIsLoading(false);
          return;
        }

        const data = await apiService.listConnections();
        setConnections(data);
        if (data.length > 0) {
          const firstConn = data[0];
          setActiveConnectionId(firstConn.id);
          setView("explorer");
        }
      } catch (error) {
        console.error("Critical Uplink Failure:", error);
        setIsBackendDown(true);
      } finally {
        setIsLoading(false);
      }
    };
    initializeSystem();
  }, []);

  // 2. Load History on Connection Switch
  React.useEffect(() => {
    if (!activeConnectionId) return;

    const loadHistory = async () => {
      try {
        const data = await apiService.listHistory(activeConnectionId);
        setQueryHistory(prev => {
          const filtered = prev.filter(q => q.connection_id !== activeConnectionId);
          return [...filtered, ...data];
        });
        
        if (data.length > 0) {
          // If we just selected a connection, we are in explorer view.
          // Don't auto-select a query unless we explicitly want to.
          // But for now, let's keep current behavior: if has history, show first query telemetry.
          // Wait - user said "clicking on empty database with no queries, new query page opens automatically".
          // This implies if it HAS queries, maybe it should show them?
          // Let's stick to the directive: click connection -> show explorer.
        } else {
          setActiveQueryId(null);
          setHasData(false);
          setIsQueryPending(true);
          setView("telemetry"); // Open new query page
        }
      } catch (error) {
        console.error("Telemetry History Lost:", error);
      }
    };
    loadHistory();
  }, [activeConnectionId]);

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const activeQuery = queryHistory.find((q) => q.id === activeQueryId);

  // Stitch queries to connections for Sidebar rendering
  const connectionsWithQueries = React.useMemo(() => {
    return connections.map(conn => ({
      ...conn,
      queries: queryHistory
        .filter(q => q.connection_id === conn.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }));
  }, [connections, queryHistory]);

  const handleNewQuery = React.useCallback(() => {
    setHasData(false);
    setIsQueryPending(true);
    setActiveQueryId(null);
    setView("telemetry");
  }, []);

  const handleQuerySuccess = React.useCallback((result: QueryResult) => {
    setQueryHistory(prev => [result, ...prev]);
    setHasData(true);
    setIsQueryPending(false);
    setActiveQueryId(result.id);
    setView("telemetry");
  }, []);

  const handleAddDatabase = React.useCallback(async (db: {
    name: string;
    host: string;
    port: number;
    db_name: string;
    username: string;
    password?: string;
    db_type: string;
  }) => {
    try {
      const { connection_id } = await apiService.createConnection(db);
      
      const testResult = await apiService.testConnection(connection_id);
      if (!testResult.ok) {
        throw new Error(testResult.error || "Database connection validation failed.");
      }

      const newConn: Connection = {
        id: connection_id,
        name: db.name,
        host: db.host,
        port: db.port,
        database: db.db_name,
        type: db.db_type,
        status: "online",
      };
      setConnections((prev) => [newConn, ...prev]);
      setActiveConnectionId(connection_id);
      setView("explorer");
    } catch (error) {
      console.error("Vector Registration Failed:", error);
      throw error;
    }
  }, []);

  const handleDeleteConnection = React.useCallback(async (id: string) => {
    try {
      await apiService.deleteConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      setQueryHistory((prev) => prev.filter((q) => q.connection_id !== id));
      
      if (activeConnectionId === id) {
        const next = connections.find(c => c.id !== id);
        setActiveConnectionId(next?.id || "");
        setView("explorer");
      }
    } catch (error) {
      console.error("Uplink Termination Failed:", error);
    }
  }, [activeConnectionId, connections]);

  const handleSelectConnection = React.useCallback((id: string) => {
    setActiveConnectionId(id);
    setView("explorer");
  }, []);

  const handleSelectQuery = React.useCallback((id: string) => {
    setActiveQueryId(id);
    setHasData(true);
    setIsQueryPending(false);
    setView("telemetry");
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background font-mono">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <span className="text-[10px] uppercase tracking-[0.4em] opacity-50">Establishing Secure Uplink</span>
      </div>
    );
  }

  if (isBackendDown) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background font-mono p-6 text-center">
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-rose-500/10 blur-3xl rounded-full" />
          <div className="relative p-6 rounded-2xl border border-rose-500/20 bg-card shadow-2xl">
            <ZapOff className="w-12 h-12 text-rose-500 opacity-80" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2 uppercase tracking-tight">Signal Terminated</h1>
        <p className="max-w-md text-muted-foreground text-sm mb-8 leading-relaxed">
          The remote telemetry hub is unreachable. Verify your ngrok tunnel is active or fallback to a local vector.
        </p>
        <Button 
          variant="outline" 
          className="gap-2 border-rose-500/20 hover:bg-rose-500/10 hover:text-rose-500"
          onClick={() => window.location.reload()}
        >
          <RefreshCcw className="w-4 h-4" />
          Attempt Re-uplink
        </Button>
      </div>
    );
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Collapsible Sidebar */}
      <Sidebar 
        connections={connectionsWithQueries}
        activeConnectionId={activeConnectionId}
        activeQueryId={activeQueryId}
        onSelectConnection={handleSelectConnection}
        onSelectQuery={handleSelectQuery}
        onAddDatabase={handleAddDatabase}
        onDeleteConnection={handleDeleteConnection}
        onNewQuery={handleNewQuery} 
      />

      {/* Main Content Area */}
      <div className="relative flex-1 flex flex-col min-w-0">
        <DataStage 
          hasData={hasData} 
          activeConnectionName={activeConnection?.name}
          activeConnectionId={activeConnectionId}
          queryData={activeQuery?.data}
          queryStats={activeQuery?.stats}
          queryText={activeQuery?.text}
          view={view}
        />
        
        {/* Floating Voice Controls */}
        <VoiceControls 
          activeConnectionId={activeConnectionId}
          showKeyboard={isQueryPending} 
          onQueryComplete={handleQuerySuccess} 
        />
      </div>
    </main>
  );
}
