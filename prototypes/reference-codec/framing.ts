import { Buffer } from "node:buffer";

import {
  deserializeMessage,
  MessageCodecError,
  serializeMessage,
  type InvalidMessageIdentity,
  type Message,
} from "./message.ts";

export const OSC_NUMBER = 9002;
export const FRAMING_VERSION = 1;
export const RAW_FRAGMENT_BYTES = 3072;
export const MAX_MESSAGE_BYTES = 1_048_576;
export const MAX_FRAME_INDEX = 341;
export const MAX_OSC_CONTENT_BYTES = 4120;

const ESC = 0x1b;
const BEL = 0x07;
const RIGHT_BRACKET = 0x5d;
const BACKSLASH = 0x5c;
const MAX_INTEGER = 2_147_483_647;
const asciiEncoder = new TextEncoder();
const protocolOscPrefix = String(OSC_NUMBER);
const framePattern = new RegExp(
  `^${OSC_NUMBER};${FRAMING_VERSION};([1-9][0-9]*);` +
    "(0|[1-9][0-9]*);([01]);(.+)$",
);

export interface DecodedMessageEvent {
  readonly type: "message";
  readonly frameId: number;
  readonly message: Message;
}

export interface DecoderErrorEvent {
  readonly type: "error";
  readonly layer: "framing" | "message";
  readonly reason: string;
  readonly identity?: InvalidMessageIdentity;
}

export type DecoderEvent = DecodedMessageEvent | DecoderErrorEvent;

export class FrameCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameCodecError";
  }
}

export function encodeMessageFrames(
  message: Message,
  frameId: number,
): readonly Uint8Array[] {
  requireFrameId(frameId);
  const payload = serializeMessage(message);
  if (payload.length > MAX_MESSAGE_BYTES) {
    throw new FrameCodecError(
      `Serialized Message exceeds ${MAX_MESSAGE_BYTES} bytes.`,
    );
  }

  const frames: Uint8Array[] = [];
  for (let offset = 0, index = 0; offset < payload.length; index += 1) {
    const end = Math.min(offset + RAW_FRAGMENT_BYTES, payload.length);
    const fragment = payload.subarray(offset, end);
    const more = end < payload.length ? 1 : 0;
    const base64 = Buffer.from(fragment).toString("base64");
    frames.push(
      asciiEncoder.encode(
        `\u001B]${OSC_NUMBER};${FRAMING_VERSION};${frameId};${index};${more};${base64}\u001B\\`,
      ),
    );
    offset = end;
  }
  return frames;
}

type ParserState =
  | "ground"
  | "escape"
  | "osc"
  | "oscEscape"
  | "discardOsc"
  | "discardOscEscape";

interface Assembly {
  readonly frameId: number;
  readonly chunks: Uint8Array[];
  nextIndex: number;
  totalBytes: number;
}

interface ParsedFrame {
  readonly frameId: number;
  readonly fragmentIndex: number;
  readonly more: boolean;
  readonly payload: Uint8Array;
}

export class ProtocolStreamDecoder {
  #state: ParserState = "ground";
  #oscContent: number[] = [];
  #discardedProtocolOsc = false;
  #discardReason = "Invalid OSC content.";
  #assembly: Assembly | undefined;

  push(chunk: Uint8Array): readonly DecoderEvent[] {
    const events: DecoderEvent[] = [];
    for (const byte of chunk) {
      this.#consume(byte, events);
    }
    return events;
  }

  finish(): readonly DecoderEvent[] {
    const events: DecoderEvent[] = [];
    if (this.#assembly !== undefined) {
      events.push(framingError("Connection ended during Message assembly."));
    } else if (
      this.#state !== "ground" &&
      (this.#discardedProtocolOsc || isProtocolContent(this.#oscContent))
    ) {
      events.push(framingError("Connection ended during a protocol frame."));
    }
    this.#reset();
    return events;
  }

  #consume(byte: number, events: DecoderEvent[]): void {
    switch (this.#state) {
      case "ground":
        if (byte === ESC) {
          this.#state = "escape";
        } else {
          this.#interruptAssembly(
            "Ordinary terminal data appeared between Message fragments.",
            events,
          );
        }
        return;
      case "escape":
        if (byte === RIGHT_BRACKET) {
          this.#oscContent = [];
          this.#state = "osc";
        } else {
          this.#interruptAssembly(
            "Another terminal control appeared between Message fragments.",
            events,
          );
          this.#state = byte === ESC ? "escape" : "ground";
        }
        return;
      case "osc":
        if (byte === BEL) {
          this.#finishOsc("BEL", events);
        } else if (byte === ESC) {
          this.#state = "oscEscape";
        } else if (this.#oscContent.length === MAX_OSC_CONTENT_BYTES) {
          this.#beginDiscard("OSC content exceeds the frame-size limit.");
        } else {
          this.#oscContent.push(byte);
        }
        return;
      case "oscEscape":
        if (byte === BACKSLASH) {
          this.#finishOsc("ST", events);
        } else {
          this.#abortOsc("OSC contains an invalid control byte.", events);
          if (byte === RIGHT_BRACKET) {
            this.#state = "osc";
          } else {
            this.#state = byte === ESC ? "escape" : "ground";
          }
        }
        return;
      case "discardOsc":
        if (byte === BEL) {
          this.#finishDiscard(events);
        } else if (byte === ESC) {
          this.#state = "discardOscEscape";
        }
        return;
      case "discardOscEscape":
        if (byte === BACKSLASH || byte === BEL) {
          this.#finishDiscard(events);
        } else {
          this.#state = byte === ESC ? "discardOscEscape" : "discardOsc";
        }
    }
  }

  #finishOsc(
    terminator: "ST" | "BEL",
    events: DecoderEvent[],
  ): void {
    const content = this.#oscContent;
    this.#oscContent = [];
    this.#state = "ground";

    if (!isProtocolContent(content)) {
      this.#interruptAssembly(
        "Another OSC sequence appeared between Message fragments.",
        events,
      );
      return;
    }
    if (terminator !== "ST") {
      this.#assembly = undefined;
      events.push(framingError("Protocol frames must use the ST terminator."));
      return;
    }

    try {
      this.#acceptFrame(parseFrame(content), events);
    } catch (error: unknown) {
      this.#assembly = undefined;
      events.push(framingError(toError(error).message));
    }
  }

  #beginDiscard(reason: string): void {
    this.#discardedProtocolOsc = isProtocolContent(this.#oscContent);
    this.#discardReason = reason;
    this.#state = "discardOsc";
  }

  #abortOsc(reason: string, events: DecoderEvent[]): void {
    if (isProtocolContent(this.#oscContent) || this.#assembly !== undefined) {
      events.push(framingError(reason));
    }
    this.#assembly = undefined;
    this.#oscContent = [];
    this.#discardedProtocolOsc = false;
    this.#discardReason = "Invalid OSC content.";
  }

  #finishDiscard(events: DecoderEvent[]): void {
    if (this.#discardedProtocolOsc || this.#assembly !== undefined) {
      events.push(framingError(this.#discardReason));
    }
    this.#assembly = undefined;
    this.#discardedProtocolOsc = false;
    this.#discardReason = "Invalid OSC content.";
    this.#oscContent = [];
    this.#state = "ground";
  }

  #acceptFrame(frame: ParsedFrame, events: DecoderEvent[]): void {
    if (frame.fragmentIndex === 0) {
      if (this.#assembly !== undefined) {
        events.push(
          framingError("A new Message abandoned the incomplete assembly."),
        );
      }
      this.#assembly = undefined;
      if (!frame.more) {
        this.#emitMessage(frame.frameId, frame.payload, events);
        return;
      }
      this.#assembly = {
        frameId: frame.frameId,
        chunks: [frame.payload],
        nextIndex: 1,
        totalBytes: frame.payload.length,
      };
      return;
    }

    const assembly = this.#assembly;
    if (
      assembly === undefined ||
      frame.frameId !== assembly.frameId ||
      frame.fragmentIndex !== assembly.nextIndex
    ) {
      this.#assembly = undefined;
      throw new FrameCodecError(
        "Fragment does not continue the active Message assembly.",
      );
    }

    const totalBytes = assembly.totalBytes + frame.payload.length;
    if (totalBytes > MAX_MESSAGE_BYTES) {
      this.#assembly = undefined;
      throw new FrameCodecError("Message assembly exceeds the byte limit.");
    }
    assembly.chunks.push(frame.payload);
    assembly.totalBytes = totalBytes;
    assembly.nextIndex += 1;

    if (!frame.more) {
      this.#assembly = undefined;
      this.#emitMessage(
        frame.frameId,
        concatenate(assembly.chunks, totalBytes),
        events,
      );
    }
  }

  #emitMessage(
    frameId: number,
    payload: Uint8Array,
    events: DecoderEvent[],
  ): void {
    try {
      events.push({
        type: "message",
        frameId,
        message: deserializeMessage(payload),
      });
    } catch (error: unknown) {
      const event: DecoderErrorEvent = {
        type: "error",
        layer: "message",
        reason: toError(error).message,
      };
      if (error instanceof MessageCodecError && error.identity !== undefined) {
        events.push({ ...event, identity: error.identity });
      } else {
        events.push(event);
      }
    }
  }

  #interruptAssembly(reason: string, events: DecoderEvent[]): void {
    if (this.#assembly === undefined) {
      return;
    }
    this.#assembly = undefined;
    events.push(framingError(reason));
  }

  #reset(): void {
    this.#state = "ground";
    this.#oscContent = [];
    this.#discardedProtocolOsc = false;
    this.#discardReason = "Invalid OSC content.";
    this.#assembly = undefined;
  }
}

function parseFrame(content: readonly number[]): ParsedFrame {
  if (content.some((byte) => byte > 0x7f)) {
    throw new FrameCodecError("Protocol frame content must be ASCII.");
  }
  const text = Buffer.from(content).toString("ascii");
  const match = framePattern.exec(text);
  if (match === null) {
    throw new FrameCodecError("Protocol frame header is invalid.");
  }

  const frameId = parseBoundedInteger(match[1], "frame_id", MAX_INTEGER);
  const fragmentIndex = parseBoundedInteger(
    match[2],
    "fragment_index",
    MAX_FRAME_INDEX,
  );
  const more = match[3] === "1";
  const payload = decodeBase64(match[4]);

  if (payload.length === 0 || payload.length > RAW_FRAGMENT_BYTES) {
    throw new FrameCodecError("Fragment byte length is invalid.");
  }
  if (more && payload.length !== RAW_FRAGMENT_BYTES) {
    throw new FrameCodecError(
      "Every non-final fragment must contain exactly 3072 bytes.",
    );
  }
  if (fragmentIndex === MAX_FRAME_INDEX && more) {
    throw new FrameCodecError("Message exceeds the maximum frame count.");
  }

  return { frameId, fragmentIndex, more, payload };
}

function decodeBase64(text: string): Uint8Array {
  if (
    text.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    )
  ) {
    throw new FrameCodecError("Fragment payload is not canonical Base64.");
  }
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) {
    throw new FrameCodecError("Fragment payload is not canonical Base64.");
  }
  return new Uint8Array(bytes);
}

function parseBoundedInteger(
  text: string,
  name: string,
  maximum: number,
): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new FrameCodecError(`${name} is outside its permitted range.`);
  }
  return value;
}

function requireFrameId(frameId: number): void {
  if (
    !Number.isInteger(frameId) ||
    frameId < 1 ||
    frameId > MAX_INTEGER
  ) {
    throw new FrameCodecError("frameId must be an integer from 1 to 2147483647.");
  }
}

function isProtocolContent(content: readonly number[]): boolean {
  if (content.length < protocolOscPrefix.length) {
    return false;
  }
  for (let index = 0; index < protocolOscPrefix.length; index += 1) {
    if (content[index] !== protocolOscPrefix.charCodeAt(index)) {
      return false;
    }
  }
  return (
    content.length === protocolOscPrefix.length ||
    content[protocolOscPrefix.length] === 0x3b
  );
}

function concatenate(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function framingError(reason: string): DecoderErrorEvent {
  return { type: "error", layer: "framing", reason };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
