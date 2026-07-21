import { z } from "zod";

export const screenshotArtifactUriSchema = z
  .string()
  .max(2_048)
  .refine((value) => {
    if (!value.startsWith("artifact://") || value.includes("\\")) return false;
    const segments = value.slice("artifact://".length).split("/");
    return (
      segments.length >= 2 &&
      segments.every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment),
      )
    );
  }, "Unsafe screenshot artifact URI.");
