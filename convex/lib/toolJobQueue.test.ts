import { describe, expect, test } from "vitest";
import {
  createToolJobCounts,
  isToolJobName,
  pickClaimableToolJob,
} from "./toolJobQueue";

describe("toolJobQueue", () => {
  test("validates supported tool names", () => {
    expect(isToolJobName("search_web")).toBe(true);
    expect(isToolJobName("search_products")).toBe(true);
    expect(isToolJobName("search_global")).toBe(true);
    expect(isToolJobName("unknown_tool")).toBe(false);
  });

  test("picks first candidate with available running capacity", () => {
    const running = createToolJobCounts();
    running.search_web = 2;
    running.search_products = 0;
    running.search_global = 0;

    const caps = createToolJobCounts();
    caps.search_web = 2;
    caps.search_products = 2;
    caps.search_global = 1;

    const picked = pickClaimableToolJob(
      [
        { _id: "a", toolName: "search_web" },
        { _id: "b", toolName: "search_products" },
      ],
      running,
      caps,
    );

    expect(picked?._id).toBe("b");
  });

  test("returns null when all candidate tool partitions are saturated", () => {
    const running = createToolJobCounts(2);
    const caps = createToolJobCounts(2);

    const picked = pickClaimableToolJob(
      [
        { _id: "a", toolName: "search_web" },
        { _id: "b", toolName: "search_products" },
      ],
      running,
      caps,
    );

    expect(picked).toBeNull();
  });
});
