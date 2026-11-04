import { test, expect } from "@playwright/test";
import { runMortalBatch, validateMortalFiles } from "../src/mortal-batch";

test("batch is sequential, retains durable successes, retries failures only and reports duplicates", async () => {
  const files = ["one.json", "bad.json", "duplicate.json.gz"].map(
    (name) => new File(["{}"], name),
  );
  const seen: string[] = [];
  let active = 0;
  const first = await runMortalBatch(
    files.map((file) => ({ file })),
    async (file) => {
      expect(active++).toBe(0);
      seen.push(file.name);
      await Promise.resolve();
      active--;
      if (file.name === "bad.json") throw Error("invalid_json");
      return {
        id: file.name,
        duplicate: file.name.startsWith("duplicate"),
        linked: true,
      };
    },
  );
  expect(seen).toEqual(files.map((f) => f.name));
  expect(first[1].error).toBe("invalid_json");
  expect(first[0].result?.linked).toBe(true);
  expect(first[2].result?.duplicate).toBe(true);
  const retry = await runMortalBatch(first, async (file) => {
    expect(file.name).toBe("bad.json");
    return { id: file.name, duplicate: false, linked: false };
  });
  expect(retry.every((r) => r.result)).toBe(true);
  expect(first[1].result).toBeUndefined();
});

test("selection rejects oversized batches before registering any files", () => {
  expect(() => validateMortalFiles([])).toThrow();
  expect(() =>
    validateMortalFiles(
      Array.from({ length: 51 }, () => new File(["{}"], "a.json")),
    ),
  ).toThrow("batch_limit");
  expect(() =>
    validateMortalFiles([{ size: 20 * 1024 * 1024 + 1 } as File]),
  ).toThrow("size_limit");
  expect(() =>
    validateMortalFiles(
      Array.from({ length: 6 }, () => ({ size: 20 * 1024 * 1024 }) as File),
    ),
  ).toThrow("batch_limit");
});
