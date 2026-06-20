import { createLogger } from "@/lib/observability/logger";

function createMemoryDestination() {
  const writes: string[] = [];

  return {
    writes,
    destination: {
      write(chunk: string) {
        writes.push(chunk);
      },
    },
  };
}

describe("Loopworks logger", () => {
  it("emits structured JSON with service metadata", () => {
    const sink = createMemoryDestination();
    const logger = createLogger(
      {
        level: "info",
      },
      sink.destination,
    );

    logger.info(
      {
        route: "test.route",
      },
      "test_event",
    );

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 30,
      service: "loopworks",
      route: "test.route",
      msg: "test_event",
    });
    expect(entry.time).toEqual(expect.any(String));
  });

  it("redacts common secret and token fields", () => {
    const sink = createMemoryDestination();
    const logger = createLogger(
      {
        level: "info",
        base: null,
      },
      sink.destination,
    );

    logger.info(
      {
        accessToken: "vercel-token",
        access_token: "snake-token",
        client_secret: "oauth-secret",
        headers: {
          Authorization: "Bearer github-token",
        },
        private_key: "github-app-private-key",
        nested: {
          refresh_token: "refresh-token",
          token: "nested-token",
        },
      },
      "redaction_test",
    );

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      accessToken: "[redacted]",
      access_token: "[redacted]",
      client_secret: "[redacted]",
      headers: {
        Authorization: "[redacted]",
      },
      private_key: "[redacted]",
      nested: {
        refresh_token: "[redacted]",
        token: "[redacted]",
      },
    });
  });
});
