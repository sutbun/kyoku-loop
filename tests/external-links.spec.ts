import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paipuyaURL } from "../tools/external-links";

test("private paipuya destination accepts player pages and rejects other destinations", () => {
  const folder = mkdtempSync(join(tmpdir(), "kyokuloop-links-"));
  const file = join(folder, "external-links.json");
  try {
    expect(paipuyaURL(file)).toBe("https://amae-koromo.sapk.ch/");
    const valid = "https://amae-koromo.sapk.ch/player/123456/12";
    writeFileSync(file, JSON.stringify({ paipuya: valid }));
    expect(paipuyaURL(file)).toBe(valid);
    for (const paipuya of [
      "javascript:alert(1)",
      "https://amae-koromo.sapk.ch.evil.invalid/player/123456/12",
      "http://amae-koromo.sapk.ch/player/123456/12",
      "https://user:pass@amae-koromo.sapk.ch/player/123456/12",
      "https://amae-koromo.sapk.ch/player/123456/12?extra=1",
      "https://amae-koromo.sapk.ch/api/anything",
    ]) {
      writeFileSync(file, JSON.stringify({ paipuya }));
      expect(() => paipuyaURL(file)).toThrow();
    }
  } finally {
    rmSync(folder, { recursive: true });
  }
});
