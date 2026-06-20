import localFont from "next/font/local";

/**
 * Loopworks typography — GitHub's own OFL typefaces.
 * Mona Sans for UI, Monaspace Neon for IDs / SHAs / run logs.
 * Defined once and shared by the app (`layout.tsx`) and Storybook (`preview`)
 * so previews render with the same fonts as production.
 */

export const monaSans = localFont({
  src: "../app/fonts/MonaSans.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "200 900",
});

export const monaspace = localFont({
  src: "../app/fonts/MonaspaceNeon.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "200 800",
});

/** Combined CSS-variable class names, applied to a root element. */
export const fontVariables = `${monaSans.variable} ${monaspace.variable}`;
