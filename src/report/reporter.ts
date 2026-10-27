import type { ReportEvent } from "./events";

export interface Reporter {
  emit(event: ReportEvent): void;
}
