import { Task } from "./task";

/** A task with no action of its own: `assemble`, `build`. It only gathers dependencies. */
export class LifecycleTask extends Task {
  run(): void {}
}
