/// <reference types="vite/client" />

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

/** The app version from package.json, injected by Vite. */
declare const __APP_VERSION__: string;
