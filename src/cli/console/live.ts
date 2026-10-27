import { fit } from "./format";

const FRAME_MS = 80;

/**
 * Finished lines scroll up; the live lines (spinners) are redrawn in place
 * below them. Disabled outside a TTY: lines are only ever appended.
 */
export class LiveArea {
  private drawn = 0;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly enabled: boolean,
    private readonly write: (s: string) => void,
    private readonly columns: () => number,
    private readonly render: (frame: number) => string[],
  ) {}

  print(text: string): void {
    this.clear();
    this.write(text + "\n");
    this.draw();
  }

  refresh(): void {
    if (!this.enabled) return;
    this.clear();
    this.draw();
  }

  stop(): void {
    this.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private clear(): void {
    if (this.drawn > 0) this.write(`\x1b[${this.drawn}A\x1b[0J`);
    this.drawn = 0;
  }

  private draw(): void {
    if (!this.enabled) return;
    const lines = this.render(this.frame).map(line => fit(line, this.columns()));
    for (const line of lines) this.write(line + "\n");
    this.drawn = lines.length;

    if (lines.length > 0 && !this.timer) {
      this.timer = setInterval(() => {
        this.frame++;
        this.refresh();
      }, FRAME_MS);
      this.timer.unref?.();
    } else if (lines.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
