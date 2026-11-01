export const DEVELOPMENT_VERSION = "DEV-11.02-3";
export const IS_DAILY = import.meta.env?.VITE_KYOKULOOP_DAILY === "1";
export const VERSION = IS_DAILY
  ? DEVELOPMENT_VERSION.replace(/^DEV-/, "")
  : DEVELOPMENT_VERSION;
