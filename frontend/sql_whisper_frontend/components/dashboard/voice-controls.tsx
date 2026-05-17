"use client";

import * as React from "react";
import { Mic, Square, Loader2, Keyboard, Send, X, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { apiService } from "@/lib/api-service";
import { type QueryResult } from "@/app/page";
import { useMicrophone } from "@/hooks/use-microphone";

interface VoiceControlsProps {
  onQueryComplete?: (result: QueryResult) => void;
  showKeyboard?: boolean;
  activeConnectionId?: string;
}

export function VoiceControls({ onQueryComplete, showKeyboard = false, activeConnectionId }: VoiceControlsProps) {
  // State
  const [mode, setMode] = React.useState<"voice" | "text">("voice");
  const [textQuery, setTextQuery] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const { status, error, startRecording, stopRecording } = useMicrophone({
    activeConnectionId,
    onSuccess: (result) => {
      onQueryComplete?.(result);
      setTextQuery("");
      setMode("voice");
    }
  });

  // Keep a ref synced with status so async handlers can read the current state reliably
  const statusRef = React.useRef(status);
  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const handleQuery = React.useCallback(async (question: string) => {
    if (!activeConnectionId || !question.trim()) return;
    try {
      const result = await apiService.ask(activeConnectionId, question);
      onQueryComplete?.(result);
      setTextQuery("");
      setMode("voice");
    } catch (error) {
      console.error("[Voice] Query Error:", error);
      setErrorMessage("Query Failed - Backend Error");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  }, [activeConnectionId, onQueryComplete]);

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
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50 flex flex-col items-center gap-6">
      
      {/* 1. Status Telemetry Banner */}
      <div className="h-10">
        <AnimatePresence mode="wait">
          {(status !== "idle" || error || errorMessage) && (
            <motion.div 
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
          mode === "text" ? "w-full h-16 rounded-2xl px-4" : "w-24 h-24 rounded-full"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {mode === "voice" ? (
            <motion.div 
              key="v" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
              className="relative flex items-center justify-center w-full h-full"
            >
              <button
                onMouseDown={startRecording} onMouseUp={stopRecording} onMouseLeave={stopRecording}
                disabled={isBusy && status !== "recording"} // Only allow interaction if idle, error, or recording
                className={cn(
                  "relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200",
                  status === "recording" ? "bg-rose-600 scale-95" : "bg-primary hover:scale-105 active:scale-95",
                  (isBusy && status !== "recording" || !activeConnectionId) && "opacity-20 cursor-not-allowed grayscale"
                )}
              >
                {status === "recording" ? <Square className="w-7 h-7 text-white fill-white" /> : <Mic className="w-8 h-8 text-primary-foreground" />}
                
                {status === "recording" && (
                  <div className="absolute inset-0 -z-10">
                    <div className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-20" />
                    <div className="absolute inset-0 rounded-full bg-rose-400 animate-pulse opacity-40 scale-125" />
                  </div>
                )}
              </button>

              {showKeyboard && !isBusy && (
                <button
                  onClick={() => setMode("text")}
                  className="absolute -right-16 w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Keyboard className="w-5 h-5" />
                </button>
              )}
            </motion.div>
          ) : (
            <motion.form 
              key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onSubmit={handleTextSubmit} className="w-full flex items-center gap-4"
            >
              <input
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
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
