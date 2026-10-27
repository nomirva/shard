import type { Workspace } from "../workspace/workspace";

/** One step of a command: takes the previous phase, returns the next one. */
export interface Stage<I, O> {
  readonly name: string;
  run(input: I, ws: Workspace): O | Promise<O>;
}

/** A typed chain of stages; `pipe` only accepts a stage whose input is the current output. */
export class Pipeline<I, O> {
  private constructor(private readonly stages: readonly Stage<unknown, unknown>[]) {}

  static from<I, O>(stage: Stage<I, O>): Pipeline<I, O> {
    return new Pipeline<I, O>([stage as Stage<unknown, unknown>]);
  }

  pipe<N>(stage: Stage<O, N>): Pipeline<I, N> {
    return new Pipeline<I, N>([...this.stages, stage as Stage<unknown, unknown>]);
  }

  async run(input: I, ws: Workspace): Promise<O> {
    let value: unknown = input;
    for (const stage of this.stages) {
      ws.reporter.stage?.(stage.name);
      value = await stage.run(value, ws);
    }
    return value as O;
  }
}
