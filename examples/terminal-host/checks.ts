import "./style.css";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const results = document.querySelector<HTMLElement>("#results")!;
const example = document.querySelector<HTMLElement>("#example")!;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function text(doc: Document, id: string): string {
  return doc.getElementById(id)?.textContent ?? "";
}
function click(doc: Document, id: string): void {
  const button = doc.getElementById(id) as HTMLButtonElement | null;
  assert(button !== null && !button.disabled, `Button ${id} is unavailable`);
  button.click();
}

// Wait on observable UI changes, not a fixed delay or a second protocol engine.
function until(doc: Document, predicate: () => boolean, description: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      observer.disconnect();
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const inspect = () => {
      if (text(doc, "status").startsWith("Stopped:")) {
        finish(new Error(text(doc, "status")));
      } else if (predicate()) finish();
    };
    const observer = new MutationObserver(inspect);
    const timer = setTimeout(() => finish(new Error(`Timed out: ${description}`)), 15_000);
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
    inspect();
  });
}

async function freshExample(): Promise<Document> {
  example.replaceChildren();
  const frame = document.createElement("iframe");
  frame.title = "Live terminal example under test";
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Example page did not load")), 15_000);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.onerror = () => { clearTimeout(timer); reject(new Error("Example page failed to load")); };
  });
  frame.src = "/";
  example.append(frame);
  await loaded;
  assert(frame.contentDocument !== null, "Example document is unavailable");
  return frame.contentDocument;
}

run.onclick = async () => {
  run.disabled = true;
  results.textContent = "Running…";
  const passed: string[] = [];
  try {
    const completed = await freshExample();
    click(completed, "connect");
    await until(completed, () => text(completed, "status") === "Child exited: 0", "successful child exit");
    const state = text(completed, "report");
    assert(state.includes('thinking: sealed; "Thinking complete"'), "Thinking was not finalized");
    assert(state.includes('answer: sealed; "Result: the example completed."'), "Answer was not retained");
    assert(state.endsWith("Context states before EOF: closed"), "Expected closed Context observation before EOF");
    const query = completed.getElementById("query") as HTMLInputElement;
    query.value = "Result:";
    click(completed, "search");
    assert(text(completed, "search-result") === "Found: Result:", "Final answer was not searchable after exit");
    query.value = "Reading input";
    click(completed, "search");
    assert(text(completed, "search-result") === "No match", "Replaced thinking text remained searchable");
    passed.push("PASS: completed application closes its Context before EOF; final content is searchable and replaced text is absent.");
    results.textContent = passed.join("\n") + "\nChecking early disconnect…";

    const interrupted = await freshExample();
    click(interrupted, "connect");
    await until(interrupted, () => text(interrupted, "report").includes('thinking: mutable; "Thinking"'), "initial mutable thinking Block");
    // Disconnect on observed content, rather than racing an arbitrary sleep.
    click(interrupted, "disconnect");
    await until(interrupted, () => text(interrupted, "status") === "Disconnected; no child exit confirmation.", "disconnect without success confirmation");
    const partial = text(interrupted, "report");
    assert(/Context [^\n]+: closed\n/.test(partial), "EOF did not close the interrupted Context");
    assert(partial.includes('thinking: sealed; "Thinking'), "EOF did not retain and seal partial thinking");
    assert(!partial.includes("answer:") && !partial.includes("Context states before EOF:"), "Interrupted child unexpectedly completed");
    const partialQuery = interrupted.getElementById("query") as HTMLInputElement;
    partialQuery.value = "Result:";
    click(interrupted, "search");
    assert(text(interrupted, "search-result") === "No match", "Interrupted run inherited an answer from the previous run");
    partialQuery.value = "Thinking";
    click(interrupted, "search");
    assert(text(interrupted, "search-result") === "Found: Thinking", "Partial content was not searchable after disconnect");
    passed.push("PASS: disconnect after initial thinking retains partial content without claiming child success or inheriting the previous answer.");
    results.textContent = `${passed.join("\n")}\n2 browser scenarios passed.`;
  } catch (error) {
    results.textContent = `${passed.join("\n")}\nFAIL: ${String(error)}`;
    example.replaceChildren(); // Unload closes a still-running child connection.
  } finally {
    run.disabled = false;
  }
};
