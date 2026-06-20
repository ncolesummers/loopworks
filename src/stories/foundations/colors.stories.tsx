import type { Meta, StoryObj } from "@storybook/nextjs";

// ---------------------------------------------------------------------------
// Swatch primitives
// ---------------------------------------------------------------------------

interface SwatchProps {
  label: string;
  className: string;
  textClass?: string;
}

function Swatch({ label, className, textClass }: SwatchProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`h-12 w-24 rounded-md border ${className}`} />
      <span className={`text-xs ${textClass ?? "text-muted-foreground"}`}>{label}</span>
    </div>
  );
}

interface SwatchRowProps {
  title: string;
  swatches: SwatchProps[];
}

function SwatchRow({ title, swatches }: SwatchRowProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-foreground">{title}</h2>
      <div className="flex flex-wrap gap-4">
        {swatches.map((s) => (
          <Swatch key={s.label} {...s} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Story component
// ---------------------------------------------------------------------------

function ColorPalette() {
  return (
    <div className="flex flex-col gap-8 p-2">
      {/* Neutral ramp */}
      <SwatchRow
        title="Neutral ramp"
        swatches={[
          { label: "background", className: "bg-background" },
          { label: "foreground", className: "bg-foreground" },
          { label: "card", className: "bg-card" },
          { label: "card-foreground", className: "bg-card-foreground" },
          { label: "muted", className: "bg-muted" },
          { label: "muted-foreground", className: "bg-muted-foreground" },
          { label: "secondary", className: "bg-secondary" },
          { label: "accent", className: "bg-accent" },
          { label: "border", className: "bg-border" },
          { label: "primary", className: "bg-primary" },
          { label: "primary-foreground", className: "bg-primary-foreground" },
        ]}
      />

      {/* Brand accent */}
      <SwatchRow
        title="Brand accent"
        swatches={[
          { label: "brand", className: "bg-brand" },
          { label: "brand-foreground", className: "bg-brand-foreground" },
        ]}
      />

      {/* Status: success */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-foreground">Status — Success</h2>
        <div className="flex flex-wrap gap-4">
          <Swatch label="success" className="bg-success" />
          <Swatch label="success-muted" className="bg-success-muted" />
          <div className="flex flex-col gap-1">
            <div className="flex h-12 w-24 items-center justify-center rounded-md border bg-success-muted">
              <span className="text-xs font-medium text-success-foreground">foreground</span>
            </div>
            <span className="text-xs text-muted-foreground">success-foreground</span>
          </div>
          <Swatch label="success-border" className="bg-success-border" />
        </div>
      </section>

      {/* Status: warning */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-foreground">Status — Warning</h2>
        <div className="flex flex-wrap gap-4">
          <Swatch label="warning" className="bg-warning" />
          <Swatch label="warning-muted" className="bg-warning-muted" />
          <div className="flex flex-col gap-1">
            <div className="flex h-12 w-24 items-center justify-center rounded-md border bg-warning-muted">
              <span className="text-xs font-medium text-warning-foreground">foreground</span>
            </div>
            <span className="text-xs text-muted-foreground">warning-foreground</span>
          </div>
          <Swatch label="warning-border" className="bg-warning-border" />
        </div>
      </section>

      {/* Status: danger */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-foreground">Status — Danger</h2>
        <div className="flex flex-wrap gap-4">
          <Swatch label="danger" className="bg-danger" />
          <Swatch label="danger-muted" className="bg-danger-muted" />
          <div className="flex flex-col gap-1">
            <div className="flex h-12 w-24 items-center justify-center rounded-md border bg-danger-muted">
              <span className="text-xs font-medium text-danger-foreground">foreground</span>
            </div>
            <span className="text-xs text-muted-foreground">danger-foreground</span>
          </div>
          <Swatch label="danger-border" className="bg-danger-border" />
        </div>
      </section>

      {/* Status: info */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-foreground">Status — Info</h2>
        <div className="flex flex-wrap gap-4">
          <Swatch label="info" className="bg-info" />
          <Swatch label="info-muted" className="bg-info-muted" />
          <div className="flex flex-col gap-1">
            <div className="flex h-12 w-24 items-center justify-center rounded-md border bg-info-muted">
              <span className="text-xs font-medium text-info-foreground">foreground</span>
            </div>
            <span className="text-xs text-muted-foreground">info-foreground</span>
          </div>
          <Swatch label="info-border" className="bg-info-border" />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta = {
  title: "Foundations/Colors",
  component: ColorPalette,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ColorPalette>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
