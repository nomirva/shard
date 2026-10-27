export interface InstallProgress {
  readonly name: string;
  readonly version: string | null;
  percent: number;
}

export interface ProgressView {
  name: string;
  version: string | null;
  index: number;
  total: number;
  percent: number;
}

export interface ProgressSink {
  line(view: ProgressView): void;
  end(): void;
}

export interface ProgressMeta {
  name: string;
  version: string | null;
  index: number;
  total: number;
}

const DRAW_INTERVAL_MS = 80;
const DRAW_GRACE_MS = 150;

export async function withProgress<T>(
  sink: ProgressSink | undefined,
  meta: ProgressMeta,
  progress: InstallProgress,
  run: () => Promise<T>,
): Promise<T> {
  let started = false;
  let finished = false;

  const draw = (): void => {
    if (started) sink?.line({ ...meta, percent: progress.percent });
  };
  const ensureStarted = (): void => {
    if (!started && !finished) {
      started = true;
      draw();
    }
  };

  const interval = setInterval(() => {
    if (started) draw();
    else if (progress.percent > 0) ensureStarted();
  }, DRAW_INTERVAL_MS);
  const grace = setTimeout(ensureStarted, DRAW_GRACE_MS);

  try {
    return await run();
  } finally {
    finished = true;
    clearInterval(interval);
    clearTimeout(grace);
    if (started) {
      draw();
      sink?.end();
    }
  }
}
