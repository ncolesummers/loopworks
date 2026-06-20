import type { Meta, StoryObj } from "@storybook/nextjs";

// ---------------------------------------------------------------------------
// Type samples
// ---------------------------------------------------------------------------

interface TypeSampleProps {
  label: string;
  className: string;
  text?: string;
}

function TypeSample({ label, className, text = "The quick brown fox" }: TypeSampleProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`${className} text-foreground`}>{text}</div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function TypographyShowcase() {
  return (
    <div className="flex flex-col gap-10 p-2">
      {/* Mona Sans — size scale */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Mona Sans — size scale
        </h2>
        <div className="flex flex-col gap-5">
          <TypeSample label="text-3xl / font-bold" className="font-sans text-3xl font-bold" />
          <TypeSample
            label="text-2xl / font-semibold"
            className="font-sans text-2xl font-semibold"
          />
          <TypeSample label="text-xl / font-medium" className="font-sans text-xl font-medium" />
          <TypeSample label="text-lg / font-medium" className="font-sans text-lg font-medium" />
          <TypeSample
            label="text-base / font-normal (400)"
            className="font-sans text-base font-normal"
          />
          <TypeSample label="text-sm / font-normal" className="font-sans text-sm font-normal" />
          <TypeSample label="text-xs / font-normal" className="font-sans text-xs font-normal" />
        </div>
      </section>

      {/* Mona Sans — weight parade */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Mona Sans — weight parade (text-lg)
        </h2>
        <div className="flex flex-col gap-3">
          <TypeSample label="font-light (300)" className="font-sans text-lg font-light" />
          <TypeSample label="font-normal (400)" className="font-sans text-lg font-normal" />
          <TypeSample label="font-medium (500)" className="font-sans text-lg font-medium" />
          <TypeSample label="font-semibold (600)" className="font-sans text-lg font-semibold" />
          <TypeSample label="font-bold (700)" className="font-sans text-lg font-bold" />
        </div>
      </section>

      {/* Monaspace Neon — mono */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Monaspace Neon — monospace
        </h2>
        <div className="flex flex-col gap-3">
          <TypeSample
            label="commit SHA"
            className="font-mono text-sm text-brand"
            text="3fbe197  chore: add markdownlint validation"
          />
          <TypeSample
            label="run log line"
            className="font-mono text-xs text-muted-foreground"
            text="[2026-06-20T14:32:01Z] INFO  loop=deploy-preview step=build status=success duration=4213ms"
          />
          <TypeSample
            label="font-mono / font-normal"
            className="font-mono text-base font-normal"
            text="0123456789 abcdefghijklmnopqrstuvwxyz !@#$%^&*()"
          />
          <TypeSample
            label="font-mono / font-medium"
            className="font-mono text-base font-medium"
            text="function deployLoop(id: string): Promise<RunResult>"
          />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta = {
  title: "Foundations/Typography",
  component: TypographyShowcase,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof TypographyShowcase>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
