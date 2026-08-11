import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SignInView } from "@/components/auth/sign-in-view";
import { signInErrorNotices, signInFallbackNotice } from "@/lib/auth/sign-in-errors";

/**
 * The action is a no-op here. The real one is a `"use server"` module that pulls Auth.js, the
 * Drizzle adapter, and the Postgres client with it, none of which can exist in a browser bundle.
 */
const meta = {
  title: "Portal/Shell/SignIn",
  component: SignInView,
  args: {
    action: async () => {},
    callbackUrl: "/",
  },
} satisfies Meta<typeof SignInView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The allowlist denial: the state this surface exists to render honestly. */
export const AccessDenied: Story = {
  args: { notice: signInErrorNotices.AccessDenied },
};

export const ProviderFailed: Story = {
  args: { notice: signInErrorNotices.OAuthCallbackError },
};

export const AccountNotLinked: Story = {
  args: { notice: signInErrorNotices.OAuthAccountNotLinked },
};

export const RequestExpired: Story = {
  args: { notice: signInErrorNotices.MissingCSRF },
};

export const ServerUnavailable: Story = {
  args: { notice: signInErrorNotices.Configuration },
};

/** Any error code outside the closed map, including one an operator typed themselves. */
export const UnrecognizedFailure: Story = {
  args: { notice: signInFallbackNotice },
};
