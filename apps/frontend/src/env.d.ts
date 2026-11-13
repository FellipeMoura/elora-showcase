/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORE_PORT?: string;
  readonly VITE_CHAT_PORT?: string;
  readonly VITE_CORE_URL?: string;
  readonly VITE_CHAT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
