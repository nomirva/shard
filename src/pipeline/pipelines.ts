import { Pipeline } from "./pipeline";
import { discover } from "./stages/discover";
import { execute } from "./stages/execute";
import { plan } from "./stages/plan";
import { prepare } from "./stages/prepare";
import { prune } from "./stages/prune";
import { resolve } from "./stages/resolve";

/** Commands are compositions of stages. */

export const buildPipeline = Pipeline.from(discover).pipe(resolve).pipe(prepare).pipe(plan).pipe(execute);

export const updatePipeline = Pipeline.from(discover).pipe(resolve).pipe(prune);
