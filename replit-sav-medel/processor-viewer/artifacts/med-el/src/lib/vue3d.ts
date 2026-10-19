// Vue 3D manipulable des processeurs, sur tous les axes.
// Les modèles sont des reconstructions approximatives en three.js. Quand MED-EL
// fournira de vrais fichiers 3D (glTF), seul construireModele() sera à remplacer
// par un GLTFLoader : la scène, les gestes et les vues restent les mêmes.
import * as THREE from "three";
import { COMPOSANTS, type Processeur } from "@/data/parcours";

const ROUGE = "#E2001A";

export type NomVue = "face" | "profil" | "dessus" | "dos" | "accueil";

export type Vue3D = {
  vue: (nom: NomVue) => void;
  // met une pièce en évidence depuis le parcours (null : aucune)
  montrer: (piece: string | null) => void;
  detruire: () => void;
};

type Origine = { op: number; tr: boolean };

export function creerVue3D(el: HTMLElement, proc: Processeur, onPiece?: (nom: string | null) => void): Vue3D {
  const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const L = () => Math.max(el.clientWidth, 1);
  const H = () => Math.max(el.clientHeight, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(L(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const cv = renderer.domElement;
  cv.style.cssText = "display:block;width:100%;height:100%;outline:none;touch-action:none";
  el.appendChild(cv);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, L() / H(), 0.1, 100);
  const D0 = 12;
  let dist = D0;
  let distCible = D0;
  const placerCamera = () => {
    camera.position.set(0, dist * 0.12, dist);
    camera.lookAt(0, -0.15, 0);
  };
  placerCamera();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cccc, 2.4));
  const cle = new THREE.DirectionalLight(0xffffff, 2.6);
  cle.position.set(4, 7, 8);
  scene.add(cle);
  const contre = new THREE.DirectionalLight(0xffe2e6, 1.8);
  contre.position.set(-7, 3, -6);
  scene.add(contre);
  const appoint = new THREE.DirectionalLight(0xffffff, 0.8);
  appoint.position.set(-5, -3, 6);
  scene.add(appoint);

  // ombre de contact douce
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(70,30,36,.32)");
  g.addColorStop(1, "rgba(70,30,36,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const ombre = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  ombre.rotation.x = -Math.PI / 2;
  ombre.position.y = -2.9;
  scene.add(ombre);

  const pivot = new THREE.Group();
  scene.add(pivot);
  const support = new THREE.Group();
  pivot.add(support);
  const modele = construireModele(proc);
  support.add(modele);
  const boite = new THREE.Box3().setFromObject(modele);
  const taille = boite.getSize(new THREE.Vector3());
  const centre = boite.getCenter(new THREE.Vector3());
  modele.position.sub(centre);
  const echelle = 4.6 / Math.max(taille.x, taille.y, taille.z);

  const maillages: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  modele.traverse((o) => {
    const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    if (m.isMesh) {
      maillages.push(m);
      m.userData.orig = { op: m.material.opacity, tr: m.material.transparent } as Origine;
    }
  });
  const touchables = maillages.filter((m) => m.userData.piece);

  const Q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  const VUES: Record<NomVue, THREE.Quaternion> = {
    face: Q(0, 0, 0),
    profil: Q(0, -Math.PI / 2, 0),
    dessus: Q(Math.PI / 2, 0, 0),
    dos: Q(0, Math.PI, 0),
    accueil: Q(0.16, -0.5, 0),
  };

  let anim: { de: THREE.Quaternion; a: THREE.Quaternion; t0: number; duree: number } | null = null;
  const allerVers = (q: THREE.Quaternion, duree = 900) => {
    anim = { de: pivot.quaternion.clone(), a: q.clone(), t0: performance.now(), duree };
  };
  const douceur = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const rebond = (x: number) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);

  // entrée : l'appareil arrive en tournant et en grandissant
  let entree: { t0: number; duree: number } | null = reduit ? null : { t0: performance.now(), duree: 1300 };
  pivot.quaternion.copy(reduit ? VUES.accueil : Q(0.5, -2.6, 0.25).multiply(VUES.accueil));
  if (!reduit) allerVers(VUES.accueil, 1300);
  support.scale.setScalar(reduit ? echelle : echelle * 0.55);

  // gestes : rotation libre sur tous les axes (type trackball), pincer ou molette pour zoomer,
  // rotation à deux doigts autour de l'axe de vue, double-clic pour recentrer
  const pointeurs = new Map<number, { x: number; y: number }>();
  let dernierGeste = 0;
  let vitesse = { x: 0, y: 0 };
  let appui: { t: number; dep: number } | null = null;
  let pince: { d: number; ang: number } | null = null;
  const geste = () => {
    dernierGeste = performance.now();
    anim = null;
  };
  const tourner = (dx: number, dy: number) => {
    const angle = Math.hypot(dx, dy) * 0.0095;
    if (!angle) return;
    const axe = new THREE.Vector3(dy, dx, 0).normalize().applyQuaternion(camera.quaternion);
    pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axe, angle));
  };
  const vriller = (a: number) => {
    const axe = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axe, a));
  };
  const deuxDoigts = () => {
    const [a, b] = [...pointeurs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  const zoomer = (f: number) => {
    distCible = Math.min(22, Math.max(6, distCible * f));
  };

  const surAppui = (e: PointerEvent) => {
    cv.setPointerCapture?.(e.pointerId);
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    geste();
    vitesse = { x: 0, y: 0 };
    el.dataset.saisi = "1";
    if (pointeurs.size === 1) appui = { t: performance.now(), dep: 0 };
    if (pointeurs.size === 2) {
      pince = deuxDoigts();
      appui = null;
    }
  };
  const surDeplacement = (e: PointerEvent) => {
    const p = pointeurs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    geste();
    if (pointeurs.size === 1) {
      tourner(dx, dy);
      vitesse = { x: dx, y: dy };
      if (appui) appui.dep += Math.abs(dx) + Math.abs(dy);
    } else if (pointeurs.size === 2 && pince) {
      const n = deuxDoigts();
      zoomer(pince.d / n.d);
      vriller(-(n.ang - pince.ang));
      pince = n;
    }
  };
  const surRelache = (e: PointerEvent) => {
    pointeurs.delete(e.pointerId);
    if (pointeurs.size < 2) pince = null;
    if (!pointeurs.size) delete el.dataset.saisi;
    if (appui && appui.dep < 7 && performance.now() - appui.t < 350) toucher(e);
    appui = null;
  };
  const surMolette = (e: WheelEvent) => {
    e.preventDefault();
    geste();
    zoomer(1 + Math.sign(e.deltaY) * 0.08);
  };
  const surDoubleClic = () => vue("accueil");
  cv.addEventListener("pointerdown", surAppui);
  cv.addEventListener("pointermove", surDeplacement);
  cv.addEventListener("pointerup", surRelache);
  cv.addEventListener("pointercancel", surRelache);
  cv.addEventListener("wheel", surMolette, { passive: false });
  cv.addEventListener("dblclick", surDoubleClic);

  // toucher une pièce la met en évidence et donne son nom ; toucher à côté annule
  const rayon = new THREE.Raycaster();
  let selection: string | null = null;
  const toucher = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    rayon.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      camera,
    );
    const impact = rayon
      .intersectObjects(touchables, false)
      .find((h) => (h.object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.opacity > 0.5);
    const piece = impact ? (impact.object.userData.piece as string) : null;
    selectionner(piece && piece !== selection ? piece : null);
  };
  const selectionner = (id: string | null) => {
    selection = id;
    maillages.forEach((m) => {
      const o = m.userData.orig as Origine;
      const mien = selection !== null && m.userData.piece === selection;
      const transparent = selection ? !mien || o.tr : o.tr;
      if (m.material.transparent !== transparent) m.material.needsUpdate = true;
      m.material.transparent = transparent;
      m.material.opacity = selection && !mien ? Math.min(o.op, 0.16) : o.op;
      m.material.depthWrite = !(selection && !mien);
      if (m.material.emissive && !m.userData.lumineux) m.material.emissive.setRGB(0, 0, 0);
    });
    onPiece?.(selection ? COMPOSANTS[proc.modele][selection] ?? null : null);
  };
  const vue = (nom: NomVue) => {
    geste();
    if (nom === "accueil") distCible = D0;
    allerVers(VUES[nom], 950);
  };

  const accent = new THREE.Color(ROUGE);
  let raf = 0;
  let avant = performance.now();
  let visible = true;
  const io = new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
  });
  io.observe(el);
  const ro = new ResizeObserver(() => {
    renderer.setSize(L(), H());
    camera.aspect = L() / H();
    camera.updateProjectionMatrix();
  });
  ro.observe(el);
  const axeY = new THREE.Vector3(0, 1, 0);
  const boucle = (t: number) => {
    raf = requestAnimationFrame(boucle);
    const dt = Math.min((t - avant) / 1000, 0.05);
    avant = t;
    if (!visible) return;
    if (entree) {
      const k = Math.min((t - entree.t0) / entree.duree, 1);
      support.scale.setScalar(echelle * (0.55 + 0.45 * rebond(k)));
      if (k >= 1) entree = null;
    }
    if (anim) {
      const k = Math.min((t - anim.t0) / anim.duree, 1);
      pivot.quaternion.copy(anim.de).slerp(anim.a, douceur(k));
      if (k >= 1) anim = null;
    } else if (!pointeurs.size) {
      if (Math.abs(vitesse.x) + Math.abs(vitesse.y) > 0.05) {
        tourner(vitesse.x, vitesse.y);
        vitesse.x *= 0.92;
        vitesse.y *= 0.92;
      } else if (!reduit && !selection && t - dernierGeste > 2500) {
        pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axeY, dt * 0.32));
      }
    }
    dist += (distCible - dist) * 0.15;
    placerCamera();
    modele.position.y = -centre.y + (reduit ? 0 : Math.sin(t / 900) * 0.05);
    if (selection) {
      const k = 0.28 + 0.18 * Math.sin(t / 180);
      maillages.forEach((m) => {
        if (m.userData.piece === selection && m.material.emissive) m.material.emissive.copy(accent).multiplyScalar(k);
      });
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(boucle);

  return {
    vue,
    montrer: (piece) => selectionner(piece && COMPOSANTS[proc.modele][piece] ? piece : null),
    detruire() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
        m.geometry?.dispose();
        if (m.material) {
          m.material.map?.dispose();
          m.material.dispose();
        }
      });
      renderer.dispose();
      cv.remove();
    },
  };
}

// ---------- modèles ----------

function construireModele(proc: Processeur): THREE.Group {
  return proc.modele === "sonnet" ? sonnet(proc) : rondo(proc);
}

type Pt = [number, number, number];

function kit() {
  const groupe = new THREE.Group();
  const ajouter = (piece: string, m: THREE.Mesh) => {
    m.userData.piece = piece;
    groupe.add(m);
    return m;
  };
  const coque = (c: string, o: THREE.MeshPhysicalMaterialParameters = {}) =>
    new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.36, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.3, ...o });
  const metal = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.28, metalness: 0.9 });
  const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const tube = (pts: Pt[], r: number, m: THREE.Material) =>
    new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 80, r, 14, false), m);
  const extrusion = (forme: THREE.Shape, ep: number, m: THREE.Material) => {
    const g = new THREE.ExtrudeGeometry(forme, { depth: ep, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 8, curveSegments: 32 });
    g.translate(0, 0, -ep / 2);
    return new THREE.Mesh(g, m);
  };
  const tour = (pts: [number, number][], m: THREE.Material) =>
    new THREE.Mesh(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), 72), m);
  const voyant = () => {
    const v = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 20, 14),
      new THREE.MeshStandardMaterial({ color: "#2BD27A", emissive: "#1FAF62", emissiveIntensity: 1.4 }),
    );
    v.userData.lumineux = true;
    return v;
  };
  return { groupe, ajouter, coque, metal, mat, tube, extrusion, tour, voyant };
}

function sonnet(p: Processeur) {
  const { groupe, ajouter, coque, metal, mat, tube, extrusion, tour, voyant } = kit();
  // unité de contrôle : silhouette en haricot du contour d'oreille
  const u = new THREE.Shape();
  u.moveTo(-0.48, 0);
  u.bezierCurveTo(-0.58, 0.9, -0.62, 1.7, -0.32, 2.2);
  u.bezierCurveTo(-0.1, 2.55, 0.42, 2.55, 0.56, 2.1);
  u.bezierCurveTo(0.66, 1.5, 0.58, 0.7, 0.5, 0);
  u.lineTo(-0.48, 0);
  ajouter("unite", extrusion(u, 0.78, coque(p.couleur)));
  // pack d'alimentation
  const b = new THREE.Shape();
  b.moveTo(-0.5, -0.06);
  b.lineTo(0.5, -0.06);
  b.lineTo(0.5, -1.9);
  b.bezierCurveTo(0.5, -2.55, -0.5, -2.55, -0.5, -1.9);
  b.lineTo(-0.5, -0.06);
  ajouter("pack", extrusion(b, 0.8, coque(p.couleur, { roughness: 0.45 })));
  ajouter("pack", new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.05, 1.08), mat("#2A2526")));
  // contour d'oreille translucide
  ajouter(
    "contour",
    tube(
      [[-0.2, 2.3, 0], [-0.55, 2.95, 0], [-1.25, 3.15, 0], [-1.85, 2.8, 0], [-2.08, 2.15, 0], [-1.98, 1.55, 0]],
      0.13,
      new THREE.MeshPhysicalMaterial({ color: "#E9E2E2", roughness: 0.15, transparent: true, opacity: 0.7, clearcoat: 1 }),
    ),
  );
  // microphones
  for (const [x, y] of [[-0.12, 2.48], [0.3, 2.46]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.95, 20), mat("#1E1A1B"));
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, 0);
    ajouter("micros", m);
  }
  const v = voyant();
  v.position.set(0.18, 1.72, 0.53);
  ajouter("voyant", v);
  // câble et antenne
  ajouter("cable", tube([[0.48, 2.0, -0.1], [1.0, 2.45, -0.3], [1.85, 2.3, -0.45], [2.45, 1.7, -0.45], [2.62, 1.2, -0.35]], 0.05, mat("#3B3537")));
  const a = tour([[0, 0.17], [0.75, 0.17], [0.98, 0.12], [1.06, 0], [0.98, -0.12], [0.75, -0.17], [0, -0.17]], coque(p.secondaire));
  a.rotation.x = Math.PI / 2;
  a.position.set(2.62, 0.25, -0.35);
  ajouter("antenne", a);
  const anneau = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 12, 64), new THREE.MeshStandardMaterial({ color: ROUGE, roughness: 0.4 }));
  anneau.position.set(2.62, 0.25, -0.17);
  ajouter("antenne", anneau);
  const aimant = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 40), metal("#B8BCC2"));
  aimant.rotation.x = Math.PI / 2;
  aimant.position.set(2.62, 0.25, -0.55);
  ajouter("aimant", aimant);
  return groupe;
}

function rondo(p: Processeur) {
  const { groupe, ajouter, coque, metal, mat, tour, voyant } = kit();
  const R = 1.95;
  const boitier = tour(
    [[0, -0.42], [R - 0.2, -0.42], [R - 0.05, -0.34], [R, -0.12], [R - 0.02, 0.12], [R - 0.12, 0.3], [R - 0.3, 0.38], [0, 0.4]],
    coque(p.couleur),
  );
  boitier.rotation.x = Math.PI / 2;
  ajouter("boitier", boitier);
  const couvercle = tour([[0, 0.36], [R - 0.42, 0.36], [R - 0.36, 0.4], [R - 0.48, 0.5], [1.0, 0.56], [0, 0.6]], coque(p.secondaire, { clearcoat: 1 }));
  couvercle.rotation.x = Math.PI / 2;
  ajouter("couvercle", couvercle);
  const centre = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 48), coque(ROUGE, { roughness: 0.3 }));
  centre.rotation.x = Math.PI / 2;
  centre.position.z = 0.6;
  ajouter(p.id === "rondo3" ? "bouton" : "couvercle", centre);
  for (const [x, y] of [[-0.62, 1.08], [0.62, 1.08]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 20), mat("#1E1A1B"));
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, 0.53);
    ajouter("micros", m);
  }
  const v = voyant();
  v.position.set(R - 0.04, 0.35, 0.05);
  ajouter("voyant", v);
  const batterie = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 0.38, 48),
    new THREE.MeshStandardMaterial({ color: "#E0A43A", roughness: 0.5, metalness: 0.2 }),
  );
  batterie.rotation.x = Math.PI / 2;
  ajouter("batterie", batterie);
  const aimant = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 48), metal("#B8BCC2"));
  aimant.rotation.x = Math.PI / 2;
  aimant.position.z = -0.46;
  ajouter("aimant", aimant);
  return groupe;
}
