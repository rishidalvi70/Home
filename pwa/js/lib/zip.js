// Minimal ZIP reader/writer (no libraries). Writes "stored" (uncompressed) entries - photos and PDFs are already
// compressed - and reads stored or deflate entries, with CRC checks so a damaged backup is detected, not restored.
export class ZipError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes, start = 0) {
  let c = ~start >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function dosDateTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

const toBytes = async (data) => (typeof data === "string" ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()));

/** entries: [{name, data: string | Uint8Array | Blob}] -> Blob (.zip). Names use forward slashes for folders. */
export async function buildZip(entries) {
  if (entries.length > 65000) throw new ZipError("Too many files for one zip.");
  const { time, date } = dosDateTime();
  const parts = [], central = [];
  let offset = 0;
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.name)) throw new ZipError(`Duplicate name in zip: ${e.name}`);
    seen.add(e.name);
    const name = enc.encode(e.name);
    const body = e.data instanceof Blob ? e.data : new Blob([typeof e.data === "string" ? enc.encode(e.data) : e.data]);
    const bytes = await toBytes(e.data);
    const crc = crc32(bytes);
    const size = bytes.length;
    if (size >= 0xffffffff || offset >= 0xffffffff) throw new ZipError("Backup is too large for one zip file.");
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
    local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(local.buffer, name, body);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true); cen.setUint32(20, size, true); cen.setUint32(24, size, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(cen.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

/** Reads the table of contents. Returns {names: [...], read(name) -> Blob}. Throws ZipError on anything unsound. */
export async function readZip(blob) {
  if (blob.size < 22) throw new ZipError("That file is too small to be a zip.");
  const tailLen = Math.min(blob.size, 22 + 65535);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError("Not a zip file (or it is damaged).");
  const count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOffset = u32(tail, eocd + 16);
  if (cdOffset + cdSize > blob.size) throw new ZipError("The zip file is damaged (it is cut short).");
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || u32(cd, p) !== 0x02014b50) throw new ZipError("The zip file is damaged.");
    const flags = u16(cd, p + 8), method = u16(cd, p + 10), crc = u32(cd, p + 16), csize = u32(cd, p + 20), size = u32(cd, p + 24);
    const nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32), local = u32(cd, p + 42);
    if (flags & 1) throw new ZipError("Encrypted zips are not supported.");
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nlen));
    entries.set(name, { method, crc, csize, size, local });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    size: (name) => entries.get(name)?.size,
    async read(name) {
      const e = entries.get(name);
      if (!e) throw new ZipError(`"${name}" is not in the zip.`);
      const head = new DataView(await blob.slice(e.local, e.local + 30).arrayBuffer());
      if (head.byteLength < 30 || u32(head, 0) !== 0x04034b50) throw new ZipError("The zip file is damaged.");
      const start = e.local + 30 + u16(head, 26) + u16(head, 28);
      if (start + e.csize > blob.size) throw new ZipError("The zip file is damaged (it is cut short).");
      let data = blob.slice(start, start + e.csize);
      if (e.method === 8) {
        if (typeof DecompressionStream === "undefined") throw new ZipError("This browser can't open compressed zips.");
        data = await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
      } else if (e.method !== 0) throw new ZipError("This zip uses an unsupported format.");
      if (data.size !== e.size) throw new ZipError(`"${name}" is damaged (wrong size).`);
      if (crc32(new Uint8Array(await data.arrayBuffer())) !== e.crc) throw new ZipError(`"${name}" is damaged (checksum mismatch).`);
      return data;
    },
  };
}
