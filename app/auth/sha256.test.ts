/**
 * A hand-written hash, checked against the published answers.
 *
 * This is the file that makes `sha256.ts` defensible. Writing a hash by hand is
 * a thing to be nervous about, and the reason it is acceptable here — that a
 * wrong digest cannot forge anything, only fail to be accepted — is an argument
 * about consequences, not a reason to believe it is right. So it is compared
 * against the vectors.
 *
 * The two cases that matter most are the ones a partly-correct implementation
 * passes and fails on: the empty input, whose whole digest comes from the
 * padding, and an input long enough to need two blocks.
 */

import { describe, expect, it } from "vitest";

import { hasLeadingZeroBits, hex, sha256 } from "./sha256";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("sha256", () => {
  it("matches the published vectors", () => {
    expect(hex(sha256(utf8("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hex(sha256(utf8("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      hex(sha256(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  /**
   * Fifty-six bytes is the size that needs a second block for the length alone:
   * the message and its terminator fill the first block exactly, leaving no
   * room for the eight length bytes. An implementation that computes the block
   * count from the message rather than from the message plus nine gets every
   * other size right and this one wrong.
   */
  it("pads an input that leaves no room for its own length", () => {
    expect(hex(sha256(utf8("a".repeat(56))))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    );
  });

  it("hashes a long input across many blocks", () => {
    expect(hex(sha256(utf8("a".repeat(1000))))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });

  it("does not carry state between calls", () => {
    const first = hex(sha256(utf8("abc")));
    sha256(utf8("something else entirely, of a different length"));
    expect(hex(sha256(utf8("abc")))).toBe(first);
  });
});

describe("counting leading zero bits", () => {
  /** A digest built by hand so the expected answer is arithmetic, not a hash. */
  const digest = (...bytes: number[]) => {
    const out = new Uint8Array(32);
    out.set(bytes);
    return out;
  };

  it("counts bits rather than bytes or hex characters", () => {
    // 0x3f is 0011 1111: two leading zero bits, and not a third.
    const two = digest(0x3f);
    expect(hasLeadingZeroBits(two, 2)).toBe(true);
    expect(hasLeadingZeroBits(two, 3)).toBe(false);
  });

  it("handles a boundary that falls inside a byte", () => {
    /*
      Difficulty 18 is two whole zero bytes and two more bits, which is the
      shape the service actually issues. 0x3f has exactly two leading zeros, so
      this is 18 and not 19 — an implementation that rounded up to whole bytes
      would call it 16 and one that rounded down would call it 24.
    */
    const eighteen = digest(0x00, 0x00, 0x3f);
    expect(hasLeadingZeroBits(eighteen, 16)).toBe(true);
    expect(hasLeadingZeroBits(eighteen, 18)).toBe(true);
    expect(hasLeadingZeroBits(eighteen, 19)).toBe(false);
    expect(hasLeadingZeroBits(eighteen, 24)).toBe(false);
  });

  it("accepts a boundary that falls exactly on a byte", () => {
    const sixteen = digest(0x00, 0x00, 0xff);
    expect(hasLeadingZeroBits(sixteen, 16)).toBe(true);
    expect(hasLeadingZeroBits(sixteen, 17)).toBe(false);
  });

  it("is satisfied by anything when nothing is asked", () => {
    expect(hasLeadingZeroBits(digest(0xff), 0)).toBe(true);
  });

  it("refuses when a whole byte early in the digest is not zero", () => {
    expect(hasLeadingZeroBits(digest(0x01, 0x00, 0x00), 16)).toBe(false);
  });
});
