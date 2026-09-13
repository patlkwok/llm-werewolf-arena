import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase, type DatabaseConnection } from "@/persistence/database";
import { GameRepository } from "@/persistence/repository";

let connection: DatabaseConnection | null = null;

function databaseFilename(): string {
  const configured =
    process.env.DATABASE_URL?.trim() || "file:./data/llm-werewolf.db";
  const filename = configured.startsWith("file:")
    ? configured.slice("file:".length)
    : configured;
  if (filename === ":memory:") return filename;
  const absolute = resolve(/* turbopackIgnore: true */ process.cwd(), filename);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

export function gameRepository(): GameRepository {
  connection ??= openDatabase(databaseFilename());
  return new GameRepository(connection);
}
