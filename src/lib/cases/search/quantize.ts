// Quantized representations of the corpus vectors (spec 2026-07-30). The float32 artifact is
// 983MB at 240k×1024d and its load peaks ~3.5GB (three concurrent copies), which OOMs even at the
// account's 3008MB Lambda cap. Binary is 1 bit/dim (30.7MB) for candidate generation; int8 is
// 1 byte/dim (246MB) to rescore the head. DynamoDB keeps the float32 vectors, so nothing is lost.
//
// Both forms assume L2-NORMALIZED input (the embedder is called with normalize:true). That is what
// makes dot == cosine, the sign bit meaningful, and a single global int8 scale correct — every
// component of a unit vector is in [-1, 1], so no per-vector scale table is needed.
export const BITS_PER_BYTE = 8;
const INT8_SCALE = 127;

// Sign-threshold to 1 bit/dim, MSB-first within each byte. Exactly 0 is NOT set (v > 0), which
// matches the "positive" reading and keeps an all-zero vector all-zero.
export function toBinary(v: Float32Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(v.length / BITS_PER_BYTE));
  for (let i = 0; i < v.length; i++) {
    if (v[i] > 0) out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}

// Scalar-quantize to 1 byte/dim with a global scale. Clamped so an out-of-range component (a
// non-normalized vector slipping through) cannot wrap around into the wrong sign.
export function toInt8(v: Float32Array): Int8Array {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const q = Math.round(v[i] * INT8_SCALE);
    out[i] = q > INT8_SCALE ? INT8_SCALE : q < -INT8_SCALE ? -INT8_SCALE : q;
  }
  return out;
}

// popcount lookup — a table beats bit-twiddling here because this runs 240k times per query.
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

// Hamming distance between two packed-bit rows. Offsets are BYTE offsets into each array, so one
// contiguous block can hold every row.
export function hamming(a: Uint8Array, aOff: number, b: Uint8Array, bOff: number, bytes: number): number {
  let d = 0;
  for (let i = 0; i < bytes; i++) d += POPCOUNT[a[aOff + i] ^ b[bOff + i]];
  return d;
}

// Unnormalized int8 dot product. The 1/127² factor is constant across candidates, so this is a
// valid RANKING score and no dequantization is needed.
export function dotInt8(q: Int8Array, block: Int8Array, off: number, dim: number): number {
  let s = 0;
  for (let i = 0; i < dim; i++) s += q[i] * block[off + i];
  return s;
}
