import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const assetName = "ffmpeg-n9.0-latest-win64-gpl-9.0.zip";
const releaseUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/";
const directory = resolve(".tmp/ffmpeg-dist");
assert.equal(process.platform, "win32", "This helper uses PowerShell Expand-Archive on Windows.");
mkdirSync(directory, { recursive: true });
const checksumResponse = await fetch(`${releaseUrl}checksums.sha256`, {
  headers: { "User-Agent": "tui-protocol-demo" },
});
if (!checksumResponse.ok) throw new Error(`Cannot download FFmpeg checksums: ${checksumResponse.status}`);
const checksums = await checksumResponse.text();
const expected = checksums.split(/\r?\n/).map(line => line.trim().split(/\s+/))
  .find(parts => parts.length === 2 && parts[1] === assetName)?.[0];
assert(expected && /^[0-9a-f]{64}$/.test(expected), `Missing SHA-256 for ${assetName}`);

const archive = resolve(directory, assetName);
const response = await fetch(`${releaseUrl}${assetName}`, {
  headers: { "User-Agent": "tui-protocol-demo" },
});
if (!response.ok) throw new Error(`Cannot download ${assetName}: ${response.status}`);
writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
assert.equal(actual, expected, `SHA-256 mismatch for ${assetName}`);
execFileSync("powershell.exe", [
  "-NoProfile", "-NonInteractive", "-Command",
  `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${directory.replaceAll("'", "''")}' -Force`,
], { stdio: "inherit" });
// The archive extracts into a folder named after it.
const bin = resolve(directory, assetName.replace(/\.zip$/, ""), "bin");
const ffmpeg = resolve(bin, "ffmpeg.exe");
const ffprobe = resolve(bin, "ffprobe.exe");
assert(existsSync(ffmpeg), "ffmpeg.exe is missing after extraction");
assert(existsSync(ffprobe), "ffprobe.exe is missing after extraction");
console.log(JSON.stringify({ ffmpeg, ffprobe, sha256: actual }, null, 2));
