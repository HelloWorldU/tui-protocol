import assert from "node:assert/strict";
import test from "node:test";
import headless from "@xterm/headless";
import {
  inspectTabbyXterm,
  readTabbyXtermDependency,
  supportedTabbyXtermDependency,
  TabbyXtermCompatibilityGate,
} from "./compatibility.ts";

const { Terminal } = headless;

function compatibleTerminal(): unknown {
  return {
    cols: 80,
    rows: 24,
    onResize() {},
    onScroll() {},
    write() {},
    _core: {
      _bufferService: {
        buffer: {
          x: 0,
          y: 0,
          ybase: 0,
          ydisp: 0,
          lines: {
            length: 24,
            maxLength: 1024,
            get() {},
            splice() {},
          },
          addMarker() {},
          getBlankLine() {
            return {
              isWrapped: false,
              copyFrom() {},
              translateToString() { return ""; },
            };
          },
        },
        _onScroll: { fire() {} },
      },
    },
  };
}

function removePath(terminal: unknown, path: readonly string[]): void {
  let owner = terminal as Record<string, unknown>;
  for (const field of path.slice(0, -1)) owner = owner[field] as Record<string, unknown>;
  Reflect.deleteProperty(owner, path[path.length - 1]);
}

test("the supported host declaration and actual headless private surface pass inspection", () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 8 });
  try {
    assert.deepEqual(inspectTabbyXterm(terminal, supportedTabbyXtermDependency), { compatible: true });
  } finally {
    terminal.dispose();
  }
});

test("an unsupported or unavailable host xterm declaration is rejected before private access", () => {
  const terminal = new Proxy({}, {
    get() { throw new Error("private internals must not be read"); },
  });
  for (const dependency of ["^6.0.0", undefined]) {
    const result = inspectTabbyXterm(terminal, dependency);
    assert.equal(result.compatible, false);
    assert.match(result.compatible ? "" : result.reason, /dependency/);
  }
});

test("every required private buffer operation is checked", () => {
  const paths = [
    ["_core"],
    ["_core", "_bufferService"],
    ["_core", "_bufferService", "buffer"],
    ["_core", "_bufferService", "buffer", "lines"],
    ["_core", "_bufferService", "buffer", "lines", "get"],
    ["_core", "_bufferService", "buffer", "lines", "splice"],
    ["_core", "_bufferService", "buffer", "addMarker"],
    ["_core", "_bufferService", "buffer", "getBlankLine"],
    ["_core", "_bufferService", "_onScroll"],
    ["_core", "_bufferService", "_onScroll", "fire"],
  ];
  for (const path of paths) {
    const terminal = compatibleTerminal();
    removePath(terminal, path);
    const result = inspectTabbyXterm(terminal, supportedTabbyXtermDependency);
    assert.equal(result.compatible, false, path.join("."));
    assert.match(result.compatible ? "" : result.reason, new RegExp(path[path.length - 1]));
  }
});

test("invalid private cursor state and blank-line operations fail closed", () => {
  const invalidCursor = compatibleTerminal() as any;
  invalidCursor._core._bufferService.buffer.ybase = -1;
  assert.equal(inspectTabbyXterm(invalidCursor, supportedTabbyXtermDependency).compatible, false);

  const invalidBlankLine = compatibleTerminal() as any;
  invalidBlankLine._core._bufferService.buffer.getBlankLine = () => ({ isWrapped: false });
  assert.equal(inspectTabbyXterm(invalidBlankLine, supportedTabbyXtermDependency).compatible, false);
});

test("incompatible attachments do not construct a receiver and only notify once", () => {
  const notifications: string[] = [];
  let constructions = 0;
  const gate = new TabbyXtermCompatibilityGate(reason => notifications.push(reason));
  const attach = (terminal: unknown, dependency: string | undefined) => gate.activate(
    terminal,
    dependency,
    () => {
      constructions += 1;
      return { response: "capability.response" };
    },
  );

  assert.equal(attach({}, "^6.0.0"), undefined);
  assert.equal(attach(compatibleTerminal(), undefined), undefined);
  assert.equal(constructions, 0);
  assert.equal(notifications.length, 1);
  assert.notEqual(attach(compatibleTerminal(), supportedTabbyXtermDependency), undefined);
  assert.equal(constructions, 1);
  assert.equal(notifications.length, 1);
});

test("receiver construction failure also disables activation without repeated notification", () => {
  const notifications: string[] = [];
  const gate = new TabbyXtermCompatibilityGate(reason => notifications.push(reason));
  const activate = () => gate.activate(compatibleTerminal(), supportedTabbyXtermDependency, () => {
    throw new Error("incompatible private implementation");
  });
  assert.equal(activate(), undefined);
  assert.equal(activate(), undefined);
  assert.deepEqual(notifications, ["receiver initialization failed: incompatible private implementation"]);
});

test("the host dependency reader uses Tabby's own package manifest and fails closed", () => {
  assert.equal(readTabbyXtermDependency(id => {
    assert.equal(id, "tabby-terminal/package.json");
    return { devDependencies: { "@xterm/xterm": "^5" } };
  }), "^5");
  assert.equal(readTabbyXtermDependency(() => ({ devDependencies: {} })), undefined);
  assert.equal(readTabbyXtermDependency(() => { throw new Error("not installed"); }), undefined);
});
