import { buildPromptSubmitReport, formatHookReport, parseHookInput, readStdin } from "./lib";

const input = parseHookInput(await readStdin());
const report = buildPromptSubmitReport(input);
const output = formatHookReport("LoopWorks prompt hook", report);

if (output) {
  console.log(output);
}
