import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    githubLogin?: string | null;
  }

  interface Session {
    user: {
      id?: string | null;
      githubLogin?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/types" {
  interface User {
    githubLogin?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubLogin?: string | null;
  }
}
