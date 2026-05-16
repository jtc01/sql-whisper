"use client";

import * as React from "react";
import { Mic, Square, Loader2, Keyboard, Send, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface VoiceControlsProps {
  onQueryComplete?: () => void;
  showKeyboard?: boolean;
}

export function VoiceControls({ onQueryComplete, showKeyboard = false }: VoiceControlsProps) {
  const [isListening, setIsListening] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [mode, setMode] = React.useState<"voice" | "text">("voice");
  const [textQuery, setTextQuery] = React.useState("");
  
  const activeInteractionRef = React.useRef<"keyboard" | "mouse" | null>(null);
  const isProcessingRef = React.useRef(false);
  const modeRef = React.useRef(mode);

  React.useEffect(() => {
    isProcessingRef.current = isProcessing;
    modeRef.current = mode;
  }, [isProcessing, mode]);

  const startListening = React.useCallback((source: "keyboard" | "mouse") => {
    if (isProcessingRef.current || activeInteractionRef.current) return;
    activeInteractionRef.current = source;
    setIsListening(true);
  }, []);

  const stopListening = React.useCallback((source: "keyboard" | "mouse") => {
    if (activeInteractionRef.current !== source) return;
    activeInteractionRef.current = null;
    setIsListening(false);
    setIsProcessing(true);
    
    setTimeout(() => {
      setIsProcessing(false);
      onQueryComplete?.();
    }, 2000);
  }, [onQueryComplete]);

  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!textQuery.trim() || isProcessing) return;
    
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setTextQuery("");
      setMode("voice");
      onQueryComplete?.();
    }, 1500);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (modeRef.current === "voice") startListening("keyboard");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (modeRef.current === "voice") stopListening("keyboard");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startListening, stopListening]);

  const spring = { type: "spring" as const, stiffness: 450, damping: 40, mass: 1 };

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50 flex flex-col items-center gap-6">
      {/* 1. Boxed Status Telemetry */}
      <div className="h-10 flex items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {(isListening || isProcessing || mode === "voice") && (
            <motion.div 
              key="status-box"
              initial={{ opacity: 0, scale: 0.95, y: 5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 5 }}
              className="px-4 py-1.5 rounded-lg border border-border bg-card/50 backdrop-blur-xl shadow-lg flex items-center gap-3 min-w-[180px] justify-center"
            >
              <AnimatePresence mode="wait">
                {isProcessing ? (
                  <motion.div key="p" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Loader2 className="w-3 h-3 text-primary animate-spin" />
                    <span className="text-[10px] font-mono text-primary font-bold uppercase tracking-wider">Processing</span>
                  </motion.div>
                ) : isListening ? (
                  <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                    <div className="flex items-center gap-0.5 h-3 mx-0.5">
                      {[...Array(4)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ height: [4, 10, 4] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                          className="w-0.5 bg-rose-500/50 rounded-full"
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-mono text-rose-500 font-bold uppercase tracking-wider">Uplink Active</span>
                  </motion.div>
                ) : (
                  <motion.div key="s" initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Ready to Uplink</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2. Atomic Command Surface */}
      <motion.div
        layout
        transition={spring}
        className={cn(
          "relative flex items-center justify-center overflow-hidden !transition-none",
          mode === "text" 
            ? "w-full h-16 rounded-2xl bg-card border border-border shadow-2xl" 
            : "w-auto h-24 rounded-full bg-card/20 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] px-2"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {mode === "voice" ? (
            <motion.div 
              key="v-ui"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
              className="flex items-center gap-4 px-2"
            >
              <AnimatePresence mode="popLayout">
                {showKeyboard && !isListening && !isProcessing && (
                  <motion.button
                    layout
                    key="kb"
                    initial={{ opacity: 0, scale: 0, x: 20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0, x: 40 }}
                    transition={spring}
                    onClick={() => setMode("text")}
                    className="w-20 h-20 rounded-full border border-border bg-card/50 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 !transition-none"
                  >
                    <Keyboard className="w-8 h-8" />
                  </motion.button>
                )}
              </AnimatePresence>

              <motion.button
                layout
                onMouseDown={() => startListening("mouse")}
                onMouseUp={() => stopListening("mouse")}
                onMouseLeave={() => stopListening("mouse")}
                disabled={isProcessing}
                transition={spring}
                className={cn(
                  "relative flex items-center justify-center w-20 h-20 rounded-full shrink-0 overflow-hidden !transition-none",
                  isListening ? "bg-rose-600 shadow-inner" : "bg-primary"
                )}
              >
                <div className="relative z-20">
                  <AnimatePresence mode="wait">
                    {isListening ? (
                      <motion.div key="sq" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.1 }}>
                        <Square className="w-7 h-7 text-white fill-white" />
                      </motion.div>
                    ) : (
                      <motion.div key="mi" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.1 }}>
                        <Mic className="w-8 h-8 text-primary-foreground" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                {isListening && (
                  <div className="absolute inset-0 z-0">
                    <div className="absolute inset-0 rounded-full bg-rose-500 animate-mic-pulse opacity-40" />
                    <div className="absolute inset-0 rounded-full bg-rose-400 animate-mic-pulse-delayed opacity-20" />
                  </div>
                )}
              </motion.button>
            </motion.div>
          ) : (
            <motion.form 
              key="t-ui"
              onSubmit={handleTextSubmit}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0, transition: { delay: 0.15 } }}
              exit={{ opacity: 0, x: 10, transition: { duration: 0.1 } }}
              className="flex-1 flex items-center h-full px-4 gap-4 !transition-none"
            >
              <input
                autoFocus
                type="text"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="MANUAL VECTOR ENTRY..."
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-mono text-sm uppercase tracking-tight"
              />
              <div className="flex items-center gap-2 shrink-0">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="icon" 
                  className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-xl" 
                  onClick={() => setMode("voice")}
                >
                  <X className="w-5 h-5" />
                </Button>
                <Button 
                  type="submit" 
                  disabled={!textQuery.trim()} 
                  className="h-10 w-10 bg-primary text-primary-foreground shadow-lg rounded-xl"
                >
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
