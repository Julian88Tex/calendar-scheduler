// OWNER: foundation-ui.
//
// PublicThemeToggle (owner request, October 16): a sun/moon button on public pages (top right; bottom right on phones,
// clear of the "Powered by" ribbon) that switches between the light and dark public theme. Until it is used the page
// follows the device setting; the choice is kept in the kairos_public_theme cookie (read by the root layout, so the
// next page load has no flash) and set on <html data-public-theme>, which globals.css and DarkReaderLock watch. Rendered by PublicPageShell only when the page
// may be dark (not embedded, no branding background or text colors).
"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyPublicTheme, publicThemeIsDark } from "@/components/shell/theme";
import { cn } from "@/lib/cn";

export function PublicThemeToggle({ className }: { className?: string }) {
  // null until mounted: the server cannot know the device setting, so the icon appears after hydration.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(publicThemeIsDark());
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      data-public-theme-toggle=""
      aria-label={label}
      title={label}
      onClick={() => {
        const next = !publicThemeIsDark();
        applyPublicTheme(next ? "dark" : "light");
        setDark(next);
      }}
      className={cn(
        "fixed right-4 bottom-4 z-40 min-[600px]:top-3 min-[600px]:right-3 min-[600px]:bottom-auto inline-flex size-9 items-center justify-center rounded-full border border-line bg-[var(--public-bg)] text-ink-2 shadow-[var(--shadow-next)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]",
        dark === null && "invisible",
        className,
      )}
    >
      {dark ? <Sun className="size-[18px]" aria-hidden="true" /> : <Moon className="size-[18px]" aria-hidden="true" />}
    </button>
  );
}
