#!/usr/bin/env bun

import { spawn } from "node:child_process";
import net from "node:net";

const host = "127.0.0.1";
const appPort = 3000;
const storybookPort = 6006;

const commands = [
  {
    args: ["run", "dev:fixture"],
    label: "fixture app",
    url: `http://${host}:${appPort}`,
    port: appPort,
  },
  {
    args: ["run", "storybook", "--", "--host", host, "--no-open"],
    label: "Storybook",
    url: `http://${host}:${storybookPort}`,
    port: storybookPort,
  },
];

const usage = "Usage: bun run review:ui [--dry-run]";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const unknownArgs = args.filter((arg) => arg !== "--dry-run");

const commandText = (commandArgs) => `bun ${commandArgs.join(" ")}`;

const printReviewTargets = (heading) => {
  console.log(heading);
  console.log(`App: ${commands[0].url}`);
  console.log(`Storybook: ${commands[1].url}`);
  console.log("Commands:");

  for (const command of commands) {
    console.log(`- ${commandText(command.args)}`);
  }
};

const assertPortAvailable = (port) => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", () => {
      reject(new Error(`Port ${port} is already in use on ${host}. Stop that process and retry.`));
    });

    server.listen({ host, port }, () => {
      server.close(resolve);
    });
  });
};

if (unknownArgs.length > 0) {
  console.error(`Unknown argument: ${unknownArgs[0]}`);
  console.error(usage);
  process.exit(1);
}

if (dryRun) {
  printReviewTargets("LoopWorks UI review dry run");
  process.exit(0);
}

try {
  await Promise.all(commands.map((command) => assertPortAvailable(command.port)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

printReviewTargets("LoopWorks UI review servers");

const children = commands.map((command) => {
  return spawn("bun", command.args, {
    env: process.env,
    stdio: "inherit",
  });
});

let stopping = false;

const stopChildren = (signal = "SIGTERM") => {
  stopping = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
};

process.on("SIGINT", () => {
  stopChildren("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
  process.exit(143);
});

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }

    stopChildren();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
