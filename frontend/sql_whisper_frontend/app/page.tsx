"use client";

import * as React from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DataStage } from "@/components/dashboard/data-stage";
import { VoiceControls } from "@/components/dashboard/voice-controls";

export default function Home() {
  const [hasData, setHasData] = React.useState(true);
  const [isQueryPending, setIsQueryPending] = React.useState(false);

  const handleNewQuery = () => {
    setHasData(false);
    setIsQueryPending(true);
  };

  const handleDataReceived = () => {
    setHasData(true);
    setIsQueryPending(false);
  };

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Collapsible Sidebar */}
      <Sidebar onNewQuery={handleNewQuery} />

      {/* Main Content Area */}
      <div className="relative flex-1 flex flex-col min-w-0">
        <DataStage hasData={hasData} />
        
        {/* Floating Voice Controls */}
        <VoiceControls 
          showKeyboard={isQueryPending} 
          onQueryComplete={handleDataReceived} 
        />
      </div>
    </main>
  );
}
