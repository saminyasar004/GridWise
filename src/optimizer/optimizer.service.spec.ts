import { describe, expect, it } from "vitest";
import { HOURS_PER_DAY, JUDGE_TOLERANCE_KWH } from "../common/constants.js";
import { OptimizerInfeasibleException } from "../common/errors.js";

describe("constants", () => {
  it("exports the 24-hour and tolerance constants", () => {
    expect(HOURS_PER_DAY).toBe(24);
    expect(JUDGE_TOLERANCE_KWH).toBeGreaterThan(0);
  });
  it("exposes an infeasible-exception error type", () => {
    expect(OptimizerInfeasibleException).toBeDefined();
  });
});
