import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export const MAX_SOURCE_UNITS = 8192;
export interface TestResult { exitCode: number; output: string }

/** Owns exactly one generated project and serializes reads, edits, and test runs. */
export async function createCodingWorkspace() {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, "tui-pi-coding-"));
  let queue = Promise.resolve();
  let closed = false;
  let runs = 0;
  const lifetime = new AbortController();
  const cleanup = async () => {
    const target = resolve(directory);
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("tui-pi-coding-")) {
      throw new Error("Refusing cleanup outside the allocated coding directory");
    }
    await rm(target, { recursive: true, force: true });
  };
  const serial = <T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (closed) return Promise.reject(new Error("Coding workspace closed"));
    const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
    const result = queue.then(() => { combined.throwIfAborted(); return action(combined); });
    queue = result.then(() => {}, () => {});
    return result;
  };
  try {
    for (const name of ["total.mjs", "total.test.mjs"]) {
      await writeFile(join(directory, name), await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
    }
  } catch (error) { await cleanup(); throw error; }
  return {
    directory,
    read(name: string, signal?: AbortSignal) {
      return serial(async () => {
        if (name !== "total.mjs" && name !== "total.test.mjs") throw new Error("Only total.mjs and total.test.mjs can be read");
        return readFile(join(directory, name), "utf8");
      }, signal);
    },
    replace(oldText: string, newText: string, signal?: AbortSignal) {
      return serial(async active => {
        if (!oldText || oldText.length > MAX_SOURCE_UNITS || newText.length > MAX_SOURCE_UNITS ||
            /[\uD800-\uDFFF]/u.test(oldText + newText)) throw new Error("Invalid replacement text");
        const path = join(directory, "total.mjs");
        const before = await readFile(path, "utf8");
        const start = before.indexOf(oldText);
        if (start < 0 || before.indexOf(oldText, start + 1) >= 0) throw new Error("oldText must match exactly once; read the file again");
        const after = before.slice(0, start) + newText + before.slice(start + oldText.length);
        if (after.length > MAX_SOURCE_UNITS) throw new Error("Edited source exceeds the local size budget");
        active.throwIfAborted();
        await writeFile(path + ".pending", after);
        active.throwIfAborted();
        await rename(path + ".pending", path);
        return `Updated total.mjs (${after.length} UTF-16 units). Run tests to check the change.`;
      }, signal);
    },
    runTests(signal?: AbortSignal, onOutput?: (text: string) => void, timeoutMs = 5000) {
      return serial(async active => {
        if (++runs > 8) throw new Error("Coding test-run budget exceeded");
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Invalid test deadline");
        return new Promise<TestResult>((accept, reject) => {
          // Fixed command, clean environment, and read-only Node permissions for
          // generated files. These guards are not an OS sandbox for hostile code.
          const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${directory}`, "total.test.mjs"], {
            cwd: directory, env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {},
            shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
          });
          let output = "";
          let bytes = 0;
          let failure: Error | undefined;
          const stop = (reason: Error) => {
            failure ??= reason;
            child.kill();
          };
          const abort = () => stop(new Error("Coding tests cancelled"));
          const timer = setTimeout(() => stop(new Error("Coding tests exceeded the deadline")), timeoutMs);
          active.addEventListener("abort", abort, { once: true });
          for (const pipe of [child.stdout, child.stderr]) {
            pipe.setEncoding("utf8");
            pipe.on("data", (part: string) => {
              if (failure) return;
              bytes += Buffer.byteLength(part);
              if (bytes > 16384) { stop(new Error("Coding test output exceeded the local budget")); return; }
              output += part;
              try { onOutput?.(output); } catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
            });
          }
          child.on("error", error => { failure ??= error; });
          child.on("close", code => {
            clearTimeout(timer); active.removeEventListener("abort", abort);
            if (failure) reject(failure);
            else if (code === null) reject(new Error("Coding test process ended without an exit code"));
            else accept({ exitCode: code, output });
          });
          if (active.aborted) abort();
        });
      }, signal);
    },
    async dispose() {
      closed = true; lifetime.abort(); await queue; await cleanup();
    },
  };
}
