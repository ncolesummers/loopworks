import { buildPreToolUseReport, formatHookReport, parseHookInput, readStdin } from "./lib";

const input = parseHookInput(await readStdin());
const report = buildPreToolUseReport(input);
const output = formatHookReport("LoopWorks pre-edit hook", report);

if (output) {
  console.log(output);
}

if (report.blocked.length > 0) {
  process.exitCode = 2;
}
