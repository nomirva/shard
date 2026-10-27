import type { DeclaredTarget } from "../../target/target";
import type { Stage } from "../pipeline";

/** Reads the root module's manifest. */
export const discover: Stage<void, DeclaredTarget> = {
  name: "discover",
  run: (_input, ws) => ws.declareRoot(),
};
