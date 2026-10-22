import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Timer,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { fibonacciPoint, fromLatLon } from "./geo";
import { isLand, LAND_SAMPLES } from "./landMask";
import * as glsl from "./shaders";

/** Trade hubs in the corridors the PRD names (Gulf, Türkiye, Africa); illustration only. */
const HUBS = {
  dubai: [25.2, 55.27],
  jeddah: [21.49, 39.19],
  istanbul: [41.01, 28.98],
  cairo: [30.04, 31.24],
  algiers: [36.75, 3.06],
  casablanca: [33.57, -7.59],
  lagos: [6.45, 3.39],
  mombasa: [-4.04, 39.67],
  johannesburg: [-26.2, 28.05],
} as const satisfies Record<string, readonly [number, number]>;

type Hub = keyof typeof HUBS;

const ROUTES: [Hub, Hub][] = [
  ["istanbul", "algiers"],
  ["dubai", "lagos"],
  ["dubai", "mombasa"],
  ["istanbul", "casablanca"],
  ["jeddah", "algiers"],
  ["cairo", "johannesburg"],
  ["istanbul", "dubai"],
  ["lagos", "casablanca"],
];

// Centre of the view: lat 18°N, lon 28°E puts North Africa, Türkiye and the Gulf in front
const VIEW_LAT = 18;
const VIEW_LON = 28;
const SUN = new Vector3(1, 0.42, 0.62).normalize();
const CAMERA_Z = 4.7;

export interface GlobeOptions {
  reducedMotion: boolean;
  onFirstFrame?: () => void;
}

export interface Globe {
  destroy(): void;
}

/**
 * Renders the landing globe into `container` (sized by CSS). Pauses while off screen or in a
 * hidden tab; under reduced motion it draws one still frame. Throws when WebGL is unavailable.
 */
export function createGlobe(container: HTMLElement, options: GlobeOptions): Globe {
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, CAMERA_Z);

  const time = { value: 0 };

  // Tilt brings the view latitude to the centre; spin (animated) brings the view longitude there
  const tilt = new Group();
  tilt.rotation.x = (VIEW_LAT * Math.PI) / 180;
  const spin = new Group();
  const baseSpin = (-(90 + VIEW_LON) * Math.PI) / 180;
  spin.rotation.y = baseSpin;
  tilt.add(spin);
  scene.add(tilt);

  const sphere = new SphereGeometry(1, 96, 64);
  spin.add(
    new Mesh(
      sphere,
      new ShaderMaterial({
        vertexShader: glsl.surface.vertex,
        fragmentShader: glsl.surface.fragment,
        uniforms: {
          uSun: { value: SUN },
          uNight: { value: new Color("#040a13") },
          uDay: { value: new Color("#0f233a") },
          uRim: { value: new Color("#3b67a6") },
          uWarm: { value: new Color("#f1b56e") },
        },
      }),
    ),
  );

  spin.add(landPoints(pixelRatio, time));
  spin.add(hubPoints(pixelRatio, time));
  ROUTES.forEach(([from, to], i) =>
    spin.add(arcMesh(HUBS[from], HUBS[to], i / ROUTES.length, time)),
  );

  const halo = new Mesh(
    sphere,
    new ShaderMaterial({
      vertexShader: glsl.atmosphere.vertex,
      fragmentShader: glsl.atmosphere.fragment,
      uniforms: {
        uCool: { value: new Color("#3d73c4") },
        uWarm: { value: new Color("#f0a860") },
        uSun: { value: SUN },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(1.16);
  scene.add(halo);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    // Keep the whole globe and its halo in frame on narrow (portrait) containers
    camera.position.z = w < h ? CAMERA_Z * (h / w) * 0.92 : CAMERA_Z;
    camera.updateProjectionMatrix();
    if (still) render();
  };

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (event: PointerEvent) => {
    pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
  };

  // Still frame under reduced motion, or once the device proves too slow to animate smoothly
  let still = options.reducedMotion;
  const SAMPLE_FRAMES = 45;
  const frames = { warmup: 0, samples: [] as number[], judged: false };

  const timer = new Timer();
  let firstFrame = true;
  const render = () => {
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      options.onFirstFrame?.();
    }
  };

  const tick = () => {
    timer.update();
    const raw = timer.getDelta();
    if (frameBudgetBlown(raw)) return;
    const t = timer.getElapsed();
    time.value = t;
    // Sway around the corridor instead of turning away from it; ease toward the pointer
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    spin.rotation.y = baseSpin + Math.sin(t * 0.07) * 0.42 + pointer.x * 0.18;
    tilt.rotation.x = (VIEW_LAT * Math.PI) / 180 + pointer.y * 0.08;
    render();
  };

  // Skip shader warm-up, then take the median of 45 frames (immune to a few long frames while
  // the page boots). Slower than ~22 fps means software rendering or a struggling GPU, where a
  // still globe beats a stuttering page.
  const frameBudgetBlown = (seconds: number) => {
    if (frames.judged) return false;
    if (frames.warmup < 15) {
      frames.warmup++;
      return false;
    }
    frames.samples.push(seconds);
    if (frames.samples.length < SAMPLE_FRAMES) return false;
    frames.judged = true;
    const median = frames.samples.sort((a, b) => a - b)[SAMPLE_FRAMES >> 1] ?? 0;
    if (median < 0.045) return false;
    still = true;
    console.info(`Globe: ${Math.round(median * 1000)} ms per frame, showing a still frame`);
    window.removeEventListener("pointermove", onPointer);
    syncLoop();
    return true;
  };

  let visible = true;
  let running = false;
  const syncLoop = () => {
    const run = visible && !document.hidden && !still;
    if (run && !running) {
      // Pauses must not count as slow frames
      timer.reset();
      if (!frames.judged) Object.assign(frames, { warmup: 0, samples: [] });
    }
    running = run;
    renderer.setAnimationLoop(run ? tick : null);
  };
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    syncLoop();
  });
  intersection.observe(container);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  document.addEventListener("visibilitychange", syncLoop);
  if (!options.reducedMotion) window.addEventListener("pointermove", onPointer, { passive: true });

  resize();
  if (options.reducedMotion) render();
  syncLoop();

  return {
    destroy() {
      renderer.setAnimationLoop(null);
      intersection.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", syncLoop);
      window.removeEventListener("pointermove", onPointer);
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

function landPoints(pixelRatio: number, time: { value: number }) {
  const positions: number[] = [];
  const seeds: number[] = [];
  for (let i = 0; i < LAND_SAMPLES; i++) {
    if (!isLand(i)) continue;
    const [x, y, z] = fibonacciPoint(i, LAND_SAMPLES);
    positions.push(x * 1.002, y * 1.002, z * 1.002);
    seeds.push(hash(i));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("aSeed", new BufferAttribute(new Float32Array(seeds), 1));
  return new Points(
    geometry,
    new ShaderMaterial({
      vertexShader: glsl.landDots.vertex,
      fragmentShader: glsl.landDots.fragment,
      uniforms: {
        uSize: { value: 2.1 },
        uPixelRatio: { value: pixelRatio },
        uTime: time,
        uSun: { value: SUN },
        uColor: { value: new Color("#6f8db5") },
        uCity: { value: new Color("#f7c77f") },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}

/** Deterministic 0..1 noise per index: the same twinkle pattern on every load. */
function hash(i: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function hubPoints(pixelRatio: number, time: { value: number }) {
  const hubs = Object.values(HUBS);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array(hubs.flatMap(([lat, lon]) => fromLatLon(lat, lon).map((c) => c * 1.006))),
      3,
    ),
  );
  geometry.setAttribute(
    "aSeed",
    new BufferAttribute(new Float32Array(hubs.map((_, i) => i / hubs.length)), 1),
  );
  return new Points(
    geometry,
    new ShaderMaterial({
      vertexShader: glsl.hub.vertex,
      fragmentShader: glsl.hub.fragment,
      uniforms: {
        uSize: { value: 26 },
        uPixelRatio: { value: pixelRatio },
        uTime: time,
        uColor: { value: new Color("#f5bf72") },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}

/** Great-circle arc between two hubs, lifted off the surface in proportion to its length. */
function arcMesh(
  from: readonly [number, number],
  to: readonly [number, number],
  offset: number,
  time: { value: number },
) {
  const a = new Vector3(...fromLatLon(...from));
  const b = new Vector3(...fromLatLon(...to));
  const angle = a.angleTo(b);
  const lift = 0.06 + angle * 0.22;
  const points: Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const p = slerp(a, b, angle, t);
    points.push(p.multiplyScalar(1.004 + lift * Math.sin(Math.PI * t)));
  }
  return new Mesh(
    new TubeGeometry(new CatmullRomCurve3(points), 96, 0.007, 6, false),
    new ShaderMaterial({
      vertexShader: glsl.arc.vertex,
      fragmentShader: glsl.arc.fragment,
      uniforms: {
        uTime: time,
        uOffset: { value: offset },
        uColor: { value: new Color("#d99a4c") },
        uHead: { value: new Color("#ffd391") },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}

function slerp(a: Vector3, b: Vector3, angle: number, t: number): Vector3 {
  const s = Math.sin(angle);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * angle) / s)
    .add(b.clone().multiplyScalar(Math.sin(t * angle) / s));
}

function disposeScene(scene: Scene) {
  scene.traverse((object) => {
    if (object instanceof Mesh || object instanceof Points) {
      (object.geometry as BufferGeometry).dispose();
      (object.material as Material).dispose();
    }
  });
}
