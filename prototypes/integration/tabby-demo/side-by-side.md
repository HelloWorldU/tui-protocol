# Stock and protocol side-by-side demonstration

## What is being demonstrated

One real Pi 0.87.1 `AgentSessionRuntime` drives two `InteractiveMode` views in
Tabby 1.0.238. The stock view renders Pi's original transcript components and
receives no external input. The protocol view receives input and places its
transcript in protocol Blocks while retaining Pi's editor and footer. The tool
runs once: the controller reports `toolCalls=1`. These are not two independent
Pi sessions.

The stock view uses the existing `TrialTerminal` interface because Pi's
`ProcessTerminal` reads process stdin/stdout directly and cannot be attached to
two independent byte streams. This does not change Pi's stock component
rendering. It is not a claim that the transport is `ProcessTerminal`; the
existing fallback check with that class remains separate. The protocol view
uses the normal SDK capability exchange and the Tabby receiver.

## Recorded evidence, 2026-10-27

The machine report the driver writes locally
(`.tmp/tabby-side-by-side-report.json`) records the following observations
from the completed run:

| Observation | Stock view | Protocol view |
| --- | --- | --- |
| Runtime and tool execution | Same runtime; one tool call | Same runtime; one tool call |
| Earlier tool progress | `Reading sample...` remains once | Replaced by the final tool result; zero occurrences |
| Complete answer in this run | One complete answer | One complete answer and one final Block |
| Closed protocol state | No protocol frames or Contexts | One closed Context, four sealed Blocks |
| Reading row after the tool update | 119, still visible | 4, still visible |
| Resize | Real PTY and xterm resize to 36 and 60 columns | Same dimensions; word wrapping and hanging indentation adapt, reading row 4 remains visible |
| Search | The final logical substring is found | The final substring is found; obsolete progress has no match |
| Copy | The final substring is selected | `mutable history keeps old output` is returned by Tabby's clipboard boundary |

The recording uses an in-memory clipboard substitute at
`frontend.platformService.setClipboard`; it does not read or overwrite the OS
clipboard. A previous obsolete-progress search clears the selection, so the
check selects the final result again before copying, matching a normal
search-then-copy workflow.

These are observations from this fixture, not a claim that every stock frame
duplicates or loses content. The assertions require the protocol result and
User Block to appear once, the historical reading position to remain visible,
and the final search/copy to use the updated logical text. Stock outcomes are
recorded rather than assumed to be identical or inferior in every case.

## Reproduce

From the repository root on Windows with Node.js 24+ and pnpm 11.9.0:

```sh
pnpm install
pnpm build:tabby-demo
ROOT=$(pwd -W)
mkdir -p .tmp/tabby-config-pair .tmp/tabby-user-data-pair
TABBY_CONFIG_DIRECTORY="$ROOT/.tmp/tabby-config-pair" \
TABBY_PLUGINS="$ROOT/.tmp/tabby-demo-plugin" \
.tmp/tabby-1.0.238/Tabby.exe --remote-debugging-port=9222 --disable-gpu \
  --user-data-dir="$ROOT/.tmp/tabby-user-data-pair"
```

In another shell, with the Tabby window visible:

```sh
node prototypes/integration/tabby-demo/side-by-side-check.ts
```

The driver creates the split and controller tabs, starts `pair-main.ts`, reads
the random per-run token, and starts the two channel clients. It then submits
the fixed prompt through the protocol client, scrolls to historical content,
waits for the tool update, resizes both PTYs, searches, and copies. It also
writes the report and timestamped JPEG frames.

To regenerate the MP4:

```sh
node prototypes/integration/tabby-demo/prepare-ffmpeg.ts
node prototypes/integration/tabby-demo/encode-recording.ts
```

`prepare-ffmpeg.ts` downloads the BtbN `ffmpeg-n9.0-latest-win64-gpl-9.0.zip`
build linked by the official FFmpeg download page and verifies the published
`checksums.sha256` before extraction. The binary stays under `.tmp`; no ffmpeg
package or binary is added to the repository. `FFMPEG_BIN` and `FFPROBE_BIN`
can be set to an existing installation instead. `encode-recording.ts` uses the
frame timestamps, writes H.264 with even dimensions and fast-start metadata,
and checks the result with ffprobe.

## Recording status

The 2026-10-27 run produced a verification recording (244 frames, about 12
seconds, H.264, written to `.tmp/tabby-side-by-side.mp4`). It is not
committed and is not a presentation video: the frames include the launch
commands and patch report, many leftover tabs from earlier attempts, local
machine paths, and, toward the end, stacked `Working` spinner rows in both
views while the final answer is scrolled out of view. A presentation
recording needs a clean Tabby profile, a single split with no setup output
on screen, framing that keeps the compared rows visible, and a check of the
repeated `Working` rows before it is published.

## Implementation and limits

- `pair-main.ts` owns one runtime, local WebSocket host, and lifecycle.
- `paired.ts` constructs the two views and scopes the render gate to the
  renderer's synchronous `doRender` entry. The separate `withRenderGate`
  restores the previous value after each call, including failures.
- `pair-transport.ts` waits for both role handshakes, forwards binary output,
  accepts input only from protocol, and forwards real PTY resize messages.
- `channel-client.ts` is a small shell-side byte forwarder, not a second Pi
  session or a protocol implementation.
- `side-by-side-check.ts` drives Tabby through CDP and captures the frames.
  `prepare-ffmpeg.ts` verifies the encoder; `encode-recording.ts` produces and
  probes the actual video.

The fixture uses only the deterministic local provider, one read-only sample
tool, and a temporary working directory. It does not use a model subscription,
credentials, repository tools, session replacement, compaction, or a production
plugin API. Renderer wrapping is pin-specific experimental composition, not an
upstream Pi integration. The 36/60-column checks are explicit PTY and xterm
geometries, not a claim about exact pane pixel widths. No long-session,
clipboard-OS, or cross-platform behavior is inferred from this recording.
