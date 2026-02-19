import { describe, expect, test } from "vitest";
import {
  createToolJobCounts,
  createToolJobQosCounts,
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
    const runningByQos = createToolJobQosCounts();
    runningByQos.realtime = 2;
    const qosCaps = createToolJobQosCounts();
    qosCaps.realtime = 2;
    qosCaps.interactive = 2;
    qosCaps.batch = 1;

    const picked = pickClaimableToolJob(
      [
        { _id: "a", toolName: "search_web" },
        { _id: "b", toolName: "search_products" },
      ],
      running,
      caps,
      runningByQos,
      qosCaps,
    );

    expect(picked?._id).toBe("b");
  });

  test("returns null when all candidate tool partitions are saturated", () => {
    const running = createToolJobCounts(2);
    const caps = createToolJobCounts(2);
    const runningByQos = createToolJobQosCounts(2);
    const qosCaps = createToolJobQosCounts(2);

    const picked = pickClaimableToolJob(
      [
        { _id: "a", toolName: "search_web" },
        { _id: "b", toolName: "search_products" },
      ],
      running,
      caps,
      runningByQos,
      qosCaps,
    );

    expect(picked).toBeNull();
  });

  test("honors qos class priority when multiple classes are available", () => {
    const running = createToolJobCounts();
    const caps = createToolJobCounts(5);
    const runningByQos = createToolJobQosCounts();
    const qosCaps = createToolJobQosCounts(5);

    const picked = pickClaimableToolJob(
      [
        { _id: "a", toolName: "search_global" },
        { _id: "b", toolName: "search_products" },
        { _id: "c", toolName: "search_web" },
      ],
      running,
      caps,
      runningByQos,
      qosCaps,
    );

    expect(picked?._id).toBe("c");
  });

  test("skips qos class when class-level cap is reached", () => {
    const running = createToolJobCounts();
    const caps = createToolJobCounts(5);
    const runningByQos = createToolJobQosCounts();
    runningByQos.realtime = 1;
    const qosCaps = createToolJobQosCounts(5);
    qosCaps.realtime = 1;

    const picked = pickClaimableToolJob(
      [
        { _id: "a", toolName: "search_web" },
        { _id: "b", toolName: "search_products" },
      ],
      running,
      caps,
      runningByQos,
      qosCaps,
    );

    expect(picked?._id).toBe("b");
  });
});
