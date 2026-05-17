"use client"

import * as React from "react";
import { Database, Plus, Loader2, Link2, ShieldCheck, Globe } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const databaseSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  host: z.string().min(1, "Host is required"),
  port: z.string().min(1, "Port is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  db_name: z.string().min(1, "Database name is required"),
  db_type: z.enum(["mysql", "tdsql"]),
});

type DatabaseFormValues = z.infer<typeof databaseSchema>;

interface AddDatabaseDialogProps {
  isCollapsed?: boolean;
  onAddDatabase?: (db: {
    name: string;
    host: string;
    port: number;
    db_name: string;
    username: string;
    password?: string;
    db_type: string;
  }) => Promise<void>;
}

export function AddDatabaseDialog({ isCollapsed, onAddDatabase }: AddDatabaseDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<"success" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<DatabaseFormValues>({
    resolver: zodResolver(databaseSchema),
    defaultValues: {
      name: "",
      host: "",
      port: "3306",
      username: "",
      password: "",
      db_name: "",
      db_type: "mysql",
    },
  });

  const activeDbType = watch("db_type");

  const onSubmit = async (data: DatabaseFormValues) => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    
    try {
      await onAddDatabase?.({
        ...data,
        port: parseInt(data.port, 10),
      });
      setTestResult("success");
      setTimeout(() => {
        setOpen(false);
        reset();
        setTestResult(null);
      }, 1000);
    } catch (error) {
      setTestResult("error");
      const errMessage = error instanceof Error ? error.message : "Failed to establish uplink.";
      setErrorMessage(errMessage);
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestConnection = async () => {
    // Deprecated: validation is handled natively during submission.
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) {
        setTestResult(null);
        setErrorMessage(null);
      }
    }}>
      <DialogTrigger asChild>
        {isCollapsed ? (
          <Button 
            variant="outline" 
            size="icon"
            className="h-10 w-10 bg-card/30 border-dashed border-border hover:border-primary/50 shrink-0"
          >
            <Database className="w-4 h-4 text-muted-foreground" />
          </Button>
        ) : (
          <Button 
            variant="outline" 
            className="w-full justify-start gap-2 h-10 px-4 bg-card/30 border-dashed border-border hover:border-primary/50 transition-all font-mono text-[10px] uppercase tracking-wider"
          >
            <Plus className="w-3 h-3 text-muted-foreground" />
            Initialize New Source
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px] bg-card border-border shadow-2xl p-0 overflow-hidden">
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <DialogHeader className="p-6 pb-2">
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 rounded-lg bg-primary text-primary-foreground">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <DialogTitle className="font-mono uppercase tracking-wider text-sm">Register Data Source</DialogTitle>
                    <DialogDescription className="text-[10px] font-mono opacity-70 uppercase tracking-tighter mt-0.5">
                      Establish a secure tunnel to your registry
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="px-6 py-4 pt-0">
                  <Tabs defaultValue="connection" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 bg-muted p-1 mb-5">
                <TabsTrigger value="connection" className="font-mono text-[10px] uppercase py-1.5">Connection Settings</TabsTrigger>
                <TabsTrigger value="auth" className="font-mono text-[10px] uppercase py-1.5">Security & Auth</TabsTrigger>
              </TabsList>
              
              <TabsContent value="connection" className="space-y-4 mt-0 outline-none">
                <div className="grid gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Source Alias</Label>
                    <Input
                      id="name"
                      placeholder="PRODUCTION_CLUSTER"
                      className="bg-background border-border focus:border-primary focus:ring-1 focus:ring-primary/20 font-mono text-xs h-9"
                      {...register("name")}
                    />
                    {errors.name && <p className="text-[10px] text-destructive font-mono">{errors.name.message}</p>}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="host" className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Hostname / Vector IP</Label>
                      <Input
                        id="host"
                        placeholder="db.nexus.core"
                        className="bg-background border-border font-mono text-xs h-9"
                        {...register("host")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="port" className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Port</Label>
                      <Input
                        id="port"
                        placeholder="3306"
                        className="bg-background border-border font-mono text-xs h-9 text-center"
                        {...register("port")}
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="db_name" className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Initial Schema</Label>
                    <Input
                      id="db_name"
                      placeholder="main_registry"
                      className="bg-background border-border font-mono text-xs h-9"
                      {...register("db_name")}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Engine Type</Label>
                    <div className="flex gap-2">
                      {(["mysql", "tdsql"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setValue("db_type", t)}
                          className={cn(
                            "flex-1 h-8 rounded border font-mono text-[10px] uppercase transition-all",
                            activeDbType === t 
                              ? "bg-primary text-primary-foreground border-primary" 
                              : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="auth" className="space-y-4 mt-0 outline-none">
                <div className="grid gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="username" className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Username</Label>
                    <Input
                      id="username"
                      placeholder="admin_sys"
                      className="bg-background border-border font-mono text-xs h-9"
                      {...register("username")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••••••"
                      className="bg-background border-border font-mono text-xs h-9"
                      {...register("password")}
                    />
                  </div>
                  
                  <div className="p-3 rounded-lg bg-muted border border-border space-y-1.5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-3 h-3 text-primary" />
                      <span className="text-[9px] font-mono uppercase text-primary font-bold">Encrypted Tunnel</span>
                    </div>
                    <p className="text-[8px] font-mono text-muted-foreground leading-relaxed uppercase">
                      Connection data is hashed and stored in secure local enclave. No tokens are transmitted to external servers.
                    </p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="bg-muted px-6 py-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 max-w-[200px]">
                {testResult === "success" && (
                  <div className="flex items-center gap-1.5 text-emerald-600 animate-in fade-in slide-in-from-left-2">
                    <Globe className="w-3 h-3" />
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider">Uplink Stable</span>
                  </div>
                )}
                {testResult === "error" && (
                  <div className="flex flex-col animate-in fade-in slide-in-from-left-2">
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-destructive">Signal Lost</span>
                    {errorMessage && (
                      <span className="text-[8px] font-mono text-destructive/70 line-clamp-2 leading-tight" title={errorMessage}>
                        {errorMessage}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="sm:justify-end gap-2">
              <Button 
                type="button" 
                variant="ghost" 
                className="font-mono text-[10px] uppercase tracking-widest h-9 px-4"
                onClick={() => setOpen(false)}
              >
                Abort
              </Button>
              <Button 
                type="submit" 
                disabled={isTesting}
                className="bg-primary text-primary-foreground font-mono text-[10px] uppercase tracking-widest h-9 px-8 shadow-md"
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Finalize Sync"
                )}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </motion.div>
    )}
  </AnimatePresence>
</DialogContent>
    </Dialog>
  );
}
