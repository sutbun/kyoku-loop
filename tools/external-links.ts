import { existsSync, readFileSync } from "node:fs";

// Personal destinations stay outside Git and enter only the private app build.
export function paipuyaURL(
  file = process.env.KYOKULOOP_EXTERNAL_LINKS_FILE ||
    "D:/dev-data/kyoku-loop/private/app/external-links.json",
): string {
  if (!existsSync(file)) return "https://amae-koromo.sapk.ch/";
  const value = JSON.parse(
    readFileSync(file, "utf8").replace(/^\uFEFF/, ""),
  ).paipuya;
  const url = new URL(value);
  if (
    url.origin !== "https://amae-koromo.sapk.ch" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/(?:player\/\d+\/\d+\/?)?$/.test(url.pathname)
  )
    throw new Error("Invalid private paipuya URL");
  return url.href;
}
