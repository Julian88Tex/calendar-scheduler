// OWNER: foundation-ui.
//
// PoweredByRibbon (ARCHITECTURE 20.2, SPEC section 8 intro, GEN-01, BR-06): the diagonal "POWERED BY / {AppName}" band
// in the public card's top-right corner. Exact geometry: a 105x105 clip box at top -5px, right -5px; a 160px band
// rotated 45 degrees whose inner edge runs corner to corner, fill #505960 (hover #40474C), "POWERED BY" 8px uppercase
// and the app name 14px bold, band shadow 0 2px 4px 0 rgb(0 0 0 / 20%), two 6x6 fold squares where the band wraps the
// card edge; on phones (below 600px, full-bleed card) the box sits flush with the corner and the band moves to top 15px,
// left -5px inside it with a 7px label. Render it inside a `relative` card that does not clip its overflow. Hidden when
// branding hides it (the caller omits it).
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
      aria-label={`Powered by ${appName}`}
      data-testid="powered-by-ribbon"
      className="group absolute -top-[5px] -right-[5px] z-20 block size-[105px] overflow-hidden focus-visible:outline-offset-0 max-[599px]:top-0 max-[599px]:right-0"
    >
      {/* Fold squares: the band seems to wrap around the card's top and right edges. */}
      <span aria-hidden="true" className="absolute top-0 left-0 size-1.5 bg-ribbon max-[599px]:left-6 group-hover:bg-ribbon-hover" />
      <span aria-hidden="true" className="absolute right-0 bottom-0 size-1.5 bg-ribbon max-[599px]:top-[75px] max-[599px]:bottom-auto group-hover:bg-ribbon-hover" />
      <span
        aria-hidden="true"
        className={
          "absolute top-[25px] -left-4 flex h-8 w-40 rotate-45 flex-col items-center justify-center bg-ribbon text-center text-white " +
          "shadow-[0_2px_4px_0_rgb(0_0_0/20%)] transition-colors duration-100 group-hover:bg-ribbon-hover " +
          "max-[599px]:top-[15px] max-[599px]:-left-[5px] max-[599px]:h-7"
        }
      >
        <span className="block text-[8px] leading-[10px] font-bold tracking-[0.5px] uppercase max-[599px]:text-[7px] max-[599px]:leading-[9px]">
          Powered by
        </span>
        <span className="block max-w-[110px] truncate text-[14px] leading-4 font-bold max-[599px]:text-[12px] max-[599px]:leading-[14px]">{appName}</span>
      </span>
    </a>
  );
}
