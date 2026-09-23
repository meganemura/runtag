import { writeSync } from "node:fs";

export class AgentError extends Error {
  readonly hint: string;
  readonly exitCode: number;

  constructor(message: string, hint: string, exitCode = 1) {
    super(message);
    this.name = "AgentError";
    this.hint = hint;
    this.exitCode = exitCode;
  }
}

export function failureBody(err: AgentError): { error: string; do: string } {
  return { error: err.message, do: err.hint };
}

export function report(err: AgentError): never {
  const internal = process.argv[2] === "__supervise";
  const body = internal
    ? JSON.stringify(failureBody(err))
    : JSON.stringify(failureBody(err), null, 2);
  writeSync(2, `${body}\n`);
  process.exit(err.exitCode);
}

export function printJson(value: unknown): void {
  writeSync(1, `${JSON.stringify(value, null, 2)}\n`);
}
