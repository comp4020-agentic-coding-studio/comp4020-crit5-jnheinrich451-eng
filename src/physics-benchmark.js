// The raycaster comparison. CLAUDE.md §8, stage 3.
//
// Split out of physics.js so that module imports no three.js and the grid
// index stays testable headlessly. This is the only piece that genuinely
// needs a scene, because the whole point is to compare against the renderer's
// own raycaster over the same meshes.

import * as THREE from "three";
import { heightAtIndex } from "./physics.js";

// ── the benchmark (§8) ─────────────────────────────────────────────────────

/**
 * Cast the same rays through the index and through THREE.Raycaster and report
 * both costs and both answers.
 *
 * §8 asks for this to be PRODUCED rather than asserted: the ~2500x figure is
 * the entire justification for not taking a BVH dependency, and an agreement
 * check on the same rays is also the only thing that catches an index which
 * has silently stopped finding triangles.
 */
export function benchmarkIndex(index, meshes, samples = 60) {
  if (!index || !meshes || meshes.length === 0) return null;

  const points = [];
  for (let i = 0; i < samples; i++) {
    // Deterministic spread, so two runs are comparable. No Math.random here:
    // a benchmark that samples different points each run cannot be compared
    // against its own previous number.
    const u = (i * 0.6180339887) % 1;
    const v = (i * 0.7548776662) % 1;
    points.push([
      index.minX + u * (index.maxX - index.minX),
      index.minZ + v * (index.maxZ - index.minZ),
    ]);
  }

  const t0 = now();
  const indexHits = points.map(([x, z]) => heightAtIndex(index, x, z));
  const indexMs = now() - t0;

  const raycaster = new THREE.Raycaster();
  raycaster.far = 200000;
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const t1 = now();
  const rayHits = points.map(([x, z]) => {
    origin.set(x, 100000, z);
    raycaster.set(origin, down);
    const hit = raycaster.intersectObjects(meshes, true)[0];
    return hit ? hit.point.y : null;
  });
  const rayMs = now() - t1;

  let agreed = 0;
  let compared = 0;
  let worst = 0;
  for (let i = 0; i < points.length; i++) {
    if (indexHits[i] === null || rayHits[i] === null) continue;
    compared++;
    const d = Math.abs(indexHits[i] - rayHits[i]);
    if (d > worst) worst = d;
    if (d < 0.5) agreed++;
  }

  const result = {
    samples,
    indexMsPerQuery: indexMs / samples,
    rayMsPerQuery: rayMs / samples,
    speedup: rayMs / Math.max(indexMs, 1e-6),
    compared,
    agreed,
    worstDisagreement: worst,
    indexMisses: indexHits.filter((h) => h === null).length,
    rayMisses: rayHits.filter((h) => h === null).length,
  };

  console.log(
    `terrain index: ${index.triCount.toLocaleString()} tris, ` +
      `${index.nx}x${index.nz} cells @ ${index.cellSize.toFixed(0)} m, ` +
      `${index.perCell.toFixed(1)} per cell, ` +
      `${(index.bytes / 1e6).toFixed(1)} MB, built in ${index.buildMs.toFixed(1)} ms`,
  );
  console.log(
    `terrain query: index ${result.indexMsPerQuery.toFixed(5)} ms vs ` +
      `raycaster ${result.rayMsPerQuery.toFixed(3)} ms -- ` +
      `${result.speedup.toFixed(0)}x faster over ${samples} identical rays`,
  );
  console.log(
    `terrain agreement: ${agreed}/${compared} within 0.5 m ` +
      `(worst ${worst.toFixed(2)} m), index missed ${result.indexMisses}, ` +
      `raycaster missed ${result.rayMisses}`,
  );
  if (compared > 0 && agreed < compared * 0.95) {
    console.error(
      "terrain index DISAGREES with the raycaster -- queries are unreliable",
    );
  }
  return result;
}
