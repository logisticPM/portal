// Pack/unpack a float32 vector to/from a Node Buffer for storage as a DynamoDB
// Binary attribute. Binary (not a Number-list) keeps a 1024-d vector at exactly
// dim×4 bytes; a DynamoDB Number-list would bloat to tens of KB (see spec §4).
export function packF32(v: Float32Array): Buffer {
  const b = Buffer.allocUnsafe(v.length * 4);
  for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i], i * 4);
  return b;
}

// Accepts a Buffer (our writes) or Uint8Array (what DocumentClient returns on read).
export function unpackF32(bytes: Buffer | Uint8Array, dim: number): Float32Array {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = buf.readFloatLE(i * 4);
  return v;
}
