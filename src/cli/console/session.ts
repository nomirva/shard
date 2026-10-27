import { ConsoleReporter } from "./reporter";

let active: ConsoleReporter | null = null;

/** One console per command run; errors are rendered through the same instance. */
export function createConsole(verbose = false): ConsoleReporter {
  active = new ConsoleReporter({
    live: Boolean(process.stderr.isTTY) && !process.env.CI,
    verbose,
    columns: () => process.stderr.columns ?? 80,
    rows: () => process.stderr.rows ?? 24,
  });
  return active;
}

export function activeConsole(): ConsoleReporter {
  return active ?? createConsole();
}
