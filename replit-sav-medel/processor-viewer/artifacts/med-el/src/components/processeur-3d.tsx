import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Hand, RotateCcw } from "lucide-react";
import type { Processeur } from "@/data/parcours";
import type { NomVue, Vue3D } from "@/lib/vue3d";

const VUES: { nom: NomVue; label: string }[] = [
  { nom: "face", label: "Face" },
  { nom: "profil", label: "Profil" },
  { nom: "dessus", label: "Dessus" },
  { nom: "dos", label: "Dos" },
];

export function Processeur3D({ proc, piece: aMontrer = null, className = "" }: { proc: Processeur; piece?: string | null; className?: string }) {
  const zone = useRef<HTMLDivElement>(null);
  const vue = useRef<Vue3D | null>(null);
  const [piece, setPiece] = useState<string | null>(null);
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let annule = false;
    setPret(false);
    setPiece(null);
    // three.js n'est chargé qu'au moment d'afficher la vue 3D
    import("@/lib/vue3d")
      .then(({ creerVue3D }) => {
        if (annule || !zone.current) return;
        vue.current = creerVue3D(zone.current, proc, setPiece);
        setPret(true);
      })
      .catch(() => setErreur(true));
    return () => {
      annule = true;
      vue.current?.detruire();
      vue.current = null;
    };
  }, [proc]);

  // pièce désignée par l'étape en cours du guide
  useEffect(() => {
    if (pret) vue.current?.montrer(aMontrer);
  }, [pret, aMontrer]);

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
      <div
        ref={zone}
        className="relative h-[300px] md:h-[400px] cursor-grab data-[saisi]:cursor-grabbing select-none"
        style={{ background: "radial-gradient(120% 90% at 50% 12%, #FFFFFF 0%, #F7F2F1 55%, #ECE4E3 100%)" }}
        data-testid="vue-3d"
      >
        {!pret && !erreur && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="w-8 h-8 rounded-full border-[3px] border-stone-200 border-t-[#E2001A] animate-spin" />
          </div>
        )}
        {erreur && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-stone-500">
            La vue 3D n'a pas pu se charger sur cet appareil.
          </div>
        )}
        <AnimatePresence>
          {pret && !piece && (
            <motion.div
              key="aide"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 1.4 } }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap flex items-center gap-2 rounded-full bg-white/85 backdrop-blur px-3 py-1.5 text-xs font-semibold text-stone-500 shadow-sm"
            >
              <motion.span animate={{ x: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}>
                <Hand className="w-3.5 h-3.5" />
              </motion.span>
              Glissez pour tourner · pincez pour zoomer
            </motion.div>
          )}
          {piece && (
            <motion.div
              key={piece}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm"
              style={{ background: "#FFF6F7", borderColor: "#F4C9CE", color: "#B30015" }}
            >
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#E2001A" }} />
              {piece}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex gap-1.5 p-2 border-t border-stone-100 overflow-x-auto">
        {VUES.map((v) => (
          <motion.button
            key={v.nom}
            whileTap={{ scale: 0.94 }}
            onClick={() => vue.current?.vue(v.nom)}
            className="flex-1 min-w-max rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-700 hover:border-[#E2001A] hover:text-[#E2001A] transition-colors"
          >
            {v.label}
          </motion.button>
        ))}
        <motion.button
          whileTap={{ scale: 0.94, rotate: -90 }}
          onClick={() => vue.current?.vue("accueil")}
          aria-label="Recentrer"
          className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-stone-600 hover:border-[#E2001A] hover:text-[#E2001A] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </motion.button>
      </div>
    </div>
  );
}
