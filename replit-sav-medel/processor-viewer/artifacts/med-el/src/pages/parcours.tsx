import { useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Bluetooth, ChevronLeft, ChevronRight, Check, ScanSearch, Stethoscope, User } from "lucide-react";
import {
  AIDES, GAMMES, PROCESSEURS, PROFILS, departDiagnostic,
  type AideId, type ProcesseurId, type ProfilId,
} from "@/data/parcours";
import { Processeur3D } from "@/components/processeur-3d";

const ROUGE = "#E2001A";
const EASE = [0.22, 1, 0.36, 1] as const;

type Etape = "profil" | "processeur" | "aide";
const ETAPES: Etape[] = ["profil", "processeur", "aide"];

// ---------- motion ----------
const ecran: Variants = {
  entre: (dir: number) => ({ opacity: 0, x: dir * 60, filter: "blur(6px)" }),
  la: { opacity: 1, x: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE, staggerChildren: 0.07, delayChildren: 0.08 } },
  sort: (dir: number) => ({ opacity: 0, x: dir * -60, filter: "blur(6px)", transition: { duration: 0.3, ease: EASE } }),
};
const element: Variants = {
  entre: { opacity: 0, y: 22, scale: 0.98 },
  la: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE } },
};
const survol = { y: -3, boxShadow: "0 14px 40px rgba(178,0,21,.13)", borderColor: ROUGE };

// ---------- icônes des appareils ----------
function IconeSonnet({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 21c-1.7 0-2-1.5-2-3V9c0-3 .5-6 3.5-6S14 5 14 8v10c0 1.5-.5 3-2 3z" />
      <path d="M7 11h7" />
      <path d="M14 6c2 0 3.5 1 4.5 2.5" />
      <circle cx="19.5" cy="11" r="2.5" />
    </svg>
  );
}
function IconeRondo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="13" rx="9" ry="7" />
      <ellipse cx="12" cy="11.5" rx="6.5" ry="4.5" />
      <circle cx="12" cy="11.5" r="1.6" fill="currentColor" />
    </svg>
  );
}

function Titre({ avant, accent, apres = "" }: { avant: string; accent: string; apres?: string }) {
  return (
    <motion.h1 variants={element} className="text-[34px] md:text-[42px] leading-[1.05] font-extrabold tracking-tight text-stone-900">
      {avant} <span style={{ color: ROUGE }}>{accent}</span>
      {apres}
    </motion.h1>
  );
}

export default function ParcoursPage() {
  const [, naviguer] = useLocation();
  const [etape, setEtape] = useState<Etape>("profil");
  const [dir, setDir] = useState(1);
  const [profil, setProfil] = useState<ProfilId | null>(null);
  const [procId, setProcId] = useState<ProcesseurId | null>(null);
  const [aide, setAide] = useState<AideId | null>(null);

  const aller = (e: Etape) => {
    setDir(ETAPES.indexOf(e) >= ETAPES.indexOf(etape) ? 1 : -1);
    setEtape(e);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const retour = () => {
    setAide(null);
    aller(etape === "aide" ? "processeur" : "profil");
  };
  const p = profil ? PROFILS.find((x) => x.id === profil)! : null;
  const proc = procId ? PROCESSEURS[procId] : null;
  const depart = profil && procId ? departDiagnostic(profil, procId) : null;

  return (
    <div className="min-h-screen bg-background font-sans overflow-x-hidden">
      {/* halos d'ambiance */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(226,0,26,.16), transparent 65%)" }}
          animate={{ x: [0, -30, 0], y: [0, 40, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/3 -left-32 w-[380px] h-[380px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(45,127,249,.10), transparent 65%)" }}
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <header className="relative z-10 border-b border-border bg-white/80 backdrop-blur-sm sticky top-0">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <AnimatePresence initial={false}>
            {etape !== "profil" && (
              <motion.button
                key="retour"
                initial={{ opacity: 0, x: -10, width: 0 }}
                animate={{ opacity: 1, x: 0, width: 36 }}
                exit={{ opacity: 0, x: -10, width: 0 }}
                whileTap={{ scale: 0.9 }}
                onClick={retour}
                aria-label="Retour"
                className="h-9 rounded-lg border border-stone-200 bg-white flex items-center justify-center text-stone-600 hover:border-[#E2001A] hover:text-[#E2001A] shrink-0"
                data-testid="button-retour"
              >
                <ChevronLeft className="w-4 h-4" />
              </motion.button>
            )}
          </AnimatePresence>
          <span className="text-xl font-extrabold tracking-tight" style={{ color: ROUGE }}>MED·EL</span>
          <span className="text-stone-300 hidden sm:inline">|</span>
          <span className="text-sm text-stone-500 font-medium hidden sm:inline">Connect</span>
          <div className="ml-auto flex items-center gap-2">
            <AnimatePresence>
              {p && (
                <motion.span
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-100 border border-stone-200 text-xs font-semibold text-stone-600"
                >
                  {p.id === "utilisateur" ? <User className="w-3.5 h-3.5" /> : <Stethoscope className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{p.titre}</span>
                </motion.span>
              )}
              {proc && etape === "aide" && (
                <motion.span
                  key={proc.id}
                  layoutId={`proc-${proc.id}`}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold"
                  style={{ background: "#E2001A10", borderColor: "#E2001A40", color: ROUGE }}
                >
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: ROUGE }} />
                  {proc.nom}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        {/* progression */}
        <div className="max-w-5xl mx-auto px-4 pb-2.5 flex gap-1.5">
          {ETAPES.map((e, i) => (
            <div key={e} className="h-1 flex-1 rounded-full bg-stone-200 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: ROUGE }}
                initial={false}
                animate={{ width: ETAPES.indexOf(etape) >= i ? "100%" : "0%" }}
                transition={{ duration: 0.6, ease: EASE }}
              />
            </div>
          ))}
        </div>
      </header>

      <main className="relative z-[1] max-w-5xl mx-auto px-4 py-8 md:py-12">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          {/* ---------- 1. profil ---------- */}
          {etape === "profil" && (
            <motion.section key="profil" custom={dir} variants={ecran} initial="entre" animate="la" exit="sort" className="max-w-xl mx-auto">
              <motion.p variants={element} className="text-xs font-bold tracking-[.16em] uppercase mb-3" style={{ color: ROUGE }}>Bienvenue</motion.p>
              <Titre avant="Qui utilise" accent="l'application" apres=" ?" />
              <motion.p variants={element} className="mt-3 mb-8 text-stone-500 text-[16px] leading-relaxed">
                Choisissez votre profil : le parcours s'adapte à vos besoins.
              </motion.p>
              <div className="flex flex-col gap-4">
                {PROFILS.map((x, i) => {
                  const Icone = x.id === "utilisateur" ? User : Stethoscope;
                  return (
                    <motion.button
                      key={x.id}
                      variants={element}
                      whileHover={survol}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => { setProfil(x.id); aller("processeur"); }}
                      className="group flex items-center gap-5 text-left p-6 rounded-2xl border border-stone-200 bg-white shadow-sm"
                      data-testid={`profil-${x.id}`}
                    >
                      <motion.span
                        className="w-16 h-16 shrink-0 rounded-2xl flex items-center justify-center"
                        style={{ background: "#E2001A12", color: ROUGE }}
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
                      >
                        <Icone className="w-7 h-7" />
                      </motion.span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[19px] font-bold text-stone-900">{x.titre}</span>
                        <span className="block mt-1 text-sm text-stone-500 leading-snug">{x.sous}</span>
                      </span>
                      <ChevronRight className="w-5 h-5 text-stone-300 group-hover:text-[#E2001A] group-hover:translate-x-1 transition-transform" />
                    </motion.button>
                  );
                })}
              </div>
            </motion.section>
          )}

          {/* ---------- 2. processeur ---------- */}
          {etape === "processeur" && p && (
            <motion.section key="processeur" custom={dir} variants={ecran} initial="entre" animate="la" exit="sort" className="max-w-xl mx-auto">
              <motion.p variants={element} className="text-xs font-bold tracking-[.16em] uppercase mb-3" style={{ color: ROUGE }}>{p.espace}</motion.p>
              {p.id === "utilisateur"
                ? <Titre avant="Quel est votre" accent="processeur" apres=" ?" />
                : <Titre avant="Quel processeur" accent="équipe" apres=" le patient ?" />}
              <motion.p variants={element} className="mt-3 mb-6 text-stone-500 text-[16px] leading-relaxed">
                Sélectionnez le modèle pour accéder aux aides qui lui correspondent.
              </motion.p>
              {GAMMES.map((g) => (
                <div key={g.titre} className="mb-6">
                  <motion.div variants={element} className="flex items-center gap-3 mb-3 text-xs font-extrabold tracking-[.14em] uppercase text-stone-400">
                    {g.titre}
                    <span className="flex-1 h-px bg-stone-200" />
                  </motion.div>
                  <div className="grid gap-3">
                    {g.processeurs.map((id) => {
                      const x = PROCESSEURS[id];
                      const Icone = x.modele === "sonnet" ? IconeSonnet : IconeRondo;
                      return (
                        <motion.button
                          key={id}
                          variants={element}
                          whileHover={survol}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => { setProcId(id); aller("aide"); }}
                          className="group flex items-center gap-4 text-left p-4 rounded-2xl border border-stone-200 bg-white shadow-sm"
                          data-testid={`processeur-${id}`}
                        >
                          <motion.span
                            layoutId={`proc-${id}`}
                            className="w-12 h-12 shrink-0 rounded-xl flex items-center justify-center group-hover:rotate-[-8deg] transition-transform"
                            style={{ background: "#E2001A12", color: ROUGE }}
                          >
                            <Icone className="w-6 h-6" />
                          </motion.span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-base font-bold text-stone-900">{x.nom}</span>
                            <span className="block mt-0.5 text-[13px] text-stone-500">{x.sous}</span>
                          </span>
                          <ChevronRight className="w-5 h-5 text-stone-300 group-hover:text-[#E2001A] group-hover:translate-x-1 transition-transform" />
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </motion.section>
          )}

          {/* ---------- 3. type d'aide ---------- */}
          {etape === "aide" && p && proc && (
            <motion.section key="aide" custom={dir} variants={ecran} initial="entre" animate="la" exit="sort">
              <div className="grid md:grid-cols-[1.15fr_1fr] gap-x-10 gap-y-6 items-start">
                <div className="md:col-start-2 md:row-start-1">
                  <motion.p variants={element} className="text-xs font-bold tracking-[.16em] uppercase mb-3" style={{ color: ROUGE }}>
                    {proc.nom} · {p.titre}
                  </motion.p>
                  <Titre avant="De quelle" accent="aide" apres=" avez-vous besoin ?" />
                  <motion.p variants={element} className="mt-1 text-stone-500 text-[16px] leading-relaxed">
                    Faites tourner le {proc.nom} du bout du doigt, touchez une pièce pour la nommer, puis choisissez.
                  </motion.p>
                </div>

                <motion.div variants={element} className="md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-24">
                  <Processeur3D proc={proc} />
                  <p className="mt-2 text-[11px] text-stone-400 leading-snug">
                    Modèle 3D indicatif, reconstruit pour l'application. Il pourra être remplacé par les fichiers 3D officiels MED-EL.
                  </p>
                </motion.div>

                <div className="md:col-start-2 md:row-start-2">
                  <div className="flex flex-col gap-3">
                    {AIDES.map((a) => {
                      const Icone = a.id === "connectivite" ? Bluetooth : ScanSearch;
                      const choisi = aide === a.id;
                      return (
                        <motion.button
                          key={a.id}
                          variants={element}
                          whileHover={survol}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setAide(a.id)}
                          className="group relative flex items-center gap-4 text-left p-5 rounded-2xl border bg-white shadow-sm"
                          style={{ borderColor: choisi ? ROUGE : undefined, background: choisi ? "linear-gradient(160deg,#FFF,#FFF6F7)" : undefined }}
                          data-testid={`aide-${a.id}`}
                        >
                          <span className="w-12 h-12 shrink-0 rounded-xl flex items-center justify-center transition-colors"
                            style={{ background: choisi ? ROUGE : "#E2001A12", color: choisi ? "#fff" : ROUGE }}>
                            <Icone className="w-6 h-6" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-base font-bold text-stone-900">{a.titre}</span>
                            <span className="block mt-0.5 text-[13px] text-stone-500">{a.sous}</span>
                          </span>
                          <AnimatePresence mode="wait" initial={false}>
                            {choisi ? (
                              <motion.span key="ok" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}
                                transition={{ type: "spring", stiffness: 500, damping: 22 }}
                                className="w-7 h-7 rounded-full flex items-center justify-center text-white" style={{ background: ROUGE }}>
                                <Check className="w-4 h-4" />
                              </motion.span>
                            ) : (
                              <motion.span key="fl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <ChevronRight className="w-5 h-5 text-stone-300 group-hover:text-[#E2001A] transition-colors" />
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* récapitulatif du choix : le parcours s'arrête ici pour cette étape */}
                  <AnimatePresence>
                    {aide && (
                      <motion.div
                        key={aide}
                        initial={{ opacity: 0, y: 16, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: 16, height: 0 }}
                        transition={{ duration: 0.45, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600 leading-relaxed">
                          <p className="font-bold text-stone-900 mb-1">
                            {p.titre} · {proc.nom} · {AIDES.find((x) => x.id === aide)!.titre}
                          </p>
                          {aide === "diagnostic" && depart && (
                            <>
                              <p>Le diagnostic guidé existant prend le relais, avec ses questions et la mise en évidence des zones.</p>
                              <motion.button
                                whileHover={{ y: -2 }}
                                whileTap={{ scale: 0.97 }}
                                onClick={() => { window.scrollTo(0, 0); naviguer(`/diagnostic?depart=${depart}&profil=${profil}`); }}
                                className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-3 font-bold text-white"
                                style={{ background: ROUGE }}
                                data-testid="button-lancer-diagnostic"
                              >
                                Lancer le diagnostic guidé <ChevronRight className="w-4 h-4" />
                              </motion.button>
                            </>
                          )}
                          {aide === "diagnostic" && !depart && (
                            <p>Le diagnostic guidé du {proc.nom} reste à écrire : il sera ajouté à l'étape suivante.</p>
                          )}
                          {aide === "connectivite" && (
                            <p>Les guides de connexion adaptés au {proc.nom} arrivent à l'étape suivante.</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
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
