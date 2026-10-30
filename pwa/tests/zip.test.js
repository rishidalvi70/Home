import test from "node:test";
import assert from "node:assert/strict";
import { ZipError, buildZip, crc32, readZip } from "../js/lib/zip.js";

const text = async (b) => new TextDecoder().decode(await b.arrayBuffer());

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("zip round trip keeps names, folders, unicode and binary data", async () => {
  const binary = new Uint8Array(70000).map((_, i) => (i * 31) % 256);
  const zip = await buildZip([
    { name: "backup.json", data: '{"a":1}' },
    { name: "Room 2/Electricity/2026/Room2_Electricity_2026-10.pdf", data: new Blob([binary], { type: "application/pdf" }) },
    { name: "Personal/₹ café.txt", data: "unicode ✓" },
    { name: "empty.bin", data: new Uint8Array() },
  ]);
  const z = await readZip(zip);
  assert.deepEqual(z.names, ["backup.json", "Room 2/Electricity/2026/Room2_Electricity_2026-10.pdf", "Personal/₹ café.txt", "empty.bin"]);
  assert.equal(await text(await z.read("backup.json")), '{"a":1}');
  assert.deepEqual(new Uint8Array(await (await z.read("Room 2/Electricity/2026/Room2_Electricity_2026-10.pdf")).arrayBuffer()), binary);
  assert.equal(await text(await z.read("Personal/₹ café.txt")), "unicode ✓");
  assert.equal((await z.read("empty.bin")).size, 0);
  await assert.rejects(z.read("nope"), ZipError);
});

test("duplicate names are refused", async () => {
  await assert.rejects(buildZip([{ name: "a", data: "1" }, { name: "a", data: "2" }]), ZipError);
});

test("reads a standard deflate zip made by another tool", async () => {
  const bytes = Uint8Array.from(Buffer.from("UEsDBBQAAAAIAOZqVV2CaDW9HAAAAFIDAAALAAAAYmFja3VwLmpzb26rVspIzcnJV7JSKs8vyklRqq0eFRgVGBUgXwAAUEsDBBQAAAAIAOZqVV1IpriIDwAAAA0AAAAOAAAAcmVjZWlwdHMvNy50eHQrSk1OzSwoUShOLUvNAwBQSwECFAMUAAAACADmalVdgmg1vRwAAABSAwAACwAAAAAAAAAAAAAAgAEAAAAAYmFja3VwLmpzb25QSwECFAMUAAAACADmalVdSKa4iA8AAAANAAAADgAAAAAAAAAAAAAAgAFFAAAAcmVjZWlwdHMvNy50eHRQSwUGAAAAAAIAAgB1AAAAgAAAAAAA", "base64"));
  const z = await readZip(new Blob([bytes]));
  assert.deepEqual(z.names, ["backup.json", "receipts/7.txt"]);
  assert.equal(await text(await z.read("backup.json")), '{"hello":"world"}'.repeat(50));
  assert.equal(await text(await z.read("receipts/7.txt")), "receipt seven");
});

test("damaged zips are detected, not half-read", async () => {
  const good = Buffer.from(await (await buildZip([{ name: "x.txt", data: "important financial data" }])).arrayBuffer());
  const flipped = Buffer.from(good); flipped[30 + 5 + 3] ^= 0xff; // a byte inside the file data
  await assert.rejects(async () => (await readZip(new Blob([flipped]))).read("x.txt"), /checksum mismatch|wrong size/);
  await assert.rejects(readZip(new Blob([good.subarray(0, good.length - 10)])), ZipError); // cut short
  await assert.rejects(readZip(new Blob([Buffer.from("not a zip at all, just text content here")])), ZipError);
  await assert.rejects(readZip(new Blob([new Uint8Array(5)])), ZipError);
});
