"use client";

import * as React from "react";
import { Mic, Square, Loader2, Keyboard, Send, X, AlertCircle, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { apiService } from "@/lib/api-service";
import { type QueryResult, type ConversationMessage } from "@/app/page";
import { useMicrophone } from "@/hooks/use-microphone";

interface VoiceControlsProps {
  onQueryStart?: () => void;
  onQueryComplete?: (result: QueryResult) => void;
  onQueryError?: () => void;
  onNewConversation?: () => void;
  showKeyboard?: boolean;
  activeConnectionId?: string;
  conversationHistory?: ConversationMessage[];
  hasActiveConversation?: boolean;
}

export function VoiceControls({ onQueryStart, onQueryComplete, onQueryError, onNewConversation, showKeyboard = true, activeConnectionId, conversationHistory = [], hasActiveConversation = false }: VoiceControlsProps) {
  const [mode, setMode] = React.useState<"voice" | "text">("voice");
  const [textQuery, setTextQuery] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleSuggestionClick = React.useCallback((suggestion: string) => {
    setTextQuery(suggestion + " ");
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  }, []);

  const { status, error, startRecording, stopRecording } = useMicrophone({
    activeConnectionId,
    onStart: onQueryStart,
    onSuccess: onQueryComplete,
    onError: onQueryError,
    conversationHistory,
  });

  // Keep a ref synced with status so async handlers can read the current state reliably
  const statusRef = React.useRef(status);
  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const handleQuery = React.useCallback(async (question: string) => {
    if (!activeConnectionId || !question.trim()) return;
    onQueryStart?.();
    try {
      const isFollowUp = conversationHistory.length > 0;
      const response = await apiService.ask(activeConnectionId, question, conversationHistory);
      const result: QueryResult = {
        id: `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        connection_id: activeConnectionId,
        text: response.text || question,
        answer: response.answer,
        sql: response.sql,
        created_at: new Date().toISOString(),
        data: response.data || [],
        stats: response.stats || [],
        chartSpec: response.chartSpec,
        messages: response.messages || [],
        isFollowUp,
      };
      onQueryComplete?.(result);
      setTextQuery("");
      setMode("voice");
    } catch (error) {
      console.error("[Voice] Query Error:", error);
      onQueryError?.();
      setErrorMessage("Query Failed - Backend Error");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  }, [activeConnectionId, conversationHistory, onQueryStart, onQueryComplete, onQueryError]);

  // Keyboard Spacebar integration
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || mode !== "voice" || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        startRecording();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && mode === "voice") {
        stopRecording();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mode, startRecording, stopRecording]);

  // Text Form Submission
  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (textQuery.trim()) {
        handleQuery(textQuery);
    }
  };

  const spring = { type: "spring" as const, stiffness: 450, damping: 40, mass: 1 };
  const isBusy = status !== "idle" && status !== "error";

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50 flex flex-col items-center gap-4">

      {/* 0. New Conversation Button - shows when in follow-up context */}
      <AnimatePresence>
        {hasActiveConversation && onNewConversation && (
          <motion.button
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            onClick={onNewConversation}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card/80 backdrop-blur-sm hover:bg-accent hover:border-primary/30 transition-all text-muted-foreground hover:text-foreground shadow-lg"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="text-[10px] font-mono uppercase tracking-wider">New Conversation</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* 1. Status Telemetry Banner */}
      <div className="h-10">
        <AnimatePresence mode="wait">
          {status === "idle" && !error && !errorMessage && hasActiveConversation && (
            <motion.div
              key="followup-hint"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="px-4 py-1.5 rounded-lg border border-primary/20 bg-primary/5 backdrop-blur-xl shadow-lg flex items-center gap-2"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-mono text-primary uppercase tracking-wider">Follow-up Mode</span>
            </motion.div>
          )}
          {(status !== "idle" || error || errorMessage) && (
            <motion.div
              key="status-banner"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              className={cn(
                "px-4 py-1.5 rounded-lg border backdrop-blur-xl shadow-lg flex items-center gap-3",
                (status === "error" || error || errorMessage) ? "bg-destructive/10 border-destructive/20" : "bg-card/50 border-border"
              )}
            >
              {status === "processing" ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 text-primary animate-spin" />
                  <span className="text-[10px] font-mono text-primary uppercase font-bold tracking-wider">Analyzing Result</span>
                </div>
              ) : status === "starting" || status === "stopping" ? (
                 <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase font-bold tracking-wider">
                      {status === "starting" ? "Initializing..." : "Closing Link..."}
                  </span>
                </div>
              ) : status === "recording" ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 h-3">
                    {[...Array(4)].map((_, i) => (
                      <motion.div key={i} animate={{ height: [4, 12, 4] }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }} className="w-0.5 bg-rose-500 rounded-full" />
                    ))}
                  </div>
                  <span className="text-[10px] font-mono text-rose-500 uppercase font-bold tracking-wider">Listening</span>
                </div>
              ) : (status === "error" || error || errorMessage) ? (
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-3 h-3" />
                  <span className="text-[10px] font-mono uppercase font-bold tracking-wider">{error || errorMessage || "Error"}</span>
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2. Interactive Input Surface */}
      <motion.div
        layout transition={spring}
        className={cn(
          "relative flex items-center justify-center bg-card border border-border shadow-2xl transition-all duration-300",
          mode === "text" ? "w-full h-16 rounded-2xl px-4" : "w-44 h-20 rounded-full"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {mode === "voice" ? (
            <motion.div 
              key="v" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-4"
            >
              {showKeyboard && (
                <button
                  onClick={() => setMode("text")}
                  className="w-14 h-14 rounded-full bg-secondary/50 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:scale-105 transition-all active:scale-95"
                >
                  <Keyboard className="w-6 h-6" />
                </button>
              )}

              <button
                onMouseDown={startRecording} onMouseUp={stopRecording} onMouseLeave={stopRecording}
                disabled={isBusy && status !== "recording"} // Only allow interaction if idle, error, or recording
                className={cn(
                  "relative z-10 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200",
                  status === "recording" ? "bg-rose-600 scale-95" : "bg-primary hover:scale-105 active:scale-95",
                  (isBusy && status !== "recording" || !activeConnectionId) && "opacity-20 cursor-not-allowed grayscale"
                )}
              >
                {status === "recording" ? <Square className="w-6 h-6 text-white fill-white" /> : <Mic className="w-7 h-7 text-primary-foreground" />}
                
                {status === "recording" && (
                  <div className="absolute inset-0 -z-10">
                    <div className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-20" />
                    <div className="absolute inset-0 rounded-full bg-rose-400 animate-pulse opacity-40 scale-125" />
                  </div>
                )}
              </button>
            </motion.div>
          ) : (
            <motion.div 
              key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="w-full flex flex-col relative"
            >
              <AnimatePresence>
                {textQuery.trim() === "" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute bottom-full left-0 w-full mb-4 flex flex-col gap-2"
                  >
                    {[
                      { label: "Make a chart of...", value: "Make a chart of" },
                      { label: "How many...", value: "How many" },
                      { label: "What is the first...", value: "What is the first" },
                      { label: "Show me total...", value: "Show me total" },
                      { label: "Find recent records", value: "Find recent records" }
                    ].map((suggestion, index) => (
                      <motion.button
                        key={suggestion.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 + 0.1 }}
                        onClick={() => handleSuggestionClick(suggestion.value)}
                        className="whitespace-nowrap text-left text-[11px] font-mono bg-card border border-border shadow-lg hover:bg-accent text-foreground px-4 py-2.5 rounded-xl transition-colors active:scale-95"
                      >
                        {suggestion.label}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleTextSubmit} className="w-full flex items-center gap-4">
                <input
                  ref={inputRef}
                  autoFocus type="text" value={textQuery} onChange={(e) => setTextQuery(e.target.value)}
                  placeholder="Query database..."
                  className="flex-1 bg-transparent outline-none font-mono text-sm uppercase"
                />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="icon" onClick={() => setMode("voice")} className="rounded-xl">
                    <X className="w-5 h-5" />
                  </Button>
                  <Button type="submit" disabled={!textQuery.trim() || status === "processing"} className="h-10 w-10 bg-primary rounded-xl">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
