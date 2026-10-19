import { useEffect, useRef } from "react";
import * as THREE from "three";

const SONNET_PHOTO = "https://sfc01.cdn.medel.com/images/default-source/product-images/sonnet-3/sonnet381c99a8f2f1764e680bdff09000c6e28.png?auto=format&sfvrsn=aedefe41_2";

interface SonnetViewerProps {
  highlights?: string[];
}

export function SonnetViewer({ highlights = [] }: SonnetViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer | null;
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    group: THREE.Group | null;
    markers: Record<string, THREE.Group>;
    led: THREE.Mesh | null;
    raf: number | null;
    rotateX: number;
    rotateY: number;
    targetRotX: number;
    targetRotY: number;
    isDragging: boolean;
    lastX: number;
    lastY: number;
    autoRotate: boolean;
  }>({
    renderer: null, scene: null, camera: null, group: null,
    markers: {}, led: null, raf: null,
    rotateX: -0.1, rotateY: 0.5,
    targetRotX: -0.1, targetRotY: 0.5,
    isDragging: false, lastX: 0, lastY: 0,
    autoRotate: true,
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 0, 9);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xffe0d8, 0.5);
    rimLight.position.set(-4, -2, -3);
    scene.add(rimLight);
    const fillLight = new THREE.DirectionalLight(0xfff0f0, 0.25);
    fillLight.position.set(0, -4, 2);
    scene.add(fillLight);

    const group = new THREE.Group();
    scene.add(group);

    const whiteMat = new THREE.MeshPhysicalMaterial({
      color: 0xf5f3ef, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15, metalness: 0.04,
    });
    const offWhiteMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8e3db, roughness: 0.5, metalness: 0.02,
    });
    const darkMat = new THREE.MeshPhysicalMaterial({
      color: 0x222222, roughness: 0.4, metalness: 0.6,
    });
    const accentMat = new THREE.MeshPhysicalMaterial({
      color: 0xddd5cb, roughness: 0.4, metalness: 0.1,
    });
    const magnetMat = new THREE.MeshPhysicalMaterial({
      color: 0xb8b4ae, roughness: 0.2, metalness: 0.9,
    });
    const cableMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0d9d0, roughness: 0.7, metalness: 0,
    });
    const redMat = new THREE.MeshPhysicalMaterial({
      color: 0xe2001a, roughness: 0.4, metalness: 0.1,
    });
    const ledMat = new THREE.MeshPhysicalMaterial({
      color: 0xe2001a, emissive: new THREE.Color(0xe2001a), emissiveIntensity: 0.7, roughness: 0.15,
    });

    // BTE Body
    const bodyGroup = new THREE.Group();
    bodyGroup.position.set(-0.9, 0, 0);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.5, 32),
      whiteMat
    );
    shaft.position.y = 0.1;
    bodyGroup.add(shaft);

    const topCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      whiteMat
    );
    topCap.position.y = 0.85;
    bodyGroup.add(topCap);

    const botCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 32, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      whiteMat
    );
    botCap.position.y = -0.65;
    bodyGroup.add(botCap);

    const micCover = new THREE.Mesh(
      new THREE.CylinderGeometry(0.43, 0.42, 0.32, 32),
      accentMat
    );
    micCover.position.y = 0.75;
    bodyGroup.add(micCover);

    const micGrille = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.04, 24),
      darkMat
    );
    micGrille.position.y = 0.93;
    bodyGroup.add(micGrille);

    const battery = new THREE.Mesh(
      new THREE.CylinderGeometry(0.43, 0.4, 0.45, 32),
      offWhiteMat
    );
    battery.position.y = -0.45;
    bodyGroup.add(battery);

    const battSeam = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.008, 8, 48),
      darkMat
    );
    battSeam.rotation.x = Math.PI / 2;
    battSeam.position.y = -0.22;
    bodyGroup.add(battSeam);

    const sideBtn = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.45, 0.12),
      redMat
    );
    sideBtn.position.set(0.42, 0.15, 0);
    bodyGroup.add(sideBtn);

    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), ledMat);
    led.position.set(0, 0.95, 0.25);
    bodyGroup.add(led);

    group.add(bodyGroup);

    // Cable
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.9, 1.0, 0),
      new THREE.Vector3(-0.5, 1.2, -0.1),
      new THREE.Vector3(0.2, 0.9, -0.2),
      new THREE.Vector3(0.7, 0.4, -0.1),
      new THREE.Vector3(1.05, 0.0, 0),
    ]);
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.04, 12, false),
      cableMat
    );
    group.add(cable);

    // Coil
    const coilGroup = new THREE.Group();
    coilGroup.position.set(1.3, -0.1, 0);

    const coilBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.18, 48),
      whiteMat
    );
    coilGroup.add(coilBody);

    const coilBevel = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.04, 16, 48),
      offWhiteMat
    );
    coilBevel.rotation.x = Math.PI / 2;
    coilBevel.position.y = 0.09;
    coilGroup.add(coilBevel);

    const coilInner = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.36, 48),
      new THREE.MeshBasicMaterial({ color: 0xe2001a, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
    );
    coilInner.rotation.x = -Math.PI / 2;
    coilInner.position.y = 0.095;
    coilGroup.add(coilInner);

    const coilMagnet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 32),
      magnetMat
    );
    coilMagnet.position.y = -0.085;
    coilGroup.add(coilMagnet);

    const connector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.15, 16),
      darkMat
    );
    connector.rotation.z = Math.PI / 2;
    connector.position.set(-0.55, 0.08, 0);
    coilGroup.add(connector);

    group.add(coilGroup);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.8, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.07 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.4;
    scene.add(shadow);

    // Markers
    const createMarker = (position: THREE.Vector3, scale = 1): THREE.Group => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.25 * scale, 0.33 * scale, 32),
        new THREE.MeshBasicMaterial({ color: 0xe2001a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      g.add(ring);
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(0.33 * scale, 0.42 * scale, 32),
        new THREE.MeshBasicMaterial({ color: 0xe2001a, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
      );
      g.add(pulse);
      const center = new THREE.Mesh(
        new THREE.CircleGeometry(0.1 * scale, 16),
        new THREE.MeshBasicMaterial({ color: 0xe2001a })
      );
      g.add(center);
      g.position.copy(position);
      g.userData.pulse = pulse;
      g.visible = false;
      return g;
    };

    const markers: Record<string, THREE.Group> = {};

    const mBody = createMarker(new THREE.Vector3(-0.9, 0.1, 0.5), 0.9);
    group.add(mBody);
    markers.body = mBody;

    const mMicCover = createMarker(new THREE.Vector3(-0.9, 0.95, 0), 0.7);
    mMicCover.rotation.x = -Math.PI / 2;
    group.add(mMicCover);
    markers.mic_cover = mMicCover;

    const mBattery = createMarker(new THREE.Vector3(-0.9, -0.5, 0.5), 0.7);
    group.add(mBattery);
    markers.battery = mBattery;

    const mCoil = createMarker(new THREE.Vector3(1.3, -0.1, 0.2), 1.0);
    group.add(mCoil);
    markers.coil = mCoil;

    const mCoilMag = createMarker(new THREE.Vector3(1.3, -0.18, 0), 0.5);
    mCoilMag.rotation.x = -Math.PI / 2;
    group.add(mCoilMag);
    markers.coil_magnet = mCoilMag;

    const mAntenna = createMarker(new THREE.Vector3(1.3, -0.1, 0.2), 1.3);
    group.add(mAntenna);
    markers.antenna_zone = mAntenna;

    const mLed = createMarker(new THREE.Vector3(-0.9, 0.95, 0.45), 0.4);
    group.add(mLed);
    markers.led = mLed;

    const mMics = createMarker(new THREE.Vector3(-0.9, 0.95, 0), 0.5);
    mMics.rotation.x = -Math.PI / 2;
    group.add(mMics);
    markers.microphones = mMics;

    stateRef.current.scene = scene;
    stateRef.current.camera = camera;
    stateRef.current.renderer = renderer;
    stateRef.current.group = group;
    stateRef.current.markers = markers;
    stateRef.current.led = led;

    const dom = renderer.domElement;
    dom.style.cursor = "grab";
    dom.style.touchAction = "none";

    const onPointerDown = (e: MouseEvent) => {
      stateRef.current.isDragging = true;
      stateRef.current.autoRotate = false;
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
      dom.style.cursor = "grabbing";
    };
    const onPointerMove = (e: MouseEvent) => {
      if (!stateRef.current.isDragging) return;
      const dx = e.clientX - stateRef.current.lastX;
      const dy = e.clientY - stateRef.current.lastY;
      stateRef.current.targetRotY += dx * 0.01;
      stateRef.current.targetRotX += dy * 0.01;
      stateRef.current.targetRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, stateRef.current.targetRotX));
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
    };
    const onPointerUp = () => {
      stateRef.current.isDragging = false;
      dom.style.cursor = "grab";
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) onPointerDown(e.touches[0] as unknown as MouseEvent);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) { e.preventDefault(); onPointerMove(e.touches[0] as unknown as MouseEvent); }
    };

    dom.addEventListener("mousedown", onPointerDown);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    dom.addEventListener("touchstart", onTouchStart, { passive: true });
    dom.addEventListener("touchmove", onTouchMove, { passive: false });
    dom.addEventListener("touchend", onPointerUp);

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    let t = 0;
    const animate = () => {
      t += 0.016;
      if (stateRef.current.autoRotate) stateRef.current.targetRotY += 0.003;
      stateRef.current.rotateX += (stateRef.current.targetRotX - stateRef.current.rotateX) * 0.1;
      stateRef.current.rotateY += (stateRef.current.targetRotY - stateRef.current.rotateY) * 0.1;
      if (group) {
        group.rotation.x = stateRef.current.rotateX;
        group.rotation.y = stateRef.current.rotateY;
      }

      Object.values(markers).forEach((m) => {
        if (m.visible && m.userData?.pulse) {
          const pulse = m.userData.pulse as THREE.Mesh;
          const s = 1 + Math.sin(t * 3) * 0.25;
          pulse.scale.set(s, s, s);
          (pulse.material as THREE.MeshBasicMaterial).opacity = 0.4 - Math.sin(t * 3) * 0.3;
        }
      });

      if (led) {
        (led.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.4 + Math.sin(t * 2) * 0.2;
      }
      renderer.render(scene, camera);
      stateRef.current.raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (stateRef.current.raf) cancelAnimationFrame(stateRef.current.raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      dom.removeEventListener("mousedown", onPointerDown);
      dom.removeEventListener("touchstart", onTouchStart);
      dom.removeEventListener("touchmove", onTouchMove);
      dom.removeEventListener("touchend", onPointerUp);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const markers = stateRef.current.markers;
    if (!markers) return;
    Object.entries(markers).forEach(([key, m]) => {
      m.visible = highlights.includes(key);
    });
  }, [highlights]);

  const resetView = () => {
    stateRef.current.targetRotX = -0.1;
    stateRef.current.targetRotY = 0.5;
    stateRef.current.autoRotate = true;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full" style={{ height: "260px" }}>
        <div ref={mountRef} className="w-full h-full rounded-lg overflow-hidden" />
        <button
          data-testid="button-reset-view-sonnet"
          onClick={resetView}
          className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm border border-stone-200 hover:border-red-500 px-2.5 py-1 rounded-full text-xs font-medium text-stone-600 hover:text-red-600 transition-all shadow-sm"
        >
          ↺ Vue initiale
        </button>
        <div className="absolute bottom-2 left-2 text-[9px] uppercase tracking-widest text-stone-400 font-mono">
          Sonnet
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <img
          src={SONNET_PHOTO}
          alt="Sonnet photo de référence"
          className="w-full rounded-md object-contain"
          style={{ maxHeight: "72px", opacity: 0.65 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <p className="text-[9px] uppercase tracking-widest text-stone-400">Photo de référence</p>
      </div>
    </div>
  );
}
