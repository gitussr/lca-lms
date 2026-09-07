/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base path prepended to every API request. Defaults to `/api/v1`. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
