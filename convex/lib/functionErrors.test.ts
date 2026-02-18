import { describe, expect, test } from "vitest";
import {
  createFunctionError,
  hasFunctionErrorCode,
  parseFunctionError,
} from "./functionErrors";

describe("functionErrors", () => {
  test("creates classified function errors", () => {
    const error = createFunctionError(
      "unauthorized",
      "favorites.createList",
      "Authentication required",
    );
    expect(error.message).toBe(
      "[unauthorized:favorites.createList] Authentication required",
    );
  });

  test("parses classified function errors", () => {
    const parsed = parseFunctionError(
      new Error("[forbidden:threads.remove] Access denied"),
    );
    expect(parsed).toEqual({
      code: "forbidden",
      functionName: "threads.remove",
      message: "Access denied",
    });
  });

  test("detects function error code", () => {
    const err = new Error("[rate_limited:integrations.whatsapp.requestLinkingCode] Slow down");
    expect(hasFunctionErrorCode(err, "rate_limited")).toBe(true);
    expect(hasFunctionErrorCode(err, "forbidden")).toBe(false);
  });

  test("returns null for unclassified errors", () => {
    expect(parseFunctionError(new Error("plain error"))).toBeNull();
  });
});
