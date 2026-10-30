// Turns a photo or PDF the user picked into something safe to store: checks it is really that kind of file,
// and shrinks big camera photos so a year of receipts doesn't fill the phone.
import { ALLOWED_TYPES, MAX_FILE_BYTES, fileProblem, formatSize } from "../domain/receipts.js";

const MAX_SIDE = 2000;
const SHRINK_ABOVE = 500 * 1024;

async function sniffPdf(file) {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

async function decode(file) {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

function toJpeg(bitmap, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // transparent PNGs become white, not black
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

/**
 * -> {blob, mime, filename, size}. Throws Error with a plain-English message if the file can't be used.
 * Photos are decoded (proving they really are images) and large ones are re-saved as smaller JPEGs.
 */
export async function prepareReceipt(file) {
  const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
  const problem = fileProblem({ size: file.size, type });
  if (problem) throw new Error(`${file.name || "File"}: ${problem}`);
  if (type === "application/pdf") {
    if (!(await sniffPdf(file))) throw new Error(`${file.name}: this doesn't look like a real PDF.`);
    return { blob: file, mime: type, filename: file.name, size: file.size };
  }
  let bitmap;
  try { bitmap = await decode(file); }
  catch { throw new Error(`${file.name}: this image can't be read. Try taking a photo again or saving it as JPEG.`); }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (file.size <= SHRINK_ABOVE && scale === 1) return { blob: file, mime: type, filename: file.name, size: file.size };
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const jpeg = await toJpeg(bitmap, w, h);
    if (jpeg && jpeg.size < file.size) return { blob: jpeg, mime: "image/jpeg", filename: file.name.replace(/\.[^.]+$/, "") + ".jpg", size: jpeg.size };
    return { blob: file, mime: type, filename: file.name, size: file.size };
  } finally { bitmap.close?.(); }
}

export { ALLOWED_TYPES, MAX_FILE_BYTES, formatSize };
