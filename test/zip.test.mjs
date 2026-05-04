/* GHG Tool — test ZIP STORE encoder
 *
 * crc32: vettori standard noti (vuoto + ASCII).
 * makeZip: smoke test (signature, end-of-central-directory, decompressi-
 * one con `unzip -l` se disponibile via shell, qui solo struttura).
 */
import { describe, test, expect } from './_runner.mjs';
import { loadSource, resetGHG } from './_load.mjs';

resetGHG();
loadSource('constants.js');
loadSource('calc.js');
loadSource('sanitize.js');
loadSource('io.jsx');
const io = globalThis.GHG.io;

describe('crc32 — vettori noti', () => {
  test('stringa vuota → 0', () => {
    expect(io.crc32(new Uint8Array(0))).toBe(0);
  });
  test('"123456789" → 0xCBF43926', () => {
    const enc = new TextEncoder();
    expect(io.crc32(enc.encode('123456789'))).toBe(0xCBF43926);
  });
  test('"a" → 0xE8B7BE43', () => {
    expect(io.crc32(new TextEncoder().encode('a'))).toBe(0xE8B7BE43);
  });
});

describe('makeZip — struttura ZIP STORE', () => {
  const enc = new TextEncoder();
  const entries = [
    { name: 'a.txt', data: enc.encode('hello') },
    { name: 'b.txt', data: enc.encode('world!') }
  ];
  const zip = io.makeZip(entries);

  test('signature locale 0x04034b50 a offset 0', () => {
    const dv = new DataView(zip.buffer, zip.byteOffset);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
  });
  test('end-of-central-directory in coda (signature 0x06054b50)', () => {
    const dv = new DataView(zip.buffer, zip.byteOffset);
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });
  test('numero entries totale = 2', () => {
    const dv = new DataView(zip.buffer, zip.byteOffset);
    expect(dv.getUint16(zip.length - 22 + 10, true)).toBe(2);
  });
  test('ZIP non vuoto, contiene i bytes di entrambi i file', () => {
    const s = new TextDecoder().decode(zip);
    expect(s.includes('hello')).toBeTruthy();
    expect(s.includes('world!')).toBeTruthy();
    expect(s.includes('a.txt')).toBeTruthy();
    expect(s.includes('b.txt')).toBeTruthy();
  });
});
