"use client";

import * as React from "react";
import { Mic, Square, Loader2, Keyboard, Send, X, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { apiService } from "@/lib/api-service";
import { type QueryResult } from "@/app/page";

interface TRTCClient {
  on: (event: string, callback: (event: { data: ArrayBuffer }) => void) => void;
  enterRoom: (options: { sdkAppId: number; userId: string; userSig: string; roomId: number }) => Promise<void>;
  startLocalAudio: () => Promise<void>;
  stopLocalAudio: () => Promise<void>;
  exitRoom: () => Promise<void>;
}

interface TRTCModule {
  create: () => TRTCClient;
  EVENT: {
    CUSTOM_MESSAGE: string;
  };
}

interface VoiceControlsProps {
  onQueryComplete?: (result: QueryResult) => void;
  showKeyboard?: boolean;
  activeConnectionId?: string;
}

export function VoiceControls({ onQueryComplete, showKeyboard = false, activeConnectionId }: VoiceControlsProps) {
  const [isListening, setIsListening] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [mode, setMode] = React.useState<"voice" | "text">("voice");
  const [textQuery, setTextQuery] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const [trtcModule, setTrtcModule] = React.useState<TRTCModule | null>(null);
  const trtcRef = React.useRef<TRTCClient | null>(null);
  const taskIdRef = React.useRef<string | null>(null);
  const lastTranscriptRef = React.useRef<string | null>(null);

  // Dynamic import of TRTC to prevent SSR errors
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const loadTRTC = async () => {
        console.log("[Uplink] Fetching TRTC SDK...");
        try {
          const sdk = await import("trtc-sdk-v5");
          setTrtcModule(() => sdk.default as unknown as TRTCModule);
          console.log("[Uplink] TRTC SDK Online.");
        } catch (err) {
          console.error("[Uplink] TRTC SDK Load Failed:", err);
        }
      };
      loadTRTC();
    }
  }, []);

  const activeInteractionRef = React.useRef<"keyboard" | "mouse" | null>(null);
  const isInitializingRef = React.useRef(false);
  const isStoppingRef = React.useRef(false);
  const isProcessingRef = React.useRef(false);
  const modeRef = React.useRef(mode);

  React.useEffect(() => {
    isProcessingRef.current = isProcessing;
    modeRef.current = mode;
  }, [isProcessing, mode]);

  const handleAsk = React.useCallback(async (question: string) => {
    console.log(`[Uplink] handleAsk called with: "${question}"`);
    if (!activeConnectionId) {
      console.warn("[Uplink] handleAsk aborted: no activeConnectionId");
      return;
    }
    setIsProcessing(true);
    try {
      console.log("[Uplink] Calling apiService.ask...");
      const response = await apiService.ask(activeConnectionId, question);
      console.log("[Uplink] API response:", response);
      // Transform backend response to match QueryResult interface
      const result: QueryResult = {
        id: `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        connection_id: activeConnectionId,
        text: response.text || question,
        answer: response.answer || undefined,
        sql: response.sql || null,
        created_at: new Date().toISOString(),
        data: response.data || [],
        stats: response.stats || [],
      };
      console.log("[Uplink] Transformed result:", result);
      console.log("[Uplink] Calling onQueryComplete, exists:", !!onQueryComplete);
      onQueryComplete?.(result);
      console.log("[Uplink] onQueryComplete called successfully");
    } catch (error) {
      console.error("[Uplink] Query Failed:", error);
      setErrorMessage("Query Failed");
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setIsProcessing(false);
      setTextQuery("");
      setMode("voice");
    }
  }, [activeConnectionId, onQueryComplete]);

  const handleAskRef = React.useRef(handleAsk);
  React.useEffect(() => {
    handleAskRef.current = handleAsk;
  }, [handleAsk]);

  const stopListening = React.useCallback(async (source: "keyboard" | "mouse") => {
    console.log(`[Uplink] stopListening called from ${source}, activeInteraction: ${activeInteractionRef.current}, isStopping: ${isStoppingRef.current}`);
    if (activeInteractionRef.current !== source || isStoppingRef.current) {
      console.log("[Uplink] stopListening aborted (guard condition)");
      return;
    }

    isStoppingRef.current = true;
    console.log(`[Uplink] Stopping from ${source}...`);

    // Wait a moment for any final transcript messages to arrive
    console.log("[Uplink] Waiting 500ms for final transcripts...");
    await new Promise(resolve => setTimeout(resolve, 500));

    // Capture the last transcript before cleanup
    const pendingTranscript = lastTranscriptRef.current;
    console.log(`[Uplink] Captured pendingTranscript: "${pendingTranscript}"`);
    lastTranscriptRef.current = null;

    try {
      if (taskIdRef.current) {
        await apiService.stopTranscription(taskIdRef.current).catch(() => {});
        taskIdRef.current = null;
      }
      if (trtcRef.current) {
        await trtcRef.current.stopLocalAudio().catch(() => {});
        await trtcRef.current.exitRoom().catch(() => {});
        trtcRef.current = null;
      }

      // If we have a pending partial transcript, submit it
      if (pendingTranscript) {
        console.log(`[Uplink] Submitting partial transcript: "${pendingTranscript}"`);
        handleAskRef.current(pendingTranscript);
      }
    } catch (error) {
      console.error("[Uplink] Stop Error:", error);
    } finally {
      activeInteractionRef.current = null;
      isStoppingRef.current = false;
      setIsListening(false);
    }
  }, []);

  const startListening = React.useCallback(async (source: "keyboard" | "mouse") => {
    console.log(`[Uplink] Start from ${source}. Connection: ${activeConnectionId}`);

    if (isProcessingRef.current || activeInteractionRef.current || isInitializingRef.current) {
      console.warn("[Uplink] Blocked: busy");
      return;
    }

    if (!activeConnectionId) {
      console.error("[Uplink] No connection ID");
      return;
    }

    isInitializingRef.current = true;
    lastTranscriptRef.current = null; // Clear any previous transcript
    try {
      activeInteractionRef.current = source;
      setIsListening(true);

      if (!trtcModule) {
        throw new Error("TRTC SDK not initialized");
      }

      if (!trtcRef.current) {
        console.log("[Uplink] Creating TRTC client...");
        trtcRef.current = trtcModule.create();
        trtcRef.current.on(trtcModule.EVENT.CUSTOM_MESSAGE, (event: { data: ArrayBuffer }) => {
          try {
            const decoded = new TextDecoder().decode(event.data);
            console.log("[Uplink] Message:", decoded);
            const msg = JSON.parse(decoded);
            if (msg.type === 10000 && msg.payload?.text) {
              // Save every partial transcript
              lastTranscriptRef.current = msg.payload.text;
              console.log(`[Uplink] Partial: "${msg.payload.text}" (end: ${msg.payload.end})`);

              // If ASR signals end of sentence, submit immediately
              if (msg.payload.end === true) {
                console.log(`[Uplink] Final transcript: "${msg.payload.text}"`);
                lastTranscriptRef.current = null; // Clear so stopListening doesn't double-submit
                handleAskRef.current(msg.payload.text);
              }
            }
          } catch (e) {
            console.warn("[Uplink] Parse error:", e);
          }
        });
      }

      console.log("[Uplink] Getting UserSig...");
      const response = await apiService.getTRTCUserSig();
      const { user_sig, sdk_app_id, user_id } = response;
      const sdkAppId = Number(sdk_app_id);

      if (!sdkAppId || sdkAppId === 0) {
        throw new Error(`Invalid sdk_app_id: ${sdk_app_id}`);
      }

      const roomId = Math.floor(Math.random() * 1_000_000_000);

      console.log(`[Uplink] Entering room ${roomId} as ${user_id}...`);
      await trtcRef.current.enterRoom({ sdkAppId, userId: user_id, userSig: user_sig, roomId });

      console.log("[Uplink] Starting audio...");
      await trtcRef.current.startLocalAudio();

      console.log("[Uplink] Starting transcription...");
      const { task_id } = await apiService.startTranscription(roomId);
      taskIdRef.current = task_id;
      console.log("[Uplink] Ready.");

    } catch (error) {
      console.error("[Uplink] Error:", error);
      setErrorMessage("Voice Error");
      setTimeout(() => setErrorMessage(null), 3000);

      if (taskIdRef.current) {
        apiService.stopTranscription(taskIdRef.current).catch(() => {});
        taskIdRef.current = null;
      }
      if (trtcRef.current) {
        trtcRef.current.stopLocalAudio().catch(() => {});
        trtcRef.current.exitRoom().catch(() => {});
        trtcRef.current = null;
      }
      activeInteractionRef.current = null;
      setIsListening(false);
    } finally {
      isInitializingRef.current = false;
    }
  }, [activeConnectionId, trtcModule]);

  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!textQuery.trim() || isProcessing) return;
    handleAsk(textQuery);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space" && modeRef.current === "voice") {
        e.preventDefault();
        startListening("keyboard");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && modeRef.current === "voice") {
        stopListening("keyboard");
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
  const isBusy = isListening || isProcessing;

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50 flex flex-col items-center gap-6">

      {/* Status Banner */}
      <div className="h-10">
        <AnimatePresence mode="wait">
          {(isBusy || errorMessage) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              className={cn(
                "px-4 py-1.5 rounded-lg border backdrop-blur-xl shadow-lg flex items-center gap-3",
                errorMessage ? "bg-destructive/10 border-destructive/20" : "bg-card/50 border-border"
              )}
            >
              {isProcessing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 text-primary animate-spin" />
                  <span className="text-[10px] font-mono text-primary uppercase font-bold tracking-wider">Processing</span>
                </div>
              ) : isListening ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 h-3">
                    {[...Array(4)].map((_, i) => (
                      <motion.div key={i} animate={{ height: [4, 12, 4] }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }} className="w-0.5 bg-rose-500 rounded-full" />
                    ))}
                  </div>
                  <span className="text-[10px] font-mono text-rose-500 uppercase font-bold tracking-wider">Listening</span>
                </div>
              ) : errorMessage ? (
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-3 h-3" />
                  <span className="text-[10px] font-mono uppercase font-bold tracking-wider">{errorMessage}</span>
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input Surface */}
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
                onMouseDown={() => startListening("mouse")}
                onMouseUp={() => stopListening("mouse")}
                onMouseLeave={() => stopListening("mouse")}
                disabled={isProcessing || !activeConnectionId}
                className={cn(
                  "relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200",
                  isListening ? "bg-rose-600 scale-95" : "bg-primary hover:scale-105 active:scale-95",
                  (isProcessing || !activeConnectionId) && "opacity-20 cursor-not-allowed grayscale"
                )}
              >
                {isListening ? <Square className="w-7 h-7 text-white fill-white" /> : <Mic className="w-8 h-8 text-primary-foreground" />}

                {isListening && (
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
                <Button type="submit" disabled={!textQuery.trim() || isProcessing} className="h-10 w-10 bg-primary rounded-xl">
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
