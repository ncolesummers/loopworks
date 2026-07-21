import { defaultBackend, defineSandbox } from "eve/sandbox";

export default defineSandbox({
  backend: defaultBackend({
    docker: { networkPolicy: "deny-all" },
    microsandbox: { networkPolicy: "deny-all" },
    vercel: { networkPolicy: "deny-all" },
  }),
  description: "Isolated PR-preparation sandbox with deny-all runtime egress.",
});
