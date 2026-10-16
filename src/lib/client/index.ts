// Client hooks and helpers (ARCHITECTURE section 20.2). Import from "@/lib/client" in client components only.
export { useDebounced } from "./use-debounced";
export { copyText, useCopy } from "./use-copy";
export { MEDIA, useMediaQuery } from "./use-media-query";
export { useJson, type JsonError, type JsonInit, type JsonState } from "./use-json";
export {
  FALLBACK_HEADER_PREFIX,
  fallbackCookieHeaders,
  fallbackHeaderName,
  forgetFallbackCookie,
  readFallbackCookie,
  rememberFallbackCookie,
} from "./embed-cookie";
