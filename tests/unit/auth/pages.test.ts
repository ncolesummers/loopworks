import { AccessDenied } from "@auth/core/errors";

import { authPages } from "@/lib/auth/pages";

describe("Auth.js page routing", () => {
  it("serves both sign-in and error from the app-owned route", () => {
    expect(authPages.signIn).toBe("/sign-in");
  });

  it("routes Auth.js AccessDenied errors through the app-owned error page", () => {
    const denial = new AccessDenied("allowlist denial");

    expect(denial.type).toBe("AccessDenied");
    expect((denial as unknown as { kind: string }).kind).toBe("error");
    expect(authPages.error).toBe("/sign-in");
  });
});
