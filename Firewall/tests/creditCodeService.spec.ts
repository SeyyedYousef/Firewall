import { describe, expect, it } from "vitest";

import { CREDIT_CODE_PREFIX, extractCreditCode, maskCreditCode } from "../server/services/creditCodeService.js";

describe("creditCodeService helpers", () => {
  it("masks credit codes leaving only edges visible", () => {
    const masked = maskCreditCode("FW-ABCD-EFGH-IJKL");
    expect(masked.startsWith("FW-A")).toBe(true);
    expect(masked.endsWith("JKL")).toBe(true);
    expect(masked).toContain("****");
  });

  it("extracts credit codes from arbitrary text", () => {
    const sample = `Here is your code: ${CREDIT_CODE_PREFIX}-ABCD-EFGH-IJKL!`;
    const extracted = extractCreditCode(sample);
    expect(extracted).toBe(`${CREDIT_CODE_PREFIX}-ABCD-EFGH-IJKL`);
  });

  it("ignores messages without a valid code", () => {
    const sample = "No code here!";
    expect(extractCreditCode(sample)).toBeNull();
  });
});
