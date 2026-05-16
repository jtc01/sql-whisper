"use client";

import * as React from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DataStage } from "@/components/dashboard/data-stage";
import { VoiceControls } from "@/components/dashboard/voice-controls";
import INITIAL_DATA from "@/lib/mock-db.json";

export interface StarshipTelemetry {
  name: string;
  class: string;
  affiliation: string;
  speed: string;
  hyperdrive: string;
  status: string;
}

export interface QueryResult {
  id: string;
  connection_id: string;
  text: string;
  created_at: string; // ISO-8601
  data: StarshipTelemetry[];
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
  const [connections, setConnections] = React.useState<Connection[]>(INITIAL_DATA.connections as Connection[]);
  const [queryHistory, setQueryHistory] = React.useState<QueryResult[]>(INITIAL_DATA.query_history as QueryResult[]);
  
  const [activeConnectionId, setActiveConnectionId] = React.useState<string>(INITIAL_DATA.connections[0].id);
  const [activeQueryId, setActiveQueryId] = React.useState<string | null>(INITIAL_DATA.query_history.find(q => q.connection_id === INITIAL_DATA.connections[0].id)?.id || null);
  
  const [hasData, setHasData] = React.useState(true);
  const [isQueryPending, setIsQueryPending] = React.useState(false);

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const activeQuery = queryHistory.find((q) => q.id === activeQueryId);

  // Stitch queries to connections for Sidebar rendering
  const connectionsWithQueries = React.useMemo(() => {
    return connections.map(conn => ({
      ...conn,
      queries: queryHistory.filter(q => q.connection_id === conn.id)
    }));
  }, [connections, queryHistory]);

  const handleNewQuery = React.useCallback(() => {
    setHasData(false);
    setIsQueryPending(true);
    setActiveQueryId(null);
  }, []);

  const handleDataReceived = React.useCallback(() => {
    const newQuery: QueryResult = {
      id: Math.random().toString(36).substring(7),
      connection_id: activeConnectionId,
      text: "Manual Telemetry Sweep",
      created_at: new Date().toISOString(),
      data: INITIAL_DATA.query_history[0].data as StarshipTelemetry[],
      stats: [
        { label: "New Records", value: "12", color: "text-primary" },
        { label: "Sync Latency", value: "24ms", color: "text-emerald-500" },
      ]
    };

    setQueryHistory(prev => [newQuery, ...prev]);
    setHasData(true);
    setIsQueryPending(false);
    setActiveQueryId(newQuery.id);
  }, [activeConnectionId]);

  const handleAddDatabase = React.useCallback((db: Omit<Connection, "id" | "status">) => {
    const newConn: Connection = {
      ...db,
      id: Math.random().toString(36).substring(7),
      status: "online",
    };
    setConnections((prev) => [...prev, newConn]);
    setActiveConnectionId(newConn.id);
    setActiveQueryId(null);
    setHasData(false);
    setIsQueryPending(true);
  }, []);

  const handleDeleteConnection = React.useCallback((id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setQueryHistory((prev) => prev.filter((q) => q.connection_id !== id));
    
    if (activeConnectionId === id) {
      const next = connections.find(c => c.id !== id);
      setActiveConnectionId(next?.id || "");
      const nextQuery = queryHistory.find(q => q.connection_id === next?.id);
      setActiveQueryId(nextQuery?.id || null);
    }
  }, [activeConnectionId, connections, queryHistory]);

  const handleSelectConnection = React.useCallback((id: string) => {
    setActiveConnectionId(id);
    const firstQuery = queryHistory.find(q => q.connection_id === id);
    
    if (firstQuery) {
      setActiveQueryId(firstQuery.id);
      setHasData(true);
      setIsQueryPending(false);
    } else {
      setActiveQueryId(null);
      setHasData(false);
      setIsQueryPending(true);
    }
  }, [queryHistory]);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Collapsible Sidebar */}
      <Sidebar 
        connections={connectionsWithQueries}
        activeConnectionId={activeConnectionId}
        activeQueryId={activeQueryId}
        onSelectConnection={handleSelectConnection}
        onSelectQuery={setActiveQueryId}
        onAddDatabase={handleAddDatabase}
        onDeleteConnection={handleDeleteConnection}
        onNewQuery={handleNewQuery} 
      />

      {/* Main Content Area */}
      <div className="relative flex-1 flex flex-col min-w-0">
        <DataStage 
          hasData={hasData} 
          activeConnectionName={activeConnection?.name}
          queryData={activeQuery?.data}
          queryStats={activeQuery?.stats}
          queryText={activeQuery?.text}
        />
        
        {/* Floating Voice Controls */}
        <VoiceControls 
          showKeyboard={isQueryPending} 
          onQueryComplete={handleDataReceived} 
        />
      </div>
    </main>
  );
}
