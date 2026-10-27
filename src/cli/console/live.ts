import { fit } from "./format";

const FRAME_MS = 80;

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

  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.frame++;
      this.refresh();
    }, FRAME_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

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

  private clear(): void {
    if (this.drawn > 0) this.write(`\x1b[${this.drawn}A\x1b[0J`);
    this.drawn = 0;
  }

  private draw(): void {
    if (!this.enabled) return;
    const lines = this.render(this.frame).map(line => fit(line, this.columns()));
    for (const line of lines) this.write(line + "\n");
    this.drawn = lines.length;
  }
}
