#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ZodError } from "zod";
import { registerAckCommand } from "./commands/ack.js";
import { registerCloseCommand } from "./commands/close.js";
import { registerJoinCommand } from "./commands/join.js";
import { registerOpenCommand } from "./commands/open.js";
import { registerSendCommand } from "./commands/send.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerWatchCommand } from "./commands/watch.js";

const program = new Command();
const talkProgram = new Command("talk");

program
  .name("spark")
  .description("Spark CLI")
  .version(resolveVersion());

talkProgram.description("Local SQLite broker for relaying turns between agents");
registerStartCommand(talkProgram);
registerOpenCommand(talkProgram);
registerJoinCommand(talkProgram);
registerCloseCommand(talkProgram);
registerAckCommand(talkProgram);
registerSendCommand(talkProgram);
registerWatchCommand(talkProgram);
registerStatusCommand(talkProgram);
program.addCommand(talkProgram);

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => issue.message).join("; ");
    console.error(`Validation error: ${details}`);
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(error.message);
    process.exit(1);
  }

  console.error("Unknown error");
  process.exit(1);
});

function resolveVersion(): string {
  try {
    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(cliDir, "../package.json");
    const raw = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: string;
    };
    if (typeof raw.version === "string" && raw.version.length > 0) {
      return raw.version;
    }
  } catch {
    // fall through
  }

  return "0.0.0";
}
