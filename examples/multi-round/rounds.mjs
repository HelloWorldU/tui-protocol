export const ROUND_LIMIT = 3;

// Fixed ASCII fixtures keep this application inside the tested layout scope.
export async function runRound(context, round, pause) {
  const thinking = `thinking-${round}`;
  const answer = `answer-${round}`;
  context.append(`prompt-${round}`, `Round ${round}: inspect a small change`, "sealed");
  let state = context.append(thinking,
    `Thinking ${round}\nGathering context\nComparing candidates\nChecking constraints`, "mutable");
  await pause();
  context.extend(thinking, state, "\nEvidence ready");
  context.append(`tool-${round}`, `Tool ${round}: simulated inspection\nTwo files examined\nNo external service called`, "sealed");
  const prefix = `Answer ${round}: `;
  state = context.append(answer, `${prefix}drafting`, "mutable");
  await pause();
  // Later Blocks already exist: revise earlier thinking without replaying them.
  context.update(thinking, `Thinking ${round}: complete`);
  context.seal(thinking);
  await pause();
  state = context.replaceSuffix(answer, state, prefix.length, "result");
  context.extend(answer, state, "\nThe simulated change is ready.");
  context.seal(answer);
}

export function fallbackTranscript() {
  return "[fallback] Multi-round simulation (non-interactive)\r\n" +
    Array.from({ length: ROUND_LIMIT }, (_, index) =>
      `Round ${index + 1}: simulated inspection complete\r\nAnswer ${index + 1}: result\r\n`).join("");
}
