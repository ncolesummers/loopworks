import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

export default defineSandbox({
  backend: justbash(),
  description:
    "Planning-only sandbox. Authored CLI inspection runs in the guarded app-runtime tool, so local evals avoid Docker containers.",
});
