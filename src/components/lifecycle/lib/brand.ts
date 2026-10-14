// The public pages' primary pill (GEN-03: every blue reads --primary-color), the same classes as booking-pages'
// BRAND_BUTTON. Kept here so the cancel page and the state cards (Server Components too) don't import the booking
// details form module just for a class string, which would pull its phone input and country list into the cancel
// page's JavaScript (GEN-07). Client and server safe.
export const BRAND_PILL = "bg-brand text-white hover:bg-brand hover:brightness-90 active:bg-brand active:brightness-75";
