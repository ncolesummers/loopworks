import type { Decorator, Preview } from "@storybook/nextjs";

import "../src/app/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { fontVariables } from "@/lib/fonts";

const withThemeDecorator: Decorator = (Story, context) => {
  const theme = (context.globals.theme as string) ?? "light";
  return (
    <ThemeProvider attribute="class" enableSystem={false} forcedTheme={theme}>
      <div className={`${fontVariables} bg-background text-foreground min-h-screen p-6`}>
        <Story />
      </div>
    </ThemeProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Global color theme",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
      defaultValue: "light",
    },
  },
  decorators: [withThemeDecorator],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
    backgrounds: {
      disable: true,
    },
  },
};

export default preview;
