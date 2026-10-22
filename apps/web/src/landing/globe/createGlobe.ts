import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
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
import { ribbonGeometry, type RibbonShape } from "./ribbon";
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

const RIBBONS: (RibbonShape & { color: string; tilt: [number, number, number]; spin: number })[] = [
  {
    radius: 1.16,
    width: 0.24,
    twist: 0.32,
    twistWaves: 1,
    swell: 0.22,
    phase: 0.4,
    color: "#e4bb80",
    tilt: [0.32, 0, -0.42],
    spin: 0.07,
  },
  {
    radius: 1.29,
    width: 0.16,
    twist: 0.28,
    twistWaves: 2,
    swell: 0.2,
    phase: 2.1,
    color: "#dfe4ea",
    tilt: [-0.18, 0, 0.62],
    spin: -0.05,
  },
];

// Centre of the view: lat 18°N, lon 28°E puts North Africa, Türkiye and the Gulf in front
const VIEW_LAT = 18;
const VIEW_LON = 28;
const SUN = new Vector3(1, 0.42, 0.62).normalize();
const CAMERA_Z = 5.8;

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

  const pmrem = new PMREMGenerator(renderer);
  const sky = duskSky();
  const environment = pmrem.fromScene(sky, 0, 0.1, 100).texture;
  disposeScene(sky);
  scene.environment = environment;

  const keyLight = new DirectionalLight("#ffd7a3", 2.4);
  keyLight.position.copy(SUN).multiplyScalar(6);
  scene.add(keyLight);

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

  const ribbons = RIBBONS.map((shape) => {
    const holder = new Group();
    holder.rotation.set(...shape.tilt);
    const band = new Mesh(
      ribbonGeometry(shape),
      new MeshPhysicalMaterial({
        color: shape.color,
        metalness: 1,
        roughness: 0.22,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
        envMapIntensity: 1.25,
        side: DoubleSide,
      }),
    );
    holder.add(band);
    tilt.add(holder);
    return { band, speed: shape.spin };
  });

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    // Keep the whole globe and its ribbons in frame on narrow (portrait) containers
    camera.position.z = w < h ? CAMERA_Z * (h / w) * 0.92 : CAMERA_Z;
    camera.updateProjectionMatrix();
    if (options.reducedMotion) render();
  };

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (event: PointerEvent) => {
    pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
  };

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
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    time.value = t;
    // Sway around the corridor instead of turning away from it; ease toward the pointer
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    spin.rotation.y = baseSpin + Math.sin(t * 0.07) * 0.42 + pointer.x * 0.18;
    tilt.rotation.x = (VIEW_LAT * Math.PI) / 180 + pointer.y * 0.08;
    for (const ribbon of ribbons) ribbon.band.rotation.y += ribbon.speed * dt;
    render();
  };

  let visible = true;
  const syncLoop = () => {
    const run = visible && !document.hidden && !options.reducedMotion;
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
      environment.dispose();
      pmrem.dispose();
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

/** Scene for the ribbons' reflections: navy sky, warm sunset toward the key light. */
function duskSky() {
  const sky = new Scene();
  sky.add(
    new Mesh(
      new SphereGeometry(10, 48, 24),
      new ShaderMaterial({
        vertexShader: glsl.envSky.vertex,
        fragmentShader: glsl.envSky.fragment,
        uniforms: {
          uSun: { value: SUN },
          uTop: { value: new Color("#1b3558") },
          uHorizon: { value: new Color("#c48a5a") },
          uGround: { value: new Color("#070f19") },
          uSunColor: { value: new Color("#ffc88a") },
        },
        side: BackSide,
      }),
    ),
  );
  // Soft boxes give the metal its highlights: warm sunset key, white top, faint cool fill
  const boxes: [Color, [number, number, number], number, number][] = [
    [new Color(6, 4.2, 2.6), [7, 2.5, 4.5], 5, 2.2],
    [new Color(2.6, 2.6, 2.7), [-1.5, 8, 2.5], 7, 1.6],
    [new Color(0.7, 0.85, 1.2), [-8, 0.5, 2], 4, 5],
  ];
  for (const [color, position, w, h] of boxes) {
    const box = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ color, side: DoubleSide }),
    );
    box.position.set(...position);
    box.lookAt(0, 0, 0);
    sky.add(box);
  }
  return sky;
}
