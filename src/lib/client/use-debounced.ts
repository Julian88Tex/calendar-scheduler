// useDebounced (ARCHITECTURE section 20.2): the value after it stopped changing for `delayMs`. Client components only.
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
