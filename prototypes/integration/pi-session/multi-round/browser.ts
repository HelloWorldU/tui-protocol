import { sendApplicationInput } from "../../../../examples/terminal-host/main.ts";
import { MAX_PROMPT_UNITS, type Command } from "./commands.ts";
import { installNativeChecks } from "./native-checks.ts";
import { installLiveCancelCheck } from "../live-cancel-check.ts";

const form = document.querySelector<HTMLFormElement>("#prompt-form")!;
const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const feedback = document.querySelector<HTMLElement>("#input-status")!;
function send(command: Command): boolean {
  const sent = sendApplicationInput(JSON.stringify(command) + "\n");
  feedback.textContent = sent ? "Sent to application; wait for its round/ready marker. Busy prompts are not queued." : "Not sent: connect first, or reload after a stopped session.";
  return sent;
}
form.onsubmit = event => {
  event.preventDefault();
  if (!prompt.value.trim() || prompt.value.length > MAX_PROMPT_UNITS || /[\uD800-\uDFFF]/u.test(prompt.value)) {
    feedback.textContent = `Enter valid text (at most ${MAX_PROMPT_UNITS} UTF-16 units).`; return;
  }
  // Retain the draft: transport send is not application acceptance.
  send({ type: "prompt", text: prompt.value });
};
document.querySelector<HTMLButtonElement>("#cancel")!.onclick = () => { send({ type: "cancel" }); };
document.querySelector<HTMLButtonElement>("#end")!.onclick = () => { send({ type: "quit" }); };
installNativeChecks();
installLiveCancelCheck(document, "cancel");
