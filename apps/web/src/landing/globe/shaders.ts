// GLSL for the landing globe. Colors arrive as linear THREE.Color uniforms; every fragment shader
// ends with three's tone-mapping and color-space chunks so it matches the standard materials.

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/** Night ocean: lit from the sunset side, blue rim, faint 15° graticule. */
export const surface = {
  vertex: /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec3 vNormalO;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPosW = world.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vNormalO = normal;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragment: /* glsl */ `
    uniform vec3 uSun;
    uniform vec3 uNight;
    uniform vec3 uDay;
    uniform vec3 uRim;
    uniform vec3 uWarm;
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec3 vNormalO;

    float gridLine(float deg, float step) {
      float d = abs(fract(deg / step + 0.5) - 0.5) * step;
      return 1.0 - smoothstep(0.0, fwidth(deg) * 1.2, d);
    }

    void main() {
      vec3 n = normalize(vNormalW);
      vec3 v = normalize(cameraPosition - vPosW);
      float light = dot(n, uSun);
      vec3 color = mix(uNight, uDay, smoothstep(-0.35, 0.95, light));
      float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      color += uRim * fresnel * 0.35;
      color += uWarm * pow(max(light, 0.0), 4.0) * fresnel * 1.4;
      vec3 h = normalize(uSun + v);
      color += uWarm * pow(max(dot(n, h), 0.0), 80.0) * 0.18;

      vec3 o = normalize(vNormalO);
      float lat = degrees(asin(o.y));
      float lon = degrees(atan(-o.z, o.x));
      float grid = max(gridLine(lat, 15.0), gridLine(lon, 15.0) * (1.0 - smoothstep(70.0, 85.0, abs(lat))));
      color += uRim * grid * 0.07;

      gl_FragColor = vec4(color, 1.0);
      ${OUTPUT}
    }
  `,
};

/** Land as faint steel points; one in nine is a gold "city" light that twinkles. */
export const landDots = {
  vertex: /* glsl */ `
    attribute float aSeed;
    uniform float uSize;
    uniform float uPixelRatio;
    uniform float uTime;
    uniform vec3 uSun;
    varying float vAlpha;
    varying float vCity;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec3 n = normalize(world.xyz);
      vec4 mv = viewMatrix * world;
      float facing = dot(n, normalize(cameraPosition - world.xyz));
      float day = smoothstep(-0.25, 0.6, dot(n, uSun));
      float city = step(0.89, aSeed);
      vCity = city * (0.7 + 0.3 * sin(uTime * 1.3 + aSeed * 90.0));
      float land = 0.2 + 0.28 * day;
      vAlpha = smoothstep(0.0, 0.3, facing) * mix(land, 0.75 + 0.25 * vCity, city);
      gl_PointSize = uSize * uPixelRatio * (1.0 + city * 0.5) * (6.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragment: /* glsl */ `
    uniform vec3 uColor;
    uniform vec3 uCity;
    varying float vAlpha;
    varying float vCity;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float disc = smoothstep(0.5, 0.15, d);
      gl_FragColor = vec4(mix(uColor, uCity, step(0.01, vCity)), disc * vAlpha);
      ${OUTPUT}
    }
  `,
};

/** Soft atmosphere on a back-facing shell: strongest at the limb, zero at its outer edge. */
export const atmosphere = {
  vertex: /* glsl */ `
    varying vec3 vNormalV;
    varying vec3 vNormalW;
    void main() {
      vNormalV = normalize(normalMatrix * normal);
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: /* glsl */ `
    uniform vec3 uCool;
    uniform vec3 uWarm;
    uniform vec3 uSun;
    varying vec3 vNormalV;
    varying vec3 vNormalW;
    void main() {
      float rim = clamp(-vNormalV.z, 0.0, 1.0);
      float glow = pow(smoothstep(0.0, 0.55, rim), 2.2);
      vec3 color = mix(uCool, uWarm, smoothstep(-0.2, 0.9, dot(-vNormalW, uSun)));
      gl_FragColor = vec4(color * glow, glow);
      ${OUTPUT}
    }
  `,
};

/** Trade arc: a faint path with a bright pulse travelling from origin to destination. */
export const arc = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform float uOffset;
    uniform vec3 uColor;
    uniform vec3 uHead;
    varying vec2 vUv;
    void main() {
      float head = fract(uTime * 0.16 + uOffset) * 1.3 - 0.15;
      float d = vUv.x - head;
      float pulse = smoothstep(-0.18, 0.0, d) * (1.0 - smoothstep(0.0, 0.012, d));
      float ends = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
      vec3 color = mix(uColor, uHead, pulse);
      gl_FragColor = vec4(color, (0.3 + 0.7 * pulse) * ends);
      ${OUTPUT}
    }
  `,
};

/** Hub marker: a steady core with a ring that keeps expanding and fading. */
export const hub = {
  vertex: /* glsl */ `
    attribute float aSeed;
    uniform float uSize;
    uniform float uPixelRatio;
    varying float vSeed;
    varying float vFacing;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec4 mv = viewMatrix * world;
      vFacing = smoothstep(0.05, 0.35, dot(normalize(world.xyz), normalize(cameraPosition - world.xyz)));
      vSeed = aSeed;
      gl_PointSize = uSize * uPixelRatio * (6.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    varying float vSeed;
    varying float vFacing;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float core = smoothstep(0.24, 0.08, d);
      float t = fract(uTime * 0.45 + vSeed);
      float ring = smoothstep(0.07, 0.0, abs(d - t)) * (1.0 - t);
      gl_FragColor = vec4(uColor, (core + ring * 0.8) * vFacing);
      ${OUTPUT}
    }
  `,
};
