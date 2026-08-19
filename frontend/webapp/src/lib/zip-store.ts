function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function u32(n: number): Uint8Array {
  return new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipFile = { name: string; bytes: Uint8Array };

/** Uncompressed ZIP (STORE) suitable for Day One JSON import. */
export function buildZipBlob(files: ZipFile[]): Blob {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name.replace(/\\/g, "/"));
    const crc = crc32(f.bytes);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.bytes.length),
      u32(f.bytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      f.bytes,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(f.bytes.length),
        u32(f.bytes.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += local.length;
  }
  const central = concat(centrals);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  const packed = concat([...locals, central, eocd]);
  return new Blob([packed as unknown as BlobPart], { type: "application/zip" });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can’t unpack compressed zip files.");
  }
  const copy = new Uint8Array(data);
  const stream = new Blob([copy as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Read a zip (STORE or deflate) into named files. Directories are skipped. */
export async function readZipArchive(buf: ArrayBuffer): Promise<ZipFile[]> {
  const u8 = new Uint8Array(buf);
  const view = new DataView(buf);
  let eocd = -1;
  const min = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That doesn’t look like a zip file.");
  const count = view.getUint16(eocd + 10, true);
  const cdOff = view.getUint32(eocd + 16, true);
  const files: ZipFile[] = [];
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) {
      throw new Error("The zip file is damaged.");
    }
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/")) continue;
    const locNameLen = view.getUint16(localOff + 26, true);
    const locExtra = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + locNameLen + locExtra;
    const compressed = u8.subarray(dataStart, dataStart + compSize);
    let bytes: Uint8Array;
    if (method === 0) {
      bytes = compressed.slice();
    } else if (method === 8) {
      bytes = await inflateRaw(compressed);
    } else {
      throw new Error(`Can’t unpack “${name}” (compression ${method}).`);
    }
    files.push({ name, bytes });
  }
  return files;
}
