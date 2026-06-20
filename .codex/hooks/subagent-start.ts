import { buildSubagentStartReport, formatHookReport } from "./lib";

const report = buildSubagentStartReport();
const output = formatHookReport("LoopWorks subagent hook", report);

if (output) {
  console.log(output);
}
