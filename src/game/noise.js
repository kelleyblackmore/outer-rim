// noise.js — seeded 2D value noise + FBM. Shared by terrain meshes AND terrain
// collision, so the flyable surface and the visible surface always agree.
export function makeNoise(seed = 1) {
  // integer hash → [0,1)
  function hash(ix, iz) {
    let h = ix * 374761393 + iz * 668265263 + seed * 144665461;
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const smooth = t => t * t * (3 - 2 * t);

  function noise2(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    const u = smooth(fx), v = smooth(fz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;   // 0..1
  }

  function fbm(x, z, octaves = 4, lac = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise2(x * freq, z * freq);
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return sum / norm;   // 0..1
  }

  // ridged noise: sharp crests, good for mesas and lava channels
  function ridge(x, z, octaves = 4) {
    let amp = 0.5, freq = 1, sum = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise2(x * freq, z * freq) * 2 - 1);
      sum += n * n * amp;
      amp *= 0.5; freq *= 2.1;
    }
    return sum;   // ~0..1
  }

  return { noise2, fbm, ridge, hash };
}
