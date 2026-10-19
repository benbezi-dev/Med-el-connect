import { useEffect, useRef } from "react";
import * as THREE from "three";

const RONDO3_PHOTO = "https://blog.medel.com/wp-content/uploads/2020/10/med-el_eye5_2020_danielzangerl-260a.jpg";

interface Rondo3ViewerProps {
  highlights?: string[];
}

export function Rondo3Viewer({ highlights = [] }: Rondo3ViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer | null;
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    group: THREE.Group | null;
    markers: Record<string, THREE.Group | { meshes: THREE.Group[] }>;
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
    rotateX: -0.3, rotateY: 0.4,
    targetRotX: -0.3, targetRotY: 0.4,
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
    camera.position.set(0, 0, 8);

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
      color: 0xf5f3ef, roughness: 0.3,
      clearcoat: 0.6, clearcoatRoughness: 0.15, metalness: 0.04,
    });
    const offWhiteMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8e3db, roughness: 0.5, metalness: 0.02,
    });
    const darkMat = new THREE.MeshPhysicalMaterial({
      color: 0x222222, roughness: 0.4, metalness: 0.6,
    });
    const magnetMat = new THREE.MeshPhysicalMaterial({
      color: 0xb8b4ae, roughness: 0.2, metalness: 0.9,
    });
    const ledMat = new THREE.MeshPhysicalMaterial({
      color: 0xe2001a, emissive: new THREE.Color(0xe2001a), emissiveIntensity: 0.7, roughness: 0.15,
    });

    const bodyRadius = 1.6;
    const bodyHeight = 0.55;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyHeight, 64),
      whiteMat
    );
    group.add(body);

    const bevel = new THREE.Mesh(
      new THREE.TorusGeometry(bodyRadius - 0.05, 0.06, 16, 64),
      offWhiteMat
    );
    bevel.rotation.x = Math.PI / 2;
    bevel.position.y = bodyHeight / 2;
    group.add(bevel);

    const botBevel = new THREE.Mesh(
      new THREE.TorusGeometry(bodyRadius - 0.05, 0.04, 16, 64),
      offWhiteMat
    );
    botBevel.rotation.x = Math.PI / 2;
    botBevel.position.y = -bodyHeight / 2;
    group.add(botBevel);

    const inset = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 0.08, 48),
      offWhiteMat
    );
    inset.position.y = -bodyHeight / 2 + 0.04;
    group.add(inset);

    const magnet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.12, 48),
      magnetMat
    );
    magnet.position.y = -bodyHeight / 2 - 0.02;
    group.add(magnet);

    const thread = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.32, 32),
      new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide })
    );
    thread.rotation.x = -Math.PI / 2;
    thread.position.y = -bodyHeight / 2 - 0.085;
    group.add(thread);

    // Microphone positions
    const micPositions = [
      { x: 1.05, z: 0.55 },
      { x: 1.05, z: -0.55 },
    ];
    micPositions.forEach((pos) => {
      const mic = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.1, 24),
        darkMat
      );
      mic.position.set(pos.x, bodyHeight / 2 - 0.01, pos.z);
      group.add(mic);

      const micRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.015, 8, 24),
        offWhiteMat
      );
      micRing.rotation.x = Math.PI / 2;
      micRing.position.set(pos.x, bodyHeight / 2 + 0.04, pos.z);
      group.add(micRing);
    });

    const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), ledMat);
    led.position.set(0, 0.06, bodyRadius - 0.04);
    group.add(led);

    const brandRing = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.72, 64),
      new THREE.MeshBasicMaterial({ color: 0xe2001a, side: THREE.DoubleSide, transparent: true, opacity: 0.35 })
    );
    brandRing.rotation.x = -Math.PI / 2;
    brandRing.position.y = bodyHeight / 2 + 0.005;
    group.add(brandRing);

    const dot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.02, 32),
      offWhiteMat
    );
    dot.position.y = bodyHeight / 2 + 0.011;
    group.add(dot);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.5, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.07 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.2;
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

    const markers: Record<string, THREE.Group | { meshes: THREE.Group[] }> = {};

    const mMagnet = createMarker(new THREE.Vector3(0, -bodyHeight / 2 - 0.1, 0), 1.2);
    mMagnet.rotation.x = Math.PI / 2;
    group.add(mMagnet);
    markers.magnet = mMagnet;

    const mThread = createMarker(new THREE.Vector3(0, -bodyHeight / 2 - 0.11, 0), 0.7);
    mThread.rotation.x = Math.PI / 2;
    group.add(mThread);
    markers.magnet_thread = mThread;

    const mMic1 = createMarker(new THREE.Vector3(1.05, bodyHeight / 2 + 0.05, 0.55), 0.6);
    mMic1.rotation.x = -Math.PI / 2;
    group.add(mMic1);
    const mMic2 = createMarker(new THREE.Vector3(1.05, bodyHeight / 2 + 0.05, -0.55), 0.6);
    mMic2.rotation.x = -Math.PI / 2;
    group.add(mMic2);
    markers.microphones = { meshes: [mMic1, mMic2] };

    const mCoil = createMarker(new THREE.Vector3(0, bodyHeight / 2 + 0.02, 0), 1.6);
    mCoil.rotation.x = -Math.PI / 2;
    group.add(mCoil);
    markers.charging_coil = mCoil;

    const mTop = createMarker(new THREE.Vector3(-0.7, bodyHeight / 2 + 0.05, 0.7), 0.7);
    mTop.rotation.x = -Math.PI / 2;
    group.add(mTop);
    markers.casing_top = mTop;

    const mSide = createMarker(new THREE.Vector3(0, 0, bodyRadius + 0.05), 0.7);
    group.add(mSide);
    markers.casing_side = mSide;

    const mLed = createMarker(new THREE.Vector3(0, 0.06, bodyRadius + 0.1), 0.4);
    group.add(mLed);
    markers.led = mLed;

    const mAntenna = createMarker(new THREE.Vector3(0, bodyHeight / 2 + 0.03, 0), 1.3);
    mAntenna.rotation.x = -Math.PI / 2;
    group.add(mAntenna);
    markers.antenna_zone = mAntenna;

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
        const meshes = (m as { meshes: THREE.Group[] }).meshes ?? [m as THREE.Group];
        meshes.forEach((mesh) => {
          if (mesh.visible && mesh.userData?.pulse) {
            const pulse = mesh.userData.pulse as THREE.Mesh;
            const s = 1 + Math.sin(t * 3) * 0.25;
            pulse.scale.set(s, s, s);
            (pulse.material as THREE.MeshBasicMaterial).opacity = 0.4 - Math.sin(t * 3) * 0.3;
          }
        });
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
      const visible = highlights.includes(key);
      const meshes = (m as { meshes: THREE.Group[] }).meshes ?? [m as THREE.Group];
      meshes.forEach((mesh) => { mesh.visible = visible; });
    });
  }, [highlights]);

  const resetView = () => {
    stateRef.current.targetRotX = -0.3;
    stateRef.current.targetRotY = 0.4;
    stateRef.current.autoRotate = true;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full" style={{ height: "260px" }}>
        <div ref={mountRef} className="w-full h-full rounded-lg overflow-hidden" />
        <button
          data-testid="button-reset-view-rondo3"
          onClick={resetView}
          className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm border border-stone-200 hover:border-red-500 px-2.5 py-1 rounded-full text-xs font-medium text-stone-600 hover:text-red-600 transition-all shadow-sm"
        >
          ↺ Vue initiale
        </button>
        <div className="absolute bottom-2 left-2 text-[9px] uppercase tracking-widest text-stone-400 font-mono">
          Rondo 3
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <img
          src={RONDO3_PHOTO}
          alt="Rondo 3 photo de référence"
          className="w-full rounded-md object-contain"
          style={{ maxHeight: "72px", opacity: 0.65 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <p className="text-[9px] uppercase tracking-widest text-stone-400">Photo de référence</p>
      </div>
    </div>
  );
}
