export const sanitizeGitEnvironment = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("GIT_")),
  ) as NodeJS.ProcessEnv;
