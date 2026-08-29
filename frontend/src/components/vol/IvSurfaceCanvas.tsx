import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { IvSurfacePoint } from "../../types/api.types";

type Props = {
  points: IvSurfacePoint[];
};

const COLS = 20;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function sampleIv(slice: {moneyness: number; iv: number}[], m: number): number | null {
  if (slice.length < 2) return null;
  if (m <= slice[0].moneyness) return slice[0].iv;
  const last = slice[slice.length - 1];
  if (m >= last.moneyness) return last.iv;
  for (let i = 1; i < slice.length; i++) {
    if (m <= slice[i].moneyness) {
      const span = slice[i].moneyness - slice[i - 1].moneyness;
      const t = span > 0 ? (m - slice[i - 1].moneyness) / span : 0;
      return lerp(slice[i - 1].iv, slice[i].iv, t);
    }
  }
  return null;
}

function buildGrid(points: IvSurfacePoint[]) {
  const byExpiry = new Map<string, {ttm: number; rows: {moneyness: number; iv: number}[]}>();
  for (const p of points) {
    const bucket = byExpiry.get(p.expiry) ?? {ttm: p.ttm, rows: []};
    bucket.rows.push({moneyness: p.moneyness, iv: p.iv});
    byExpiry.set(p.expiry, bucket);
  }

  const slices = [...byExpiry.values()]
    .map((s) => ({ttm: s.ttm, rows: s.rows.sort((a, b) => a.moneyness - b.moneyness)}))
    .filter((s) => s.rows.length >= 3)
    .sort((a, b) => a.ttm - b.ttm);

  if (slices.length < 2) return null;

  const mMin = Math.max(0.7, Math.min(...slices.flatMap((s) => s.rows.map((r) => r.moneyness))));
  const mMax = Math.min(1.3, Math.max(...slices.flatMap((s) => s.rows.map((r) => r.moneyness))));
  const moneyness = Array.from({length: COLS}, (_, i) => mMin + (i / (COLS - 1)) * (mMax - mMin));

  const values: (number | null)[][] = slices.map((slice) =>
    moneyness.map((m) => sampleIv(slice.rows, m))
  );

  const ivs = values.flat().filter((v): v is number => v != null);
  if (ivs.length < 8) return null;

  return {
    moneyness,
    ttms: slices.map((s) => s.ttm),
    values,
    ivMin: Math.min(...ivs),
    ivMax: Math.max(...ivs),
  };
}

function colorForIv(iv: number, ivMin: number, ivMax: number) {
  const t = (iv - ivMin) / (ivMax - ivMin || 1);
  const color = new THREE.Color();
  color.setHSL((220 * (1 - t)) / 360, 0.75, 0.5);
  return color;
}

function toVec(m: number, ttm: number, iv: number) {
  return new THREE.Vector3((m - 1) * 8, iv * 6, ttm * 5);
}

export function IvSurfaceCanvas({ points }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const grid = useMemo(() => buildGrid(points), [points]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !grid) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e293b);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
    camera.position.set(6, 4.5, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1.2, 1.5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(4, 8, 6);
    scene.add(key);

    const {moneyness, ttms, values, ivMin, ivMax} = grid;
    const rows = ttms.length;
    const cols = moneyness.length;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const iv = values[r][c] ?? values[r].find((v) => v != null) ?? ivMin;
        const v = toVec(moneyness[c], ttms[r], iv);
        positions.push(v.x, v.y, v.z);
        const color = colorForIv(iv, ivMin, ivMax);
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        flatShading: true,
      })
    );
    scene.add(mesh);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.35 })
    );
    scene.add(wire);

    const axes = new THREE.AxesHelper(1.2);
    axes.position.set(-3.2, 0, 0);
    scene.add(axes);

    const gridHelper = new THREE.GridHelper(10, 10, 0x334155, 0x334155);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    const resize = () => {
      const width = host.clientWidth || 640;
      const height = host.clientHeight || 420;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      geometry.dispose();
      mesh.material.dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [grid]);

  if (!grid) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-xl bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)]">
        Not enough strikes/expiries to mesh a surface
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)]">IV surface</h2>
      <p className="mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
        X = K/S (moneyness) · Y = implied vol · Z = time to expiry. Drag to orbit.
      </p>
      <div ref={hostRef} className="h-[28rem] overflow-hidden rounded-lg" />
    </div>
  );
}
