import { describe, expect, test } from "vitest";
import { classifyResponseStatus } from "./circuitBreaker";

describe("classifyResponseStatus", () => {
  test("treats 2xx and 3xx as success", () => {
    expect(classifyResponseStatus(200)).toBe("success");
    expect(classifyResponseStatus(302)).toBe("success");
  });

  test("treats transient/upstream statuses as failure", () => {
    expect(classifyResponseStatus(408)).toBe("failure");
    expect(classifyResponseStatus(425)).toBe("failure");
    expect(classifyResponseStatus(429)).toBe("failure");
    expect(classifyResponseStatus(500)).toBe("failure");
    expect(classifyResponseStatus(503)).toBe("failure");
  });

  test("treats other 4xx statuses as neutral", () => {
    expect(classifyResponseStatus(400)).toBe("neutral");
    expect(classifyResponseStatus(401)).toBe("neutral");
    expect(classifyResponseStatus(404)).toBe("neutral");
  });
});
