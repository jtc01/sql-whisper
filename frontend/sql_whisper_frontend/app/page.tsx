"use client";

import * as React from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DataStage } from "@/components/dashboard/data-stage";
import { VoiceControls } from "@/components/dashboard/voice-controls";

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
  text: string;
  timestamp: string;
  data: StarshipTelemetry[];
  stats: { label: string; value: string; color?: string }[];
}

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: string;
  database: string;
  type: string;
  status: "online" | "offline";
  queries: QueryResult[];
}

const MOCK_SHIP_DATA_1 = [
  { name: "Millennium Falcon", class: "YT-1300 Freighter", affiliation: "Rebel Alliance", speed: "1,050", hyperdrive: "0.5", status: "Active" },
  { name: "Red Five", class: "X-Wing Starfighter", affiliation: "Rebel Alliance", speed: "1,050", hyperdrive: "1.0", status: "Active" },
  { name: "Tantive IV", class: "CR90 Corvette", affiliation: "Rebel Alliance", speed: "950", hyperdrive: "2.0", status: "Active" },
];

const MOCK_SHIP_DATA_2 = [
  { name: "Devastator", class: "Star Destroyer", affiliation: "Galactic Empire", speed: "975", hyperdrive: "2.0", status: "Patrol" },
  { name: "TIE Interceptor", class: "Starfighter", affiliation: "Galactic Empire", speed: "1,250", hyperdrive: "N/A", status: "Patrol" },
];

const INITIAL_CONNECTIONS: Connection[] = [
  {
    id: "1",
    name: "HOLONET_CORE",
    host: "core.nexus.galactic",
    port: "5432",
    database: "starship_registry",
    type: "PostgreSQL",
    status: "online",
    queries: [
      {
        id: "q1",
        text: "Show me active Rebel starships",
        timestamp: "13:45:00",
        data: MOCK_SHIP_DATA_1,
        stats: [
          { label: "Detected Vessels", value: "3", color: "text-foreground" },
          { label: "Alliance Uplinks", value: "Active", color: "text-rose-500" },
          { label: "Signal Strength", value: "98%", color: "text-emerald-500" },
        ]
      },
      {
        id: "q2",
        text: "Scan for Imperial patrol craft",
        timestamp: "13:50:22",
        data: MOCK_SHIP_DATA_2,
        stats: [
          { label: "Imperial Presence", value: "High", color: "text-emerald-500" },
          { label: "Threat Level", value: "V-4", color: "text-rose-500" },
          { label: "Sector Safety", value: "12%", color: "text-amber-500" },
        ]
      }
    ],
  },
  {
    id: "2",
    name: "IMPERIAL_LOGISTICS",
    host: "logistics.imp.gov",
    port: "5432",
    database: "supply_chain",
    type: "PostgreSQL",
    status: "online",
    queries: [],
  },
];

export default function Home() {
  const [connections, setConnections] = React.useState<Connection[]>(INITIAL_CONNECTIONS);
  const [activeConnectionId, setActiveConnectionId] = React.useState<string>(INITIAL_CONNECTIONS[0].id);
  const [activeQueryId, setActiveQueryId] = React.useState<string | null>(INITIAL_CONNECTIONS[0].queries[0]?.id || null);
  const [hasData, setHasData] = React.useState(true);
  const [isQueryPending, setIsQueryPending] = React.useState(false);

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const activeQuery = activeConnection?.queries.find((q) => q.id === activeQueryId);

  const handleNewQuery = React.useCallback(() => {
    setHasData(false);
    setIsQueryPending(true);
    setActiveQueryId(null);
  }, []);

  const handleDataReceived = React.useCallback(() => {
    // In a real app, this would be the actual data from the query
    const newQuery: QueryResult = {
      id: Math.random().toString(36).substring(7),
      text: "Manual Telemetry Sweep",
      timestamp: new Date().toLocaleTimeString(),
      data: MOCK_SHIP_DATA_1,
      stats: [
        { label: "New Records", value: "12", color: "text-primary" },
        { label: "Sync Latency", value: "24ms", color: "text-emerald-500" },
      ]
    };

    setConnections(prev => prev.map(c => 
      c.id === activeConnectionId 
        ? { ...c, queries: [newQuery, ...c.queries] }
        : c
    ));
    
    setHasData(true);
    setIsQueryPending(false);
    setActiveQueryId(newQuery.id);
  }, [activeConnectionId]);

  const handleAddDatabase = React.useCallback((db: Omit<Connection, "id" | "status" | "queries">) => {
    const newConn: Connection = {
      ...db,
      id: Math.random().toString(36).substring(7),
      status: "online",
      queries: [],
    };
    setConnections((prev) => [...prev, newConn]);
    setActiveConnectionId(newConn.id);
    setActiveQueryId(null);
  }, []);

  const handleDeleteConnection = React.useCallback((id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    if (activeConnectionId === id) {
      const next = connections.find(c => c.id !== id);
      setActiveConnectionId(next?.id || "");
      setActiveQueryId(next?.queries[0]?.id || null);
    }
  }, [activeConnectionId, connections]);

  const handleSelectConnection = React.useCallback((id: string) => {
    setActiveConnectionId(id);
    const conn = connections.find(c => c.id === id);
    const queries = conn?.queries || [];
    
    if (queries.length > 0) {
      setActiveQueryId(queries[0].id);
      setHasData(true);
      setIsQueryPending(false);
    } else {
      setActiveQueryId(null);
      setHasData(false);
      setIsQueryPending(true);
    }
  }, [connections]);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Collapsible Sidebar */}
      <Sidebar 
        connections={connections}
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
