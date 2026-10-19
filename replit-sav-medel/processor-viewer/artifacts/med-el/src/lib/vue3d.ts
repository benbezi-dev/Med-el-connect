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

// Échelle : 1 unité = 10 mm. Cotes reprises des fiches MED-EL (Sonnet 2 : 56,7 mm de haut
// avec coude, antenne 32,8 × 5,8 mm ; Rondo 3 : 44,9 × 35,8 × 11,9 mm ; Rondo 2 : 46,8 × 35,8 × 12,1 mm).

// Contour 2D d'un corps courbé le long d'une colonne, avec bout arrondi en haut et/ou en bas.
function silhouette(colonne: THREE.CatmullRomCurve3, t0: number, t1: number, demi: (t: number) => number, rondBas: boolean, rondHaut: boolean) {
  const n = 40;
  const gauche: THREE.Vector2[] = [];
  const droite: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const c = colonne.getPointAt(t);
    const d = colonne.getTangentAt(t);
    const w = demi(t);
    gauche.push(new THREE.Vector2(c.x - d.y * w, c.y + d.x * w));
    droite.push(new THREE.Vector2(c.x + d.y * w, c.y - d.x * w));
  }
  const bout = (t: number, signe: number) => {
    const c = colonne.getPointAt(t);
    const d = colonne.getTangentAt(t);
    const w = demi(t);
    const a0 = Math.atan2(-d.x, d.y); // direction "droite"
    const pts: THREE.Vector2[] = [];
    for (let k = 1; k < 16; k++) {
      const a = a0 + signe * (Math.PI * k) / 16;
      pts.push(new THREE.Vector2(c.x + Math.cos(a) * w, c.y + Math.sin(a) * w));
    }
    return pts;
  };
  const pts = [...droite];
  if (rondHaut) pts.push(...bout(t1, 1));
  pts.push(...gauche.reverse());
  if (rondBas) pts.push(...bout(t0, 1));
  return new THREE.Shape(pts);
}

function sonnet(p: Processeur) {
  const { groupe, ajouter, coque, metal, mat, tube, tour, voyant } = kit();
  const s3 = p.id === "sonnet3";
  // colonne du contour d'oreille : légère courbe en banane, plus courte sur le Sonnet 3
  const bas = s3 ? -2.25 : -2.85;
  const colonne = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.18, bas, 0),
    new THREE.Vector3(0.42, bas * 0.5, 0),
    new THREE.Vector3(0.44, 0, 0),
    new THREE.Vector3(0.3, 0.85, 0),
    new THREE.Vector3(0.0, 1.5, 0),
  ]);
  const biseau = 0.22;
  const ep = 0.93; // épaisseur 9,3 mm
  const corps = (forme: THREE.Shape, m: THREE.Material) => {
    const g = new THREE.ExtrudeGeometry(forme, { depth: ep - 2 * biseau, bevelEnabled: true, bevelThickness: biseau, bevelSize: biseau * 0.9, bevelSegments: 10, curveSegments: 24 });
    g.translate(0, 0, -(ep - 2 * biseau) / 2);
    return new THREE.Mesh(g, m);
  };
  const demi = (t: number) => (0.5 - biseau * 0.9) * (t > 0.9 ? 0.92 + 0.08 * Math.cos(((t - 0.9) / 0.1) * Math.PI * 0.5) : 1);
  const coupe = s3 ? 0.5 : 0.56; // jonction unité de contrôle / pack d'alimentation
  ajouter("unite", corps(silhouette(colonne, coupe + 0.006, 1, demi, false, true), coque(p.couleur)));
  ajouter("pack", corps(silhouette(colonne, 0, coupe - 0.006, demi, true, false), coque(p.secondaire, { roughness: 0.42 })));
  // liseré de jonction
  const cj = colonne.getPointAt(coupe);
  const joint = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.03, ep * 0.98), mat("#1F1B1C"));
  joint.position.set(cj.x, cj.y, 0);
  joint.rotation.z = Math.atan2(colonne.getTangentAt(coupe).y, colonne.getTangentAt(coupe).x) - Math.PI / 2;
  ajouter("pack", joint);

  // coude : part du haut de l'unité, passe au-dessus de l'oreille et redescend devant
  const haut = colonne.getPointAt(1);
  ajouter(
    "contour",
    tube(
      [[haut.x - 0.12, haut.y + 0.25, 0], [haut.x - 0.35, haut.y + 0.85, 0], [haut.x - 0.95, haut.y + 1.15, 0], [haut.x - 1.6, haut.y + 1.0, 0], [haut.x - 2.0, haut.y + 0.55, 0], [haut.x - 2.12, haut.y + 0.05, 0]],
      s3 ? 0.15 : 0.12,
      s3
        ? new THREE.MeshPhysicalMaterial({ color: "#D9D5D2", roughness: 0.55, transparent: true, opacity: 0.85 })
        : new THREE.MeshPhysicalMaterial({ color: "#EDE7E3", roughness: 0.12, transparent: true, opacity: 0.72, clearcoat: 1 }),
    ),
  );
  // embout du coude sur l'unité
  const embout = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.4, 24), coque(p.couleur));
  embout.position.set(haut.x - 0.06, haut.y + 0.12, 0);
  embout.rotation.z = 0.25;
  ajouter("unite", embout);

  // deux micros sur le dessus de l'unité (caches micro)
  for (const t of [0.93, 0.83]) {
    const c = colonne.getPointAt(t);
    const d = colonne.getTangentAt(t);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 20), mat("#141112"));
    m.rotation.x = Math.PI / 2;
    m.position.set(c.x + d.y * 0.12, c.y - d.x * 0.12, ep / 2 + 0.005);
    ajouter("micros", m);
  }
  if (s3) {
    // touche tactile au dos de l'unité
    const c = colonne.getPointAt(0.74);
    const touche = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.32, 6, 16), coque("#56575C", { roughness: 0.3 }));
    touche.position.set(c.x + 0.29, c.y, 0);
    touche.rotation.z = -0.2;
    touche.scale.z = 0.5;
    ajouter("touche", touche);
  }

  // câble : sort du haut de l'unité, côté arrière, vers l'antenne posée sur la tête
  const A = new THREE.Vector3(3.55, 2.35, -0.35);
  const depart = colonne.getPointAt(0.95);
  ajouter("cable", tube([[depart.x + 0.3, depart.y + 0.05, -0.2], [depart.x + 0.8, depart.y + 0.2, -0.3], [1.45, 1.75, -0.4], [A.x - 1.75, A.y - 0.3, -0.4], [A.x - 1.62, A.y - 0.05, -0.35]], 0.045, mat(p.id === "sonnet1" ? "#6E6A66" : "#38393C")));
  // antenne DL-Coil : disque de 32,8 mm × 5,8 mm
  const R = 1.64;
  const antenne = tour([[0, -0.29], [R * 0.8, -0.29], [R * 0.95, -0.22], [R, -0.06], [R, 0.06], [R * 0.93, 0.22], [R * 0.75, 0.28], [0, 0.29]], coque(p.secondaire, { roughness: 0.4 }));
  antenne.rotation.x = Math.PI / 2;
  antenne.position.copy(A);
  ajouter("antenne", antenne);
  // aimant au centre, côté peau
  const aimant = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 40), metal("#B8BCC2"));
  aimant.rotation.x = Math.PI / 2;
  aimant.position.set(A.x, A.y, A.z - 0.32);
  ajouter("aimant", aimant);
  // voyant de contrôle de liaison, sur l'antenne
  const v = voyant();
  v.position.set(A.x - 0.95, A.y - 0.95, A.z + 0.22);
  ajouter("voyant", v);
  return groupe;
}

// Galet du Rondo : tour de profil, puis plan déformé en super-ellipse (45 × 36 mm).
function galet(profil: [number, number][], rx: number, ry: number, m: THREE.Material) {
  const g = new THREE.LatheGeometry(profil.map(([r, h]) => new THREE.Vector2(r, h)), 96);
  const pos = g.attributes.position;
  const n = 2.3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const a = Math.atan2(z, x);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const k = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(sn), n), -1 / n);
    pos.setXYZ(i, c * k * r * rx, pos.getY(i), sn * k * r * ry);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = Math.PI / 2; // dessus vers la caméra
  return mesh;
}

function rondo(p: Processeur) {
  const { groupe, ajouter, coque, metal, mat, voyant } = kit();
  const r3 = p.id === "rondo3";
  const rx = (r3 ? 4.49 : 4.68) / 2;
  const ry = 3.58 / 2;
  const h = r3 ? 1.19 : 1.21;
  const b = -h / 2;
  // boîtier : fond plat contre la tête, flancs arrondis
  ajouter("boitier", galet([[0, b], [0.82, b], [0.93, b + 0.06], [0.985, b + 0.2], [1, b + 0.42], [0.99, b + 0.6], [0.965, b + 0.66], [0, b + 0.66]], rx, ry, coque(p.couleur, { roughness: 0.5, clearcoat: 0.3 })));
  // couvercle bombé (design cover interchangeable), séparé par une fine rainure
  ajouter("couvercle", galet([[0, b + 0.68], [0.955, b + 0.68], [0.965, b + 0.74], [0.94, b + 0.88], [0.86, b + 1.02], [0.66, b + 1.13], [0.35, h / 2 - 0.005], [0, h / 2]], rx, ry, coque(p.secondaire, { roughness: r3 ? 0.55 : 0.3, clearcoat: r3 ? 0.2 : 0.8 })));
  // micros : deux sur le Rondo 3, un seul sur le Rondo 2, vers l'avant
  const micros = r3 ? [[rx * 0.62, ry * 0.42], [rx * 0.62, -ry * 0.42]] : [[rx * 0.66, 0]];
  for (const [x, y] of micros) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 20), mat("#141112"));
    m.rotation.x = Math.PI / 2;
    const z = b + 1.115; // à fleur du couvercle
    m.position.set(x, y, z);
    m.lookAt(x * 1.6, y * 1.6, z + 1.2);
    m.rotateX(Math.PI / 2);
    ajouter("micros", m);
  }
  // voyants : deux sur le Rondo 3 (batterie et liaison), un sur le Rondo 2, sur la tranche arrière
  for (const y of r3 ? [0.22, -0.22] : [0]) {
    const v = voyant();
    v.position.set(-rx * 0.995, y, b + 0.45);
    ajouter("voyant", v);
  }
  if (!r3) {
    // bouton marche/arrêt du Rondo 2, sur la tranche
    const bt = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 16), coque("#3A3B3F", { roughness: 0.4 }));
    bt.position.set(0, ry * 0.99, b + 0.42);
    bt.rotation.z = Math.PI / 2;
    bt.scale.set(1, 1, 0.8);
    ajouter("bouton", bt);
  }
  // batterie intégrée et aimant central côté peau
  const batterie = galet([[0, b + 0.12], [0.72, b + 0.12], [0.72, b + 0.55], [0, b + 0.55]], rx, ry, new THREE.MeshStandardMaterial({ color: "#E0A43A", roughness: 0.5, metalness: 0.2 }));
  ajouter("batterie", batterie);
  const aimant = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 48), metal("#B8BCC2"));
  aimant.rotation.x = Math.PI / 2;
  aimant.position.z = b - 0.03;
  ajouter("aimant", aimant);
  return groupe;
}
