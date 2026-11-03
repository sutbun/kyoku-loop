/// <reference types="vite/client" />
declare module "virtual:phone-runtime" {
  const manifest: {
    version: string;
    cache: string;
    files: { name: string; url: string; size: number; sha256: string }[];
  };
  export default manifest;
}
