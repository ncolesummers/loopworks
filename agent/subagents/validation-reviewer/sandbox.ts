import { defaultBackend, defineSandbox } from "eve/sandbox";

export default defineSandbox({
  backend: defaultBackend({
    docker: { networkPolicy: "deny-all" },
    microsandbox: { networkPolicy: "deny-all" },
    vercel: { networkPolicy: "deny-all" },
  }),
  description:
    "Isolated read-only review sandbox with a commit-pinned checkout and deny-all runtime egress.",
});
