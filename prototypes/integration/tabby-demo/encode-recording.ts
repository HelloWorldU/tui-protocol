import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface FrameMetadata {
  readonly file: string;
  readonly timestamp: number;
}

const input = resolve(process.argv[2] ?? ".tmp/tabby-side-by-side-frames");
// Local by default: the raw verification frames include setup output and machine paths.
const output = resolve(process.argv[3] ?? ".tmp/tabby-side-by-side.mp4");
// prepare-ffmpeg.ts extracts the official build here; override with FFMPEG_BIN/FFPROBE_BIN.
const bin = ".tmp/ffmpeg-dist/ffmpeg-n9.0-latest-win64-gpl-9.0/bin";
const ffmpeg = process.env.FFMPEG_BIN ?? resolve(bin, "ffmpeg.exe");
const ffprobe = process.env.FFPROBE_BIN ?? resolve(bin, "ffprobe.exe");
const metadata = JSON.parse(readFileSync(resolve(input, "frames.json"), "utf8")) as FrameMetadata[];
assert(metadata.length > 0, "No screencast frames to encode");
const lines = metadata.map((frame, index) => {
  const next = metadata[index + 1];
  const duration = next === undefined ? 1 : Math.max(0.04, next.timestamp - frame.timestamp);
  const path = resolve(input, frame.file).replaceAll("\\", "/").replaceAll("'", "'\\''");
  return `file '${path}'\nduration ${duration.toFixed(6)}`;
});
lines.push(`file '${resolve(input, metadata.at(-1)!.file).replaceAll("\\", "/").replaceAll("'", "'\\''")}'`);
mkdirSync(dirname(output), { recursive: true });
const playlist = resolve(input, "frames.ffconcat");
writeFileSync(playlist, `${lines.join("\n")}\n`);
execFileSync(ffmpeg, [
  "-y", "-f", "concat", "-safe", "0", "-i", playlist,
  "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
], { stdio: "inherit" });
const probe = JSON.parse(execFileSync(ffprobe, [
  "-v", "error", "-select_streams", "v:0",
  "-show_entries", "stream=codec_name,width,height,nb_frames,duration",
  "-of", "json", output,
], { encoding: "utf8" }));
const video = probe.streams[0];
assert.equal(video.codec_name, "h264");
assert.equal(video.width % 2, 0);
assert.equal(video.height % 2, 0);
assert(Number(video.duration) > 0);
assert(Number(video.nb_frames) > 0);
console.log(JSON.stringify({ video: output, ...video, bytes: statSync(output).size }, null, 2));
