import { AgentError } from "./errors.js";

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new AgentError(
      `invalid duration: ${input}`,
      "use an integer plus a unit: ms, s, m, h, or d (examples: 500ms, 30s, 15m, 12h, 7d)",
    );
  }
  const count = Number(match[1]);
  const unit = match[2];
  if (unit === undefined || !Number.isSafeInteger(count)) {
    throw new AgentError(
      `invalid duration: ${input}`,
      "use an integer plus a unit: ms, s, m, h, or d (examples: 500ms, 30s, 15m, 12h, 7d)",
    );
  }
  const ms = count * UNITS[unit]!;
  if (!Number.isSafeInteger(ms)) {
    throw new AgentError(
      `duration is too large: ${input}`,
      "use a shorter duration such as 365d",
    );
  }
  return ms;
}

export function isOlderThan(endedAt: string | null, durationMs: number, now = Date.now()): boolean {
  if (endedAt === null) return false;
  const ended = Date.parse(endedAt);
  if (Number.isNaN(ended)) return false;
  return now - ended >= durationMs;
}
