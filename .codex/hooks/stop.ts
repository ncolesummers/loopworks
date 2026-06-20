import { buildStopReport, formatHookReport, listChangedFilesFromGit } from "./lib";

const report = buildStopReport(listChangedFilesFromGit());
const output = formatHookReport("LoopWorks stop hook", report);

if (output) {
  console.log(output);
}
