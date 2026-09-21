import type { ProgressSink } from "../utils/progress";

export function createProgressSink(): ProgressSink {
  let drew = false;
  let lastPct = -1;

  const label = (v: { name: string; version: string | null }): string =>
    v.version ? `${v.name} ${v.version}` : v.name;
  const pct = (p: number): string => (p > 0 ? ` [${p}%]` : " …");

  return {
    line(v): void {
      const line = `(${v.index}/${v.total}) ${label(v)}${pct(v.percent)}`;
      if (process.stderr.isTTY) {
        drew = true;
        process.stderr.write(`\r\x1b[2K${line}`);
        return;
      }
      if (!drew || (v.percent > 0 && v.percent - lastPct >= 5)) {
        drew = true;
        lastPct = v.percent;
        process.stderr.write(`${line}\n`);
      }
    },
    end(): void {
      if (drew && process.stderr.isTTY) process.stderr.write("\n");
      drew = false;
    },
  };
}
