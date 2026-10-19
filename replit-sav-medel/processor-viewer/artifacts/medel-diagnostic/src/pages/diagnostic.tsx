import { useState, useCallback } from "react";
import { TREE, TreeNode } from "@/data/tree";
import { Rondo3Viewer } from "@/components/rondo3-viewer";
import { SonnetViewer } from "@/components/sonnet-viewer";
import {
  Cpu, Headphones, Battery, AlertTriangle, Volume2, Radio, Bluetooth,
  Power, Clock, Mic, Stethoscope, User, ChevronLeft, RotateCcw, Phone,
  CheckCircle2, Info, TriangleAlert, ChevronRight, Magnet,
} from "lucide-react";

const iconMap = {
  Cpu, Headphones, Battery, AlertTriangle, Volume2, Radio, Bluetooth,
  Power, Clock, Mic, Stethoscope, User, Magnet: Magnet,
  Phone, CheckCircle2,
};

type Profile = "patient" | "pro" | null;

interface AppState {
  currentNodeId: string;
  history: string[];
  profile: Profile;
  device: "rondo3" | "sonnet" | null;
}

const INITIAL_STATE: AppState = {
  currentNodeId: "start",
  history: [],
  profile: null,
  device: null,
};

function deriveDevice(node: TreeNode): "rondo3" | "sonnet" | null {
  return node.device ?? null;
}

function SeverityIcon({ severity }: { severity?: string }) {
  if (severity === "critical") return <AlertTriangle className="w-4 h-4 text-red-600" />;
  if (severity === "warning") return <TriangleAlert className="w-4 h-4 text-amber-600" />;
  return <Info className="w-4 h-4 text-blue-600" />;
}

function SeverityBadge({ severity }: { severity?: string }) {
  const map = {
    critical: { label: "Urgence", cls: "bg-red-50 text-red-700 border-red-200" },
    warning: { label: "Attention requise", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    info: { label: "Information", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    success: { label: "Résolu", cls: "bg-green-50 text-green-700 border-green-200" },
  };
  const s = map[severity as keyof typeof map] ?? map.info;
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${s.cls}`}>
      <SeverityIcon severity={severity} />
      {s.label}
    </div>
  );
}

function DevicePlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
      <div className="flex gap-8 items-end justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full bg-stone-200/70 flex items-center justify-center">
            <Cpu className="w-7 h-7 text-stone-400" />
          </div>
          <span className="text-xs text-stone-400 font-medium">Rondo 3</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-20 rounded-2xl bg-stone-200/70 flex items-center justify-center">
            <Headphones className="w-6 h-6 text-stone-400" />
          </div>
          <span className="text-xs text-stone-400 font-medium">Sonnet</span>
        </div>
      </div>
      <p className="text-sm text-stone-400 max-w-52 leading-relaxed">
        Sélectionnez un processeur pour afficher la vue 3D interactive
      </p>
    </div>
  );
}

export default function DiagnosticPage() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);

  const node = TREE[state.currentNodeId];
  const device = node ? deriveDevice(node) : state.device;
  const highlights = node?.highlights ?? [];

  const navigateTo = useCallback((nextId: string) => {
    setState((prev) => {
      const nextNode = TREE[nextId];
      const newDevice = nextNode?.device ?? prev.device;
      let newProfile = prev.profile;
      if (prev.currentNodeId === "start") {
        if (nextId === "device_patient") newProfile = "patient";
        if (nextId === "device_pro") newProfile = "pro";
      }
      return {
        currentNodeId: nextId,
        history: [...prev.history, prev.currentNodeId],
        profile: newProfile,
        device: newDevice,
      };
    });
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.history.length === 0) return prev;
      const history = [...prev.history];
      const prevId = history.pop()!;
      const prevNode = TREE[prevId];
      const newDevice = prevNode?.device ?? null;
      const newProfile = history.length === 0 ? null : prev.profile;
      return { currentNodeId: prevId, history, profile: newProfile, device: newDevice };
    });
  }, []);

  const restart = useCallback(() => { setState(INITIAL_STATE); }, []);

  if (!node) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-500">Nœud introuvable : {state.currentNodeId}</p>
          <button onClick={restart} className="mt-4 text-sm text-red-600 underline">Recommencer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-extrabold tracking-tight" style={{ color: "#E2001A" }}>MED·EL</span>
            <span className="text-stone-300">|</span>
            <span className="text-sm text-stone-500 font-medium">Diagnostic processeur</span>
          </div>
          <div className="flex items-center gap-3">
            {state.profile && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-100 border border-stone-200">
                {state.profile === "patient" ? (
                  <User className="w-3.5 h-3.5 text-stone-500" />
                ) : (
                  <Stethoscope className="w-3.5 h-3.5 text-stone-500" />
                )}
                <span className="text-xs font-semibold text-stone-600">
                  {state.profile === "patient" ? "Patient" : "Professionnel"}
                </span>
              </div>
            )}
            {state.device && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border"
                style={{ background: "#E2001A10", borderColor: "#E2001A40" }}>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#E2001A" }} />
                <span className="text-xs font-semibold" style={{ color: "#E2001A" }}>
                  {state.device === "rondo3" ? "Rondo 3" : "Sonnet"}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Progress breadcrumb */}
      {state.history.length > 0 && (
        <div className="bg-stone-50 border-b border-stone-100 px-4 py-1.5">
          <div className="max-w-6xl mx-auto flex items-center gap-1 overflow-x-auto">
            {[...state.history, state.currentNodeId].map((id, i) => {
              const n = TREE[id];
              return (
                <span key={id} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <ChevronRight className="w-3 h-3 text-stone-300" />}
                  <span className={`text-xs ${i === state.history.length ? "text-stone-700 font-semibold" : "text-stone-400"}`}>
                    {n?.eyebrow ?? id}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Main layout */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row gap-6">
          {/* LEFT: Question / Diagnosis Panel */}
          <div className="md:w-[45%] flex flex-col">
            <div className="bg-white rounded-xl border border-stone-200 shadow-sm flex flex-col flex-1 overflow-hidden">
              {/* Eyebrow */}
              {node.eyebrow && (
                <div className="px-5 pt-5 pb-0">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">
                    {node.eyebrow}
                  </span>
                </div>
              )}

              {node.type === "choice" && (
                <div className="p-5 flex flex-col gap-4 flex-1">
                  <div>
                    <h2 className="text-lg font-bold text-stone-900 leading-snug">
                      {node.question}
                    </h2>
                    {node.sub && (
                      <p className="mt-2 text-sm text-stone-500 leading-relaxed">{node.sub}</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {node.options?.map((opt, i) => {
                      const Icon = opt.icon ? (iconMap[opt.icon as keyof typeof iconMap] ?? null) : null;
                      return (
                        <button
                          key={i}
                          data-testid={`button-option-${i}`}
                          onClick={() => navigateTo(opt.next)}
                          className="group flex items-center gap-3 text-left px-4 py-3 rounded-lg border border-stone-200 bg-white hover:border-red-500 hover:bg-red-50/40 transition-all duration-150"
                        >
                          {Icon && (
                            <div className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-stone-100 group-hover:bg-red-100 transition-colors">
                              <Icon className="w-4 h-4 text-stone-500 group-hover:text-red-600" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-stone-800 group-hover:text-red-700 transition-colors">
                              {opt.label}
                            </p>
                            {opt.hint && (
                              <p className="text-xs text-stone-400 mt-0.5">{opt.hint}</p>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-red-400 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {node.type === "diagnosis" && (
                <div className="p-5 flex flex-col gap-4 flex-1">
                  <div className="flex flex-col gap-3">
                    <SeverityBadge severity={node.severity} />
                    <h2 className="text-xl font-bold text-stone-900 leading-tight">
                      {node.title}
                    </h2>
                    <p className="text-sm text-stone-600 leading-relaxed">{node.summary}</p>
                  </div>

                  {node.actions && node.actions.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-stone-400">
                        Marche à suivre
                      </p>
                      <ol className="flex flex-col gap-2">
                        {node.actions.map((action, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center"
                              style={{ background: "#E2001A15", color: "#E2001A" }}>
                              {i + 1}
                            </span>
                            <span className="text-sm text-stone-700 leading-snug">{action}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div className="mt-auto pt-2 flex flex-col gap-2">
                    <a
                      href="tel:+33141068106"
                      data-testid="button-contact-medel"
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border text-sm font-semibold transition-all"
                      style={{ borderColor: "#E2001A40", color: "#E2001A", background: "#E2001A08" }}
                    >
                      <Phone className="w-4 h-4" />
                      Contacter MED-EL — 01 41 06 81 06
                    </a>
                  </div>
                </div>
              )}

              {/* Back / Restart buttons */}
              <div className="px-5 pb-5 flex items-center gap-3 border-t border-stone-100 pt-4">
                {state.history.length > 0 && (
                  <button
                    data-testid="button-back"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-700 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Retour
                  </button>
                )}
                <button
                  data-testid="button-restart"
                  onClick={restart}
                  className="flex items-center gap-1.5 text-sm font-medium text-stone-400 hover:text-stone-600 transition-colors ml-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Recommencer
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: 3D Viewer Panel */}
          <div className="md:w-[55%]">
            <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 h-full">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] uppercase tracking-widest font-bold text-stone-400">
                  Vue 3D interactive
                </p>
                {device && (
                  <div className="flex items-center gap-1.5 text-[10px] text-stone-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                    Glisser pour faire pivoter
                  </div>
                )}
              </div>

              {!device && <DevicePlaceholder />}
              {device === "rondo3" && <Rondo3Viewer highlights={highlights} />}
              {device === "sonnet" && <SonnetViewer highlights={highlights} />}

              {highlights.length > 0 && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">Zone mise en évidence</span>
                    {highlights.map((h) => (
                      <span key={h} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: "#E2001A12", color: "#E2001A" }}>
                        <span className="w-1 h-1 rounded-full" style={{ background: "#E2001A" }} />
                        {h.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-100 mt-8 py-4 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <p className="text-xs text-stone-400">
            Outil de diagnostic indicatif — ne remplace pas l'avis d'un professionnel de santé
          </p>
          <p className="text-xs text-stone-400 font-bold" style={{ color: "#E2001A80" }}>MED·EL</p>
        </div>
      </footer>
    </div>
  );
}
