"use client";

import * as React from "react";
import { Mic, Square, Loader2, Keyboard, Send, X } from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
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
  
  const isListeningRef = React.useRef(false);
  const isProcessingRef = React.useRef(false);
  const modeRef = React.useRef(mode);

  React.useEffect(() => {
    isListeningRef.current = isListening;
    isProcessingRef.current = isProcessing;
    modeRef.current = mode;
  }, [isListening, isProcessing, mode]);

  const startListening = React.useCallback(() => {
    if (isProcessingRef.current || isListeningRef.current) return;
    setIsListening(true);
  }, []);

  const stopListening = React.useCallback(() => {
    if (!isListeningRef.current) return;
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
        if (modeRef.current === "voice") startListening();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (modeRef.current === "voice") stopListening();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startListening, stopListening]);

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-6 z-50 w-full max-w-xl px-4">
      {/* 1. Status Layer - Fixed height to prevent vertical jumps */}
      <div className="h-12 flex items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {isProcessing ? (
            <motion.div 
              key="processing"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-4 h-10 px-6 rounded-full border border-border bg-card/50 backdrop-blur-xl shadow-lg"
            >
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
              <span className="text-[10px] font-mono text-primary font-bold uppercase tracking-widest">Decrypting Registry</span>
            </motion.div>
          ) : isListening ? (
            <motion.div 
              key="listening"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 h-10 px-6 rounded-full border border-border bg-card/50 backdrop-blur-xl shadow-lg"
            >
              <div className="flex items-center gap-1 h-4">
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ height: [4, 12, 6] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }}
                    className="w-1 bg-primary rounded-full"
                  />
                ))}
                <span className="ml-3 text-[10px] font-mono text-primary font-bold uppercase tracking-widest">Uplink Active</span>
              </div>
            </motion.div>
          ) : !isListening && !isProcessing && mode === "voice" ? (
            <motion.div 
              key="standby"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="px-5 py-1.5 rounded-full border border-border bg-card/20 backdrop-blur-md flex items-center gap-3"
            >
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Hold Space to Uplink</span>
              <kbd className="text-[8px] bg-accent px-1.5 py-0.5 rounded border border-border font-bold text-foreground">SPACE</kbd>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* 2. Primary Action Area - Controlled via LayoutGroup */}
      <LayoutGroup>
        <div className="relative flex items-center justify-center w-full h-20 overflow-visible">
          <AnimatePresence>
            {mode === "text" ? (
              <motion.form 
                key="text-form"
                layoutId="control-surface"
                onSubmit={handleTextSubmit}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, position: "absolute" }}
                className="relative flex items-center w-full"
              >
                <input
                  autoFocus
                  type="text"
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  placeholder="MANUAL VECTOR ENTRY..."
                  className="w-full h-16 pl-8 pr-24 rounded-2xl bg-card/80 border border-border backdrop-blur-xl text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-all font-mono text-sm shadow-2xl"
                />
                <div className="absolute right-3 flex items-center gap-2">
                  <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => setMode("voice")}>
                    <X className="w-5 h-5" />
                  </Button>
                  <Button type="submit" disabled={!textQuery.trim()} className="h-10 w-10 bg-primary text-primary-foreground">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </motion.form>
            ) : (
              <motion.div 
                key="voice-buttons"
                layout
                layoutId="control-surface"
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
                className="flex items-center justify-center gap-8 h-20 w-full"
              >
                <AnimatePresence mode="popLayout">
                  {showKeyboard && !isListening && !isProcessing && (
                    <motion.button
                      key="kb-btn"
                      layout
                      initial={{ x: 40, opacity: 0, scale: 0.5 }}
                      animate={{ x: 0, opacity: 1, scale: 1 }}
                      exit={{ x: 40, opacity: 0, scale: 0.5 }}
                      transition={{ type: "spring", stiffness: 400, damping: 35 }}
                      onClick={() => setMode("text")}
                      className="w-20 h-20 rounded-full border border-border bg-card/30 backdrop-blur-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-lg z-0"
                    >
                      <Keyboard className="w-8 h-8" />
                    </motion.button>
                  )}
                </AnimatePresence>

                <motion.button
                  key="mic-btn"
                  layout
                  transition={{ 
                    type: "spring", 
                    stiffness: 400, 
                    damping: 35
                  }}
                  whileHover={{ scale: 1.02 }}
                  onMouseDown={startListening}
                  onMouseUp={stopListening}
                  onMouseLeave={isListening ? stopListening : undefined}
                  disabled={isProcessing}
                  className={cn(
                    "relative flex items-center justify-center w-20 h-20 rounded-full shadow-2xl z-10 shrink-0 transition-colors duration-300",
                    isListening ? "bg-rose-600 shadow-rose-900/40" : "bg-primary hover:bg-primary/90 shadow-primary/10"
                  )}
                >
                  <div className="relative z-20">
                    {isListening ? <Square className="w-7 h-7 text-white fill-white" /> : <Mic className="w-8 h-8 text-primary-foreground" />}
                  </div>
                  
                  {isListening && (
                    <>
                      <div className="absolute inset-0 rounded-full bg-rose-500 animate-mic-pulse opacity-40 z-0" />
                      <div className="absolute inset-0 rounded-full bg-rose-400 animate-mic-pulse-delayed opacity-20 z-0" />
                    </>
                  )}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </div>
  );
}
