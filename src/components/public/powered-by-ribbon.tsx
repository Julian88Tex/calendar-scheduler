// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// PoweredByRibbon (ARCHITECTURE 20.2, SPEC section 8 intro, GEN-01): the diagonal "POWERED BY / {AppName}" band in
// the public card's top-right corner (exact geometry implemented by foundation-ui). Hidden when branding hides it.
import { APP_NAME } from "@/lib/brand";

export type PoweredByRibbonProps = {
  /** Default "/" (the marketing site). */
  href?: string;
  /** Default APP_NAME. */
  appName?: string;
};

export function PoweredByRibbon({ href = "/", appName = APP_NAME }: PoweredByRibbonProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="absolute top-0 right-0 rounded-bl bg-[var(--ribbon)] px-2 py-1 text-center text-white hover:bg-[var(--ribbon-hover)]"
    >
      <span className="block text-[8px] uppercase">Powered by</span>
      <span className="block text-[14px] font-bold">{appName}</span>
    </a>
  );
}
