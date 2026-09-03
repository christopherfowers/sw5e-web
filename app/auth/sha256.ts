/**
 * SHA-256, synchronously, over bytes already in memory.
 *
 * ## Why this exists when the platform has one
 *
 * `crypto.subtle.digest` is the right answer nearly everywhere and is the wrong
 * answer here. It is asynchronous per call, and solving a proof-of-work
 * challenge means hashing until a counter produces enough leading zero bits —
 * up to 262,144 hashes at the difficulty the service currently issues. Awaiting
 * a quarter of a million promises spends almost all of its time in the
 * scheduler rather than in the hash, and turns a job of well under a second
 * into one measured in minutes.
 *
 * So this is deliberately a hand-written hash, which is a thing to be nervous
 * about. Two things make it defensible. It is used for exactly one purpose —
 * counting leading zeros on a value the server recomputes and verifies — so a
 * wrong digest cannot forge anything; it can only fail to be accepted. And it
 * is checked against the published vectors, including the empty input, which is
 * the case a partly-correct padding implementation gets wrong.
 *
 * Nothing here is a secret and nothing here is compared against a secret, so
 * there is no timing consideration: the server does the comparing, in constant
 * time, with `CryptographicOperations.FixedTimeEquals`.
 */

/** Round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The message schedule, reused between calls so a hot loop allocates nothing. */
const w = new Uint32Array(64);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * The digest of `message`, as 32 bytes.
 *
 * The working state is local rather than module-level: the schedule above can
 * be shared because it is fully overwritten each block, but the eight hash
 * words cannot, and a caller interleaving two digests would otherwise get two
 * wrong answers and no error.
 */
export function sha256(message: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  /*
    Padding: the 0x80 terminator, then zeros, then the length in bits as a
    64-bit big-endian integer, to the next multiple of 64 bytes. Written into
    one buffer rather than appended to the message so that an input of exactly
    56 bytes — which needs a whole extra block for the length — is handled by
    the same arithmetic as every other size, rather than by a special case
    somebody has to remember.
  */
  const bitLength = message.length * 8;
  const blocks = Math.ceil((message.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(message);
  padded[message.length] = 0x80;

  /*
    The high word of the length is written too. It is zero for anything this
    will ever hash — it would take 512 MB of input to be otherwise — but
    leaving it out is how an implementation ends up correct only for small
    inputs, and the vectors would not catch it.

    Deliberately not covered by a test, and said so rather than left to look
    covered: proving it needs a 512 MB input, which is not a unit test. It was
    checked by removing it and watching the suite stay green, which is the
    honest result and the reason this paragraph exists. It stays because the
    alternative is a function that is quietly wrong for an input somebody may
    one day pass it, and four lines is a cheap price for not having to know
    that it is only correct below half a gigabyte.
  */
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  const lengthAt = padded.length - 8;
  padded[lengthAt] = (high >>> 24) & 0xff;
  padded[lengthAt + 1] = (high >>> 16) & 0xff;
  padded[lengthAt + 2] = (high >>> 8) & 0xff;
  padded[lengthAt + 3] = high & 0xff;
  padded[lengthAt + 4] = (low >>> 24) & 0xff;
  padded[lengthAt + 5] = (low >>> 16) & 0xff;
  padded[lengthAt + 6] = (low >>> 8) & 0xff;
  padded[lengthAt + 7] = low & 0xff;

  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = block + i * 4;
      w[i] =
        ((padded[at] << 24) |
          (padded[at + 1] << 16) |
          (padded[at + 2] << 8) |
          padded[at + 3]) >>>
        0;
    }

    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i += 1) {
    digest[i * 4] = (words[i] >>> 24) & 0xff;
    digest[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    digest[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    digest[i * 4 + 3] = words[i] & 0xff;
  }
  return digest;
}

/** The digest as lowercase hex, for tests and for reading in a console. */
export function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Whether `digest` opens with at least `bits` zero bits.
 *
 * Bits, not hex characters, and not bytes. The service counts bits and the
 * contract says so twice, because getting it wrong is silent: counting hex
 * characters instead asks for sixteen times the work at difficulty 18, and
 * counting bytes asks for a fraction of it and produces solutions the server
 * refuses. Whole bytes are checked first and then the partial byte is masked,
 * which is the case a byte-boundary implementation gets wrong — difficulty 18
 * is two whole bytes and two bits.
 */
export function hasLeadingZeroBits(digest: Uint8Array, bits: number): boolean {
  const wholeBytes = bits >> 3;

  for (let i = 0; i < wholeBytes; i += 1) {
    if (digest[i] !== 0) return false;
  }

  const remainder = bits & 7;
  if (remainder === 0) return true;

  return digest[wholeBytes] >> (8 - remainder) === 0;
}
