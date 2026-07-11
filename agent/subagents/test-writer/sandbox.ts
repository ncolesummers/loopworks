import { defaultBackend, defineSandbox } from "eve/sandbox";

export default defineSandbox({
  backend: defaultBackend({
    docker: { networkPolicy: "deny-all" },
    microsandbox: { networkPolicy: "deny-all" },
    vercel: { networkPolicy: "deny-all" },
  }),
  description:
    "Isolated real-binary test-writing sandbox. Checkout is commit-pinned and egress is disabled before tests run.",
});
