import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  AlertTriangle, Battery, Bluetooth, Check, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink,
  Headphones, Info, Magnet, Mic, Phone, Power, Radio, RotateCcw, Smartphone, Stethoscope, Tv, User, Volume2, Wrench,
} from "lucide-react";
import { PROCESSEURS, PROFILS, type ProcesseurId, type ProfilId } from "@/data/parcours";
import { GUIDES, type IconeGuide, type NoeudGuide } from "@/data/guides";
import { Processeur3D } from "@/components/processeur-3d";

const ROUGE = "#E2001A";
const EASE = [0.22, 1, 0.36, 1] as const;

const ICONES: Record<IconeGuide, typeof Bluetooth> = {
  Bluetooth, Smartphone, Tv, Phone, Headphones, Mic, Radio, Battery, Magnet, Power, Volume2, AlertTriangle, Wrench, Stethoscope,
};

const GRAVITE = {
  info: { label: "Conseil", fond: "#EEF4FF", bord: "#C9DAFB", texte: "#1F4FB0", Icone: Info },
  warning: { label: "À surveiller", fond: "#FFF7E8", bord: "#F6D9A6", texte: "#94600B", Icone: AlertTriangle },
  critical: { label: "Contactez votre centre", fond: "#FFF1F2", bord: "#F4C9CE", texte: "#B30015", Icone: AlertTriangle },
  success: { label: "C'est réglé", fond: "#EEFAF2", bord: "#BFE8CC", texte: "#17703A", Icone: CheckCircle2 },
} as const;

const ecran: Variants = {
  entre: (dir: number) => ({ opacity: 0, x: dir * 50, filter: "blur(6px)" }),
  la: { opacity: 1, x: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: EASE, staggerChildren: 0.06, delayChildren: 0.05 } },
  sort: (dir: number) => ({ opacity: 0, x: dir * -50, filter: "blur(6px)", transition: { duration: 0.28, ease: EASE } }),
};
const element: Variants = {
  entre: { opacity: 0, y: 18 },
  la: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

function lireUrl() {
  const q = new URLSearchParams(window.location.search);
  const proc = q.get("proc") as ProcesseurId | null;
  const profil = (q.get("profil") as ProfilId | null) ?? "utilisateur";
  const depart = q.get("depart");
  return {
    proc: proc && PROCESSEURS[proc] ? proc : null,
    profil: PROFILS.some((p) => p.id === profil) ? profil : "utilisateur",
    depart: depart && GUIDES[depart] ? depart : null,
  };
}

export default function GuidePage() {
  const [, naviguer] = useLocation();
  const { proc: procId, profil, depart } = useMemo(lireUrl, []);
  const [pile, setPile] = useState<string[]>(depart ? [depart] : []);
  const [dir, setDir] = useState(1);
  const [etape, setEtape] = useState(0);

  const id = pile[pile.length - 1];
  const noeud: NoeudGuide | undefined = id ? GUIDES[id] : undefined;
  const proc = procId ? PROCESSEURS[procId] : null;
  const p = PROFILS.find((x) => x.id === profil)!;

  useEffect(() => setEtape(0), [id]);

  if (!noeud || !proc) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-stone-500">Ce guide n'existe pas encore.</p>
          <button onClick={() => naviguer("/")} className="mt-4 text-sm font-semibold" style={{ color: ROUGE }}>Revenir à l'accueil</button>
        </div>
      </div>
    );
  }

  const aller = (vers: string) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (vers.startsWith("diagnostic:")) {
      naviguer(`/diagnostic?depart=${vers.slice(11)}&profil=${profil}`);
      return;
    }
    setDir(1);
    setPile((x) => [...x, vers]);
  };
  const retour = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (pile.length <= 1) { naviguer(`/?profil=${profil}&proc=${procId}`); return; }
    setDir(-1);
    setPile((x) => x.slice(0, -1));
  };
  const recommencer = () => { setDir(-1); setPile([pile[0]]); };

  const etapes = noeud.type === "fiche" ? noeud.etapes ?? [] : [];
  const piece = noeud.type === "fiche" ? etapes[etape]?.piece ?? noeud.piece ?? null : noeud.piece ?? null;
  // sur mobile, la 3D passe au-dessus quand une étape désigne une pièce, pour la voir s'allumer
  const pieceEnJeu = noeud.type === "fiche" && (!!noeud.piece || etapes.some((e) => e.piece));

  return (
    <div className="min-h-screen bg-background font-sans overflow-x-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(226,0,26,.14), transparent 65%)" }}
          animate={{ x: [0, -30, 0], y: [0, 40, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <header className="relative z-10 border-b border-border bg-white/80 backdrop-blur-sm sticky top-0">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={retour}
            aria-label="Retour"
            className="w-9 h-9 rounded-lg border border-stone-200 bg-white flex items-center justify-center text-stone-600 hover:border-[#E2001A] hover:text-[#E2001A] shrink-0"
            data-testid="button-retour"
          >
            <ChevronLeft className="w-4 h-4" />
          </motion.button>
          <span className="text-xl font-extrabold tracking-tight" style={{ color: ROUGE }}>MED·EL</span>
          <span className="text-stone-300 hidden sm:inline">|</span>
          <span className="text-sm text-stone-500 font-medium hidden sm:inline">{noeud.rubrique}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-100 border border-stone-200 text-xs font-semibold text-stone-600">
              {profil === "utilisateur" ? <User className="w-3.5 h-3.5" /> : <Stethoscope className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{p.titre}</span>
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold"
              style={{ background: "#E2001A10", borderColor: "#E2001A40", color: ROUGE }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: ROUGE }} />
              {proc.nom}
            </span>
          </div>
        </div>
        {/* fil d'Ariane du guide */}
        <div className="max-w-5xl mx-auto px-4 pb-2 flex items-center gap-1 overflow-x-auto">
          {pile.map((x, i) => (
            <motion.span key={x + i} layout initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-stone-300" />}
              <span className={`text-xs ${i === pile.length - 1 ? "text-stone-700 font-semibold" : "text-stone-400"}`}>{GUIDES[x]?.surtitre}</span>
            </motion.span>
          ))}
        </div>
      </header>

      <main className="relative z-[1] max-w-5xl mx-auto px-4 py-6 md:py-10">
        <div className="grid md:grid-cols-[1fr_1.1fr] gap-x-10 gap-y-5 items-start">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className={`md:sticky md:top-28 md:order-1 ${pieceEnJeu ? "order-1" : "order-2"}`}
          >
            <Processeur3D proc={proc} piece={piece} />
            <p className="mt-2 text-[11px] text-stone-400 leading-snug">
              La pièce concernée par l'étape s'allume sur le modèle. Modèle 3D indicatif.
            </p>
          </motion.div>

          <div className={`md:order-2 min-w-0 ${pieceEnJeu ? "order-2" : "order-1"}`}>
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.section key={id} custom={dir} variants={ecran} initial="entre" animate="la" exit="sort">
                <motion.p variants={element} className="text-xs font-bold tracking-[.16em] uppercase mb-2" style={{ color: ROUGE }}>
                  {noeud.surtitre}
                </motion.p>

                {noeud.type === "choix" && (
                  <>
                    <motion.h1 variants={element} className="text-[28px] md:text-[34px] leading-[1.1] font-extrabold tracking-tight text-stone-900">
                      {noeud.question}
                    </motion.h1>
                    {noeud.sous && <motion.p variants={element} className="mt-2 text-stone-500 leading-relaxed">{noeud.sous}</motion.p>}
                    <div className="mt-6 flex flex-col gap-3">
                      {noeud.options.map((o) => {
                        const Icone = o.icone ? ICONES[o.icone] : null;
                        return (
                          <motion.button
                            key={o.vers + o.label}
                            variants={element}
                            whileHover={{ y: -2, borderColor: ROUGE, boxShadow: "0 12px 32px rgba(178,0,21,.12)" }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => aller(o.vers)}
                            className="group flex items-center gap-4 text-left p-4 rounded-2xl border border-stone-200 bg-white shadow-sm"
                            data-testid={`option-${o.vers}`}
                          >
                            {Icone && (
                              <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center" style={{ background: "#E2001A12", color: ROUGE }}>
                                <Icone className="w-5 h-5" />
                              </span>
                            )}
                            <span className="flex-1 min-w-0">
                              <span className="block font-bold text-stone-900">{o.label}</span>
                              {o.hint && <span className="block mt-0.5 text-[13px] text-stone-500 leading-snug">{o.hint}</span>}
                            </span>
                            {o.vers.startsWith("diagnostic:")
                              ? <ExternalLink className="w-4 h-4 text-stone-300 group-hover:text-[#E2001A]" />
                              : <ChevronRight className="w-5 h-5 text-stone-300 group-hover:text-[#E2001A] group-hover:translate-x-1 transition-transform" />}
                          </motion.button>
                        );
                      })}
                    </div>
                  </>
                )}

                {noeud.type === "fiche" && (
                  <>
                    {noeud.gravite && (() => {
                      const g = GRAVITE[noeud.gravite];
                      return (
                        <motion.span variants={element} className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-full border text-xs font-bold"
                          style={{ background: g.fond, borderColor: g.bord, color: g.texte }}>
                          <g.Icone className="w-3.5 h-3.5" /> {g.label}
                        </motion.span>
                      );
                    })()}
                    <motion.h1 variants={element} className="text-[26px] md:text-[32px] leading-[1.12] font-extrabold tracking-tight text-stone-900">
                      {noeud.titre}
                    </motion.h1>
                    {noeud.resume && <motion.p variants={element} className="mt-2 text-stone-600 leading-relaxed">{noeud.resume}</motion.p>}

                    {etapes.length > 0 && (
                      <motion.ol variants={element} className="mt-5 flex flex-col gap-2" data-testid="etapes">
                        {etapes.map((e, i) => {
                          const faite = i < etape;
                          const active = i === etape;
                          return (
                            <motion.li
                              key={i}
                              layout
                              onClick={() => setEtape(i)}
                              className="relative flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors"
                              style={{
                                borderColor: active ? ROUGE : "#E7E5E4",
                                background: active ? "linear-gradient(160deg,#FFF,#FFF6F7)" : faite ? "#FAFAF9" : "#FFF",
                              }}
                            >
                              <motion.span
                                className="shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center"
                                animate={{ background: active || faite ? ROUGE : "#E2001A15", color: active || faite ? "#FFF" : ROUGE, scale: active ? 1.08 : 1 }}
                                transition={{ type: "spring", stiffness: 400, damping: 24 }}
                              >
                                {faite ? <Check className="w-3.5 h-3.5" /> : i + 1}
                              </motion.span>
                              <span className={`text-[15px] leading-snug pt-0.5 ${faite ? "text-stone-400" : "text-stone-800"} ${active ? "font-semibold" : ""}`}>
                                {e.texte}
                              </span>
                            </motion.li>
                          );
                        })}
                      </motion.ol>
                    )}

                    {etapes.length > 1 && (
                      <motion.div variants={element} className="mt-3 flex gap-2">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          disabled={etape === 0}
                          onClick={() => setEtape((x) => Math.max(0, x - 1))}
                          className="px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-sm font-bold text-stone-600 disabled:opacity-40"
                        >
                          Précédente
                        </motion.button>
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          disabled={etape >= etapes.length}
                          onClick={() => setEtape((x) => Math.min(etapes.length, x + 1))}
                          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                          style={{ background: ROUGE }}
                          data-testid="button-etape-suivante"
                        >
                          {etape >= etapes.length - 1 ? "J'ai terminé" : "Étape suivante"}
                        </motion.button>
                      </motion.div>
                    )}

                    {noeud.source && (
                      <motion.p variants={element} className="mt-4 text-[11px] text-stone-400 leading-snug">
                        Source : <a href={noeud.source} target="_blank" rel="noreferrer" className="underline hover:text-stone-600">{new URL(noeud.source).hostname.replace(/^www\./, "")}</a>
                        {noeud.verifier && " · à faire vérifier par MED-EL"}
                      </motion.p>
                    )}

                    {noeud.suites && noeud.suites.length > 0 && (
                      <motion.div variants={element} className="mt-6 pt-5 border-t border-stone-200 flex flex-col gap-2">
                        {noeud.suites.map((s) => (
                          <motion.button
                            key={s.vers}
                            whileHover={{ x: 3 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => aller(s.vers)}
                            className="group flex items-center gap-3 text-left px-4 py-3 rounded-xl border border-stone-200 bg-white hover:border-[#E2001A]"
                            data-testid={`suite-${s.vers}`}
                          >
                            <span className="flex-1 text-sm font-semibold text-stone-700 group-hover:text-[#B30015]">{s.label}</span>
                            <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-[#E2001A]" />
                          </motion.button>
                        ))}
                      </motion.div>
                    )}

                    {(noeud.gravite === "critical" || noeud.gravite === "warning") && (
                      <motion.a
                        variants={element}
                        href="tel:+33141068106"
                        className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-xl border text-sm font-semibold"
                        style={{ borderColor: "#E2001A40", color: ROUGE, background: "#E2001A08" }}
                      >
                        <Phone className="w-4 h-4" /> Contacter MED-EL : 01 41 06 81 06
                      </motion.a>
                    )}
                  </>
                )}

                {pile.length > 1 && (
                  <motion.button variants={element} onClick={recommencer}
                    className="mt-6 flex items-center gap-1.5 text-sm font-medium text-stone-400 hover:text-stone-600">
                    <RotateCcw className="w-3.5 h-3.5" /> Revenir au début du guide
                  </motion.button>
                )}
              </motion.section>
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="relative z-[1] border-t border-stone-100 mt-8 py-4 px-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <p className="text-xs text-stone-400">Outil d'aide indicatif — ne remplace pas l'avis d'un professionnel de santé</p>
          <p className="text-xs font-bold" style={{ color: "#E2001A80" }}>MED·EL</p>
        </div>
      </footer>
    </div>
  );
}
