# Calendly UX and Visual Walkthrough (2025-2026 web app)

Research date: 2026-10-11. Purpose: give every feature agent a screen-by-screen reference so the clone feels like the exact same product. Read the "Design language" section first, then the screens you own.

## 0. How to read this document

Confidence tags used throughout:

- **[V]** Verified in October 2026 from Calendly Help Center articles, the live public booking page DOM, or Calendly's production booking CSS (`assets.calendly.com/assets/booking/css/booking-*.css`). Copy in quotes with [V] is exact.
- **[M]** From product memory, tutorials, reviews and secondary sources. Layout is reliable, exact wording may differ slightly. Use it, but do not treat the string as sacred.

Two UI generations exist right now:

1. **Classic (2023-2025, still the default for most accounts and every public booking page in Oct 2026)**: left sidebar with Scheduling, Meetings, Availability, Contacts, Workflows, Integrations & apps, Routing, Analytics, Admin center, Help. Proxima Nova, navy text, `#006BFF` blue, pill buttons.
2. **"New Calendly" refresh (rolling out mid 2026, opt-in then forced after 7 days)** [V]: Meetings renamed to **Calendar**, Workflows renamed to **Automations**, Routing forms moved into Scheduling as a tab, Availability and admin moved into a single **Settings** area, profile menu moved to the top-left, Light/Dark/System theme. The CSS ships a `data-theme="brand-2026"` theme with a muted blue, "Calendly Sans" plus "Geist" fonts and 8px button radius.

**Recommendation for the clone:** ship the Classic information architecture and Classic visual theme (it is what the orchestrator specified and what invitees see on every booking page today), but build tokens as CSS variables so a `brand-2026` theme and dark mode can be switched on later. Route names in section 2 support both label sets.

---

## 1. Design language

### 1.1 Color tokens (Classic theme, exact values from production CSS) [V]

Calendly's design system is a two layer token system: core palette (`--coreColor*`) and semantic tokens (`--colorText*`, `--colorSurface*`, `--colorStroke*`, `--colorBackground*`). The Classic theme maps them like this:

| Semantic token | Core | Hex | Used for |
|---|---|---|---|
| `colorTextStandard` | Neutral900 | `#0A2540` | Headings, body text, input text |
| `colorTextSecondary` | Neutral600 | `#476788` | Secondary text, host name on booking page, weekday headers, disabled-looking day numbers, helper text |
| `colorTextPlaceholder` | Neutral600 | `#476788` | Placeholders |
| `colorTextDisabled` | Neutral500 | `#A6BBD1` | Disabled text |
| `colorTextAction` | Blue700 | `#004EBA` | Links, available day numbers, time slot text, month arrows |
| `colorTextInverseStandard` | Neutral0 | `#FFFFFF` | Text on blue or dark fills |
| `colorTextSuccess` | Green800 | `#0A6439` | Success text |
| `colorTextWarning` | Orange700 | `#894800` | Warning text |
| `colorTextDestructive` | Red700 | `#B03200` | Errors, destructive links |
| `colorBackgroundStandard` | Neutral0 | `#FFFFFF` | Cards, panels, modals |
| `colorBackgroundSecondary` | Neutral100 | `#FAFAFA` | Page canvas behind the booking card, app page background |
| `colorBackgroundTertiary` | Neutral300 | `#E7EDF6` | Muted fills |
| `colorBackgroundInfo` | Blue200 | `#E6F0FF` | Info banners |
| `colorBackgroundSuccess` | Green200 | `#CDF9E5` | Success banners |
| `colorBackgroundWarning` | Orange200 | `#FFE7BA` | Warning banners |
| `colorBackgroundDestructive` | Red200 | `#FFE2D9` | Error banners |
| `colorBackgroundOverlayMedium` | n/a | `rgba(10, 37, 64, 0.5)` | Modal scrim, also the "selected time" chip fill |
| `colorSurfaceAction` | Blue600 | `#006BFF` | Primary buttons, selected day circle, "Next" button |
| `colorSurfaceActionHover` | Blue700 | `#004EBA` | Primary button hover |
| `colorSurfaceActionActive` | Blue800 | `#004796` | Primary button pressed |
| `colorSurfaceActionSecondary` | Blue100 | `#F4F8FF` | Available day circle fill, secondary button fill, selected nav item |
| `colorSurfaceActionSecondaryHover` | Blue200 | `#E6F0FF` | Hover of the above |
| `colorSurfaceActionTertiary` | Blue100 | `#F4F8FF` | Ghost button hover, day hover |
| `colorSurfaceTertiary` | Neutral300 | `#E7EDF6` | Chips, tags |
| `colorSurfaceDisabled` | Neutral300 | `#E7EDF6` | Disabled buttons |
| `colorSurfaceDestructive` | Red600 | `#D53C00` | Destructive buttons ("Yes, cancel", "Delete") |
| `colorSurfaceSuccess` | Green700 | `#0D804B` | Success check circle |
| `colorStrokeStandard` | Neutral400 | `#D4E0ED` | Every hairline border: cards, inputs, panel dividers, booking card border |
| `colorStrokeMedium` | Neutral500 | `#A6BBD1` | Stronger input borders, dashed "unavailable" slots in troubleshoot mode |
| `colorStrokeStrong` | Neutral600 | `#476788` | Hover border on inputs |
| `colorStrokeFocus` | Blue600 | `#006BFF` | Focus rings, time slot button border |
| `colorElevationShadow` | n/a | `rgba(10, 37, 64, 0.1)` | Shadow color |

Core palette (Classic hex values) [V]:

```
Neutral:  0 #FFFFFF | 100 #FAFAFA | 150 #F5F6F9 | 200 #F0F3F8 | 300 #E7EDF6 | 400 #D4E0ED
          500 #A6BBD1 | 600 #476788 | 700 #194870 | 800 #0B3558 | 900 #0A2540
Blue:     100 #F4F8FF | 150 #EDF4FF | 200 #E6F0FF | 300 #B8DCFF | 400 #8CC6FD | 500 #0099FF
          600 #006BFF | 700 #004EBA | 800 #004796 | 900 #003774
Red:      100 #FFF4F1 | 200 #FFE2D9 | 300 #FFC4B0 | 400 #FF906B | 500 #FF4F00 | 600 #D53C00 | 700 #B03200 | 800 #892700
Orange:   100 #FFF6E6 | 200 #FFE7BA | 300 #FFCB6A | 400 #FFA600 | 500 #E58200 | 600 #AA5B00 | 700 #894800
Yellow:   100 #FFE67C | 200 #F8C51F | 300 #D6A70C | 500 #947203
Green:    100 #F1FEF8 | 200 #CDF9E5 | 300 #A5E9C9 | 400 #70E1AC | 500 #00DB75 | 600 #14AA51 | 700 #0D804B | 800 #0A6439
Teal:     100 #BAF0EC | 300 #1BC4B8 | 500 #07857C | 700 #0A4D4F
Purple:   100 #F8F6FF | 300 #DBCBFC | 500 #9A82FF | 600 #8B61FF | 700 #7434F4 | 800 #5700E4
Pink:     100 #FDF4FF | 300 #F5C1FF | 500 #E55CFF | 600 #C600EC
```

Marketing site (calendly.com, signup page) uses the same family: Ink Navy `#0B3558` for text, Slate `#476788` secondary, Cloud `#F8F9FB` canvas, Hairline `#D4E0ED`, Pebble `#F0F3F8`, Signal Blue `#006BFF` CTA [V via refero.design style extraction]. Inside the app the darker `#0A2540` is the standard text color.

**Event type color palette** (the color picker in the event editor, also the strip on event cards and the dot on meetings) [V, names are Calendly's own token names]:

| Name | Hex |
|---|---|
| Rambunctious red | `#FF4F00` |
| Bubblegum pink | `#FF758E` |
| Proudly pink | `#E55CFF` |
| Princely plum | `#8247F5` |
| Regal royal | `#0099FF` |
| Spritely sky | `#0AE8F0` |
| Loud lime | `#17E885` |
| Lively lemon | `#CCF000` |
| Yellin yellow | `#F8E436` |
| Outrageous orange | `#FFA600` |

Default event color for a new event type: Proudly pink (`#E55CFF`) or Princely plum (`#8247F5`) in practice [M]; pick `#8247F5` for the first event and rotate through the list for subsequent new types.

**Booking page custom branding** (paid feature, Settings > Branding and embed params) [V]: three colors, "Background color" default `#FFFFFF`, "Text color" default `#4D5055`, "Button & link color" default `#0069FF`. When a custom primary color is set, CSS uses `var(--primary-color, rgb(0, 105, 255))` for available days, selected day and buttons. Implement the booking page so every blue on it reads from a `--primary-color` variable.

### 1.2 2026 brand theme (for later, behind `data-theme="brand-2026"`) [V]

| Token | Light | Dark (`brand-2026-dark`) |
|---|---|---|
| Text standard | `#0B0D0F` | `#E4E6E9` |
| Text secondary | `#545F69` | `#A4AEB7` |
| Text action | `#286CB9` | `#58A1F2` |
| Surface action (primary button) | `#1E5EA7` | `#6BB1FF` |
| Surface action secondary | `#F4F9FF` | `#071A31` |
| Background standard | `#FFFFFF` | `#161A1E` |
| Background secondary | `#F8F9F9` | `#0F1114` |
| Stroke standard | `#E4E6E9` | `#272E33` |
| Focus | `#3278C8` | n/a |
| Elevation shadow | `#0B0D0F1A` | `#0B0D0F99` |

Fonts: headings "Calendly Sans" (proprietary), body/labels "Geist" (free, Vercel), secondary serif "STIX Two Text". Buttons: 8px radius (0.5rem), medium (500) weight. Card shadow `0 1px 6px var(--colorElevationShadow)`; modal shadow `0 32px 96px rgb(25 72 112 / 8%), 0 0 24px rgb(25 72 112 / 8%)`.

### 1.3 Typography [V]

Classic theme font tokens: `--fontFamilyBody`, `--fontFamilyHeading`, `--fontFamilyInput` all `"Proxima Nova", sans-serif`. Proxima Nova is commercial. **Clone substitute:** `Figtree` (Google Fonts, closest free geometric humanist match), stack: `"Figtree", "Proxima Nova", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Load via `next/font/google`. (Alternative: `Nunito Sans`.)

Type scale (Classic, base 16px):

| Token | Size | Line height | Typical use |
|---|---|---|---|
| Headline1 | 32px (2rem) | 40px | Rare, marketing |
| Headline2 | 28px (1.75rem) | 36px (event name uses 32px) | Event type name on booking page (h1), page titles in app ("Scheduling") |
| Headline3 | 24px (1.5rem) | 32px | Modal titles, "You are scheduled" |
| TitleLarge | 22px (1.375rem) | 28px | "Select a Date & Time", "Enter Details" |
| TitleMedium | 18px (1.125rem) | 26px | Section headings, card titles |
| TitleSmall | 16px (1rem) | 24px | Day numbers, time slots, host name, date subtitle in slot list |
| BodyLarge | 16px | 1.4 | Body text |
| BodyMedium | 14px (0.875rem) | 1.4 | Secondary body, month title "October 2026", table text |
| BodySmall | 12px (0.75rem) | 1.4 | Weekday headers ("Sun Mon..."), captions |
| LabelLarge / Medium / Small | 14 / 12 / 11px | 20 / 16 / 16px | Form labels, badges, "Former Time" label |
| Eyebrow | 12-16px, bold, letter spacing 0.72-0.96px, uppercase | | Section eyebrows ("EMAIL", "LOCATION" labels in meeting details) |

Weights: 400 standard, 500 medium, 600 semibold (buttons, labels, nav items), 700 bold (titles, headlines, event names, slot times). Phone breakpoint shrinks event name to 26px.

### 1.4 Radii, borders, shadows, spacing [V]

- Radius scale: `0.125rem 0.25rem 0.375rem 0.5rem 0.75rem 1rem 1.5rem`, pill `9999px`, circle `50%`.
- **Buttons (Classic): pill radius** (`--border-radius-button: pill`). Button min-height 40px (`2.5rem`), padding `0.5rem 1rem` (medium) / `0.5rem 0.75rem` (small), border 1px, font-weight 600, gap 4px between icon and label.
- Inputs: 8px radius (0.5rem) [V for 2026, M for classic], height about 46px on booking form, 40px in app, 1px border `#D4E0ED` (hover `#476788`), focus border `#006BFF` plus 2px focus ring.
- Booking card: 1px solid `#D4E0ED`, radius 8px, shadow `0 1px 8px 0 rgb(0 0 0 / 8%)` [V]. Embedded/modern variant: no border, radius 1.25rem, shadow `0 16px 48px 0 rgb(25 72 112 / 6%), 0 0 24px 0 rgb(25 72 112 / 6%)` [V].
- App cards (event type rows, settings cards): white, 1px `#D4E0ED`, radius 8px, shadow none or `0 1px 6px rgba(10,37,64,0.1)` on hover [M].
- Modal shadow (Classic): `0 2px 15px rgba(0, 0, 0, 0.1)` [V]; scrim `rgba(10, 37, 64, 0.5)` at 0.7 opacity [V].
- Border widths: thin 1px, medium 2px, thick 4px [V].
- Spacing: 4px base unit, common steps 4, 8, 12, 16, 20, 24, 32, 40, 48 [V/M].
- Motion: panel width transitions `all 0.22s ease-out` [V]; the "Next" button slides in from `translateX(40px)` to 0 [V]; badge transitions `0.1s ease-in` [V].

### 1.5 Core components (what they look like)

- **Primary button**: pill, `#006BFF` fill, white 600 text, hover `#004EBA`, pressed `#004796`, focus 2px `#006BFF` outline offset 2px. Examples: "Save changes", "Schedule Event", "Next", "Create", "Book Meeting".
- **Secondary button**: pill, white fill, 1px `#476788`-ish or `#D4E0ED` border, `#0A2540` text; hover fill `#F4F8FF`. Examples: "Cancel", "Copy link", "Add Guests", "Share".
- **Tertiary/link button**: no border, `#004EBA` text, 600 weight, hover underline or `#F4F8FF` pill fill. Examples: "+ Add new question", "More options", "View booking page".
- **Destructive button**: `#D53C00` fill, white text ("Yes, cancel", "Delete").
- **Icon button**: 32-40px circle, transparent, icon `#476788`, hover fill `#F4F8FF`. Kebab menu is a vertical or horizontal three-dot icon (Calendly uses a gear on older cards and three dots on newer ones).
- **Toggle switch**: 36x20 track, off `#A6BBD1`, on `#006BFF`, white knob [M]. Labels "On"/"Off" appear next to switches in menus.
- **Checkbox**: 16-18px, radius 13.333% (about 2-3px) [V], checked fill `#006BFF` with white check.
- **Tabs**: text tabs with 2-3px bottom border `#006BFF` on active, 600 weight, inactive `#476788`; tab row has a 1px `#D4E0ED` bottom divider.
- **Dropdown/select**: looks like an input with a chevron-down at right; menus are white popovers with 8px radius, 1px border, shadow `0 2px 15px rgba(0,0,0,0.1)`, items 36-40px high, hover `#F4F8FF`, selected item has a blue check.
- **Toast**: bottom-center (app) dark navy pill or white card with green check, e.g. "Link copied" / "Changes saved" [M].
- **Avatar**: circle, initials on `#E7EDF6` (or a random pastel), 32px in nav, 64-80px on landing page.
- **Badge/pill**: radius 9999px, `#E6F0FF` fill with `#004EBA` 12px 500 text (e.g. "Secret", "New", "Default").
- **Icons**: line icons, 1.5-2px stroke, 16-24px, mono `#476788` or `#0A2540`; action icons `#004EBA`. Map to lucide-react: Clock (duration), Video (web conferencing), Phone, MapPin (in-person), Globe (time zone), CalendarDays (date), User/Users (hosts), Link (copy link), Share2, MoreVertical/Settings (kebab or gear), Plus, X, Copy, ChevronLeft/Right, ChevronDown, ArrowLeft (back), Check, CheckCircle2, EyeOff (secret event), Repeat (round robin), CreditCard (payment), Bell (notifications), Zap (workflows), Route/Split (routing), BarChart3 (analytics), LayoutGrid (integrations), ShieldCheck/Building2 (admin), HelpCircle (help), Crown/Sparkles (upgrade).
- **Diagonal "powered by Calendly" ribbon** (booking pages on free plans, top-right corner of the booking card) [V]: 105x105 clip box at `top:-5px; right:-5px`, inside it a 160px band rotated 45deg, `#505960` fill (hover `#40474C`), white text, "POWERED BY" 8px uppercase on one line and "Calendly" 14px bold below, band shadow `0 2px 4px 0 rgb(0 0 0 / 20%)`, two 6x6 squares at the corners in `#505960` to fake the fold. Clone: render "powered by" plus our product name, and hide it when the owner toggles branding off.

### 1.6 Suggested Tailwind v4 theme block

```css
@theme {
  --font-sans: "Figtree", "Proxima Nova", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --color-ink: #0a2540;          /* text standard */
  --color-ink-2: #476788;        /* text secondary */
  --color-ink-3: #a6bbd1;        /* disabled */
  --color-navy: #0b3558;
  --color-line: #d4e0ed;         /* hairline borders */
  --color-canvas: #fafafa;       /* page bg */
  --color-cloud: #f8f9fb;
  --color-pebble: #f0f3f8;
  --color-mist: #e7edf6;
  --color-primary: #006bff;
  --color-primary-hover: #004eba;
  --color-primary-active: #004796;
  --color-primary-text: #004eba; /* links, available days, slot text */
  --color-primary-soft: #f4f8ff; /* available day fill, selected nav */
  --color-primary-soft-2: #e6f0ff;
  --color-danger: #d53c00;
  --color-danger-text: #b03200;
  --color-success: #0d804b;
  --color-warning: #ffa600;
  --radius-card: 8px;
  --radius-input: 8px;
  --shadow-card: 0 1px 8px 0 rgb(0 0 0 / 0.08);
  --shadow-pop: 0 2px 15px rgba(0, 0, 0, 0.1);
  --shadow-next: 0 1px 6px 0 rgba(10, 37, 64, 0.1);
}
```

---

## 2. Information architecture and routes

### 2.1 Classic sidebar (target) and 2026 mapping

| Classic label (2024-2025) | 2026 label / location [V] | Suggested clone route |
|---|---|---|
| + Create (button) | + Create | (menu, no route) |
| Scheduling (tabs: Event types, Single-use links, Meeting polls) | Scheduling (tabs: Event types, Single-use links, Meeting polls, Routing forms) | `/app/scheduling` (`?tab=event-types\|single-use\|polls`) or `/app/scheduling/event-types`, `/app/scheduling/single-use-links`, `/app/scheduling/meeting-polls` |
| Meetings | Calendar | `/app/meetings` (alias `/app/calendar`) |
| Availability (tabs: Schedules, Calendar settings, Advanced settings) | Settings > Scheduling (Available hours, Calendars, Advanced availability) | `/app/availability`, `/app/availability/calendar-settings`, `/app/availability/advanced` |
| Contacts | Contacts | `/app/contacts` |
| Workflows | Automations (My automations, Assigned to you, Managed, Integrations & apps) | `/app/workflows` |
| Integrations & apps | Automations > Integrations & apps, also in profile menu | `/app/integrations` |
| Routing | Scheduling > Routing forms | `/app/routing` |
| Analytics | Profile menu > Analytics | `/app/analytics` |
| Admin center | Settings > Admin (Workspace, Dashboard, People, Access, Security, Billing, Managed events) | `/app/admin` |
| Help | "?" icon (Help center, Calendly Community, Get started guide, Chat with us, Give feedback) | external links / `/app/help` |
| Account menu (top-right avatar) | Profile menu (top-left): Profile, My landing page, Analytics, Integrations & apps, Invite users, Theme (Light/Dark/System), Log out | `/app/settings/profile`, `/app/settings/branding`, `/app/settings/link`, `/app/settings/notifications`, `/app/settings/login`, `/app/settings/security` |
| (none) | Notetaker (was Recaps), Payments (was Sell) | out of scope initially |

Event type editor: `/app/event-types/[id]` (Calendly uses `/event_types/{id}/edit`). New: `/app/event-types/new?kind=one_on_one`.

### 2.2 Public URLs (mirror Calendly's shapes) [V/M]

| Page | Calendly shape | Clone route |
|---|---|---|
| Landing page (user) | `calendly.com/{user}` | `/{username}` |
| Booking page | `calendly.com/{user}/{slug}?month=2026-10&date=2026-10-13` [V for `month`] | `/{username}/{slug}` with `month` and `date` query params |
| Time selected, details form | `calendly.com/{user}/{slug}/2026-10-13T10:00:00-04:00?month=...&date=...` [M] | `/{username}/{slug}/{isoStart}` |
| Back to landing page link | event links on landing page append `?back=1` [V] (shows a back arrow on the booking page) | same |
| Confirmation | `calendly.com/{user}/{slug}/invitees/{uuid}` [M] | `/booking/{uid}` |
| Cancel | `calendly.com/cancellations/{invitee_uuid}` [V, API cancel_url shape] | `/cancellations/{token}` |
| Reschedule | `calendly.com/reschedulings/{invitee_uuid}` [V, API reschedule_url shape] | `/reschedulings/{token}` |
| Single-use / one-off link | `calendly.com/d/{code}/{slug}` [M] | `/d/{code}` |
| Team page | `calendly.com/{team}` and `/{team}/{slug}` | `/team/{slug}` and `/team/{slug}/{eventSlug}` |
| Meeting poll vote page | `calendly.com/meeting/poll/{id}` style [M] | `/poll/{code}` |
| Routing form | public form link [M] | `/r/{slug}` |
| Embed | same page inside an iframe with `embed_domain` and `embed_type` params | `/embed/{username}/{slug}` or `?embed=1` |

---

## 3. Signup, login and onboarding

### 3.1 Signup page `/signup` [V]

- Two-column page. Left (or top on mobile): illustration (`signup-hero.svg`), right: form card.
- Header row: Calendly logo left, "Talk to sales" link right (marketing). Clone: logo left only.
- Title: **"Create a free account"**. Subtitle: **"No credit card required. Upgrade anytime."**
- Input with placeholder/label **"Enter your email"**, primary full-width button **"Continue with email"**.
- Divider: horizontal rules with **"or"** in the middle.
- Two full-width social buttons: **"Continue with Google"** (white, Google "G" logo, 1px border) and **"Continue with Microsoft"** (Microsoft four-square logo). Marketing variant labels: "Sign up with Google", "Sign up with Microsoft" (Microsoft button is navy filled `#0B3558` with white text on the homepage) [V].
- Helper under social buttons: **"Continue with Google or Microsoft to connect your calendar."**
- Footer: **"Already have a Calendly account? Log In"**.
- Right rail on desktop (trial upsell, clone can skip): "Try Teams Plus experience free", "Explore premium features with your free 14-day trial" with check bullets: "Multi-person and co-hosted meetings", "Round Robin meeting distribution", "AI meeting notes and interactive chat", "Collect payments through Stripe or Paypal", "Remove Calendly branding".
- Email path continues to a second step: "Enter your full name" and "Choose a password" (password rules hint: at least 8 characters, one letter and number), button "Get started" or "Sign up" [M]. Terms microcopy: "By creating an account, you agree to Calendly's Terms and Privacy Policy" [M].

### 3.2 Login page `/login` [M]

Same card layout. Title "Log in to your account". Buttons "Continue with Google", "Continue with Microsoft", divider "or", "Email address" input + "Continue", then password step with "Forgot password?" link and "Log In" button. Footer "Don't have an account? Sign up for free".

### 3.3 Onboarding wizard (first login) [M]

Full-screen, no sidebar. Centered white card (max width about 640px) on `#FAFAFA` canvas, Calendly logo top-left, step progress bar (thin blue segmented bar or "Step 2 of 4") at the top of the card, "Back" link bottom-left, primary "Continue" bottom-right, and a "Set up later" / "Skip" text link where optional.

1. **Choose your URL** ("Create your Calendly URL"): copy "Choose a URL that describes you or your business in a concise way. Make it short and easy to remember so you can share links with ease." Input with static prefix `calendly.com/` and the editable slug prefilled from the name (lowercased, hyphenated). Inline validation: green check "Available" or red "This URL is taken". Also asks for time zone (auto-detected dropdown, e.g. "Eastern Time - US & Canada").
2. **Connect your calendar**: title "Connect your calendar", copy "Connect your calendar to auto-check for busy times and add new events as they are scheduled." Large selectable tiles with logos: Google Calendar ("Gmail, G Suite"), Office 365 / Outlook.com, Exchange, iCloud. If the user signed up with Google/Microsoft this step shows the calendar already connected with a green check and continues. After connecting: shows "Calendly will check [email] for conflicts" and "Calendly will add events to [calendar]".
3. **Set your availability**: title "Set your availability", copy "Let Calendly know when you're typically available to accept meetings." Fields: "Available hours" with two time dropdowns ("9:00 am" to "5:00 pm"), "Available days" as seven toggle chips or checkboxes (Sun..Sat, Mon-Fri preselected). Footnote: "Don't worry! You'll be able to further customize your availability later on."
4. **Role / use case**: "What is your role?" or "What will you use Calendly for?" Single-select tiles: Sales, Marketing, Customer success, Recruiting, Education, Consulting, Freelance, IT, Operations, Other. Optional second question "How do you plan to use Calendly?" with "On my own" vs "With my team" [M].
5. **Finish**: lands on Scheduling with a default "30 Minute Meeting" one-on-one event type already created (Calendly creates "30 Minute Meeting" for new users; the default description location text is "Web conferencing details provided upon confirmation." when Zoom/Meet is set) [V for the name on real accounts]. A "Get started" checklist card or guide may appear (2026 Help menu has "Get started guide") [V].

Clone requirement: Google/Microsoft sign-in auto-connects the calendar and skips step 2.

---

## 4. App shell

### 4.1 Classic left sidebar (desktop) [M]

- Fixed left column, about 256px wide, white background, 1px `#D4E0ED` right border, full height. Collapsible to an icon rail (about 72px) with a "<<" / ">>" collapse button at the top right of the sidebar.
- Top: Calendly logo (blue "C" mark + wordmark, wordmark hidden when collapsed).
- **"+ Create" button**: full width (minus 16px padding), pill, white with 1px border and blue `#004EBA` text with a plus icon (or filled blue on some versions). Clicking opens the Create popover (section 6) anchored to the right of the button.
- Primary nav items (icon + label, 40px rows, 12px horizontal padding, 8px radius or pill highlight):
  - Scheduling (link icon)
  - Meetings (calendar icon)
  - Availability (clock icon)
  - Contacts (people icon)
  - Workflows (lightning/flow icon)
  - Integrations & apps (grid icon)
  - Routing (signpost/route icon)
- Bottom group, pinned to the bottom with a divider above:
  - "Upgrade plan" (crown icon, sometimes a highlighted blue text item) for free accounts
  - Analytics (bar chart icon)
  - Admin center (shield/building icon)
  - Help (question-mark icon, opens a flyout: Help Center, Getting started, Community, Contact support, Keyboard shortcuts, "What's new")
- Active item: `#F4F8FF` background pill, text and icon `#004EBA` (or `#006BFF`), weight 600. Inactive: `#0A2540` text, `#476788` icon, hover background `#F0F3F8`.
- Tooltips with the label appear on hover when collapsed.

### 4.2 Page header and account menu (Classic) [M]

- Each page has a top area (no global colored bar) on `#FAFAFA` or white: page title h1 (28px, 700, `#0A2540`) on the left, sometimes with a small help "?" icon that links to help. Right side of the header row: "Invite user" button (person-plus icon, secondary pill; admins only) and the **account avatar** (32px circle, initials) with a chevron.
- **Account menu** (popover, about 280px): header with name and email; sections: "Account settings": Profile, Branding, My Link, Communication settings, Login preferences, Security, Cookie settings; then "Share your link" / "Copy link"; then "Help", divider, "Logout". In 2026 the profile menu moves to the top-left and contains Profile, My landing page, Analytics, Integrations & apps, Invite users, Theme (Light, Dark, or System), Log out [V].
- Upgrade banner: free plans show a thin banner or a sidebar card "Upgrade plan" with a crown.

### 4.3 Mobile app shell (web, narrow) [M]

- Below about 768px the sidebar becomes a hamburger in a 56px white top bar (logo center or left, avatar right). Opening shows a full-height drawer with the same nav list and the Create button at the top.
- Floating "+" create button is not used on web; Create stays in the drawer and in page headers.

### 4.4 Settings shell (2026 style, used by the clone for account settings) [V]

Settings page with its own left sub-nav: Profile (General, Login), Scheduling (Available hours, Calendars, Advanced availability), Branding, My link, Notifications, Privacy (Booking, Blocked people, Cookies), Contacts settings, Admin settings (Workspace, Dashboard, People, Access, Security, Billing, Managed events). Clone: implement Profile, Branding, My link, Notifications, Login/Security, Cookie settings, plus the Availability pages.

---

## 5. Scheduling home (Event types tab)

### 5.1 Layout [V for features, M for exact layout]

- Title row: **"Scheduling"** h1. Right side: **"+ Create"** primary pill (also available in sidebar) [M].
- Tabs under the title: **"Event types"**, **"Single-use links"**, **"Meeting polls"** (2026 adds **"Routing forms"**) [V].
- Toolbar row under tabs:
  - **"My Calendly" dropdown** (avatar + "My Calendly" + chevron) to switch to team pages or another user (admins) [V].
  - **Search bar**: placeholder "Search event types" (search by name or link) [V].
  - **Filter menu** (funnel icon): filter by host, owner, access permissions [V].
- Section header for the personal group: user avatar (40px), user name (600), and the public link `calendly.com/username` as a blue link, plus **"View landing page"** link (external icon) [M]. Groups on the page [V]: **"Personal event types"**, **"Shared"**, **"Team event types"** (one section per team, showing only events you host).
- Event type list:
  - Desktop shows cards. 2024+ layout is a vertical list of full-width row cards; older layout is a 3-column grid of tall cards. Both have the same parts. Choose the row-card layout:
    - White card, 1px `#D4E0ED` border, 8px radius, **6px colored strip on the left edge** in the event color (grid variant: strip across the top).
    - Leading **checkbox** (for bulk actions), visible on hover or always.
    - **Event name** (16-18px, 700, `#0A2540`). A slashed-eye icon appears next to the name when the event is secret [V]. A "Turned off" / "Off" gray badge when inactive, and the whole card is grayed out (50% opacity on text) [M].
    - Meta line in `#476788`: duration, location type, kind, e.g. "30 min, Google Meet, One-on-One" (older: "30 mins, One-on-One") and the availability summary "Weekdays, 9 am - 5 pm" [M].
    - Optional "View booking page" link [V].
    - Right side: **"Copy link"** secondary pill with link icon [V] (toast "Link copied" / button text changes to "Copied" for 2s), a **share** icon button (opens Share modal), and the **three-dots menu** in the top-right corner [V].
  - **Hover quick actions** on a card [V]: "Book meeting", "Offer time slots", "Share availability" (paid), "Create single-use link". Show as small icon+label buttons that appear in the card footer on hover.
  - **Drag and drop to reorder** on desktop (drag handle appears on hover at the left) [V]; order is reflected on the landing page.
- **Three-dots (kebab) menu items, exact order** [V]:
  1. View booking page
  2. Edit
  3. Edit permissions
  4. Add to website
  5. Add internal note (Edit internal note when one exists)
  6. Change invitee language
  7. Make secret (or Make public)
  8. Duplicate
  9. Event statistics (team event types only, downloads CSV)
  10. Delete
  11. **On/Off switch** row at the bottom of the menu, controls whether the event type is active
- **Bulk actions toolbar** [V]: when one or more checkboxes are checked, a sticky toolbar appears at the bottom of the page with the count ("2 selected"), and actions **Delete**, **Toggle on/off**, **Copy availability from** (team event types), plus "Clear" (x).
- **Delete confirmation modal** [M]: title "Delete event type?" body "Users will be unable to schedule further meetings with deleted event types. Meetings previously scheduled will not be affected." buttons "Cancel" and red "Delete". Scheduled meetings remain unaffected [V].
- **Turning off** [V]: invitees cannot book it and the link stops accepting bookings. The public page for an off event shows an unavailable message (section 11.9).

### 5.2 Empty state [M]

Illustration (calendar with a plus), heading "Create scheduling links with event types", body "Event types are templates for meetings you'll want to schedule regularly, like product demos, customer calls, or office hours.", primary button "+ New event type". Search with no results: "No event types match your search."

### 5.3 Share modal [M]

Opened from the share icon. Title "Share {Event name}". Tabs or left list: "Copy link" (shows the URL in a read-only input with "Copy link" button; under it "Customize once and share" link for a one-time customized link), "Add times to email" (pick a date, click times to insert as clickable links, button "Copy times"), "Add to website" (goes to embed chooser). Footer link "Create single-use link".

### 5.4 Add to website (embed chooser) [V]

Modal "Add to website": three large option cards with illustrations: **Inline Embed** ("Add a scheduling page to your site"), **Popup Widget** ("Add a floating button that opens a popup"), **Popup Text** ("Add a text link that opens a popup"). Button "Continue". Next screen: left settings column, right live preview: "Hide event type details" checkbox, "Hide cookie banner" checkbox, colors (Background color, Text color, Button & link color, paid), for Popup widget: "Widget text" (default "Schedule time with me"), "Widget text color", "Widget background color", "Hide Calendly branding"; for Popup text: "Link text" (default "Schedule time with me"). Bottom: code textarea and "Copy code" button. Default widget colors `#0069FF` background, `#FFFFFF` text [V].

### 5.5 Single-use links tab [V/M]

- List of links created from event types and one-off meetings. Each row: event color dot, name, "Single-use" or "One-off" badge, contact (if added), created date, status ("Not scheduled" / "Scheduled" / "Expired"), "Copy link" button, kebab with **Share, Duplicate, Edit, Delete**, and for one-off meetings **Clear reserved times** (confirm with "Clear reservations") [V].
- Empty state: "No single-use links yet" with copy "Create a link that can only be booked once." [M]
- Creating from an event type card: popover/panel "Create single-use link": optional "Add contact" (search contacts or enter name/email), and for one-on-one types the ability to customize meeting name, duration, location and availability; button **"Save and copy link"** [V]. Paid: "Share" sends via connected Gmail/Outlook with optional reminder if not scheduled in 1, 3 or 7 days [V].
- Link expires after one booking; reopening shows "Someone has already used this link to book a meeting" style message [V community thread title].

### 5.6 Meeting polls tab [V]

List of polls (see section 12). From here you view, copy, edit, or delete a poll; select a poll to see results and book.

---

## 6. "Create" menu and event type kind chooser

Clicking **+ Create** opens a popover (about 360px wide, white, 8px radius, pop shadow) with two groups [V for group names and items, M for subtitles]:

**Event type** (heading, 12px uppercase or 14px bold)

| Item | Subtitle line 1 (bold, with icon) | Subtitle line 2 (gray) |
|---|---|---|
| One-on-one | "1 host → 1 invitee" | "Good for coffee chats, 1:1 interviews, etc." |
| Group | "1 host → Multiple invitees" | "Webinars, online classes, etc." |
| Round robin | "Rotating hosts → 1 invitee" | "Distribute meetings between team members" |
| Collective | "Multiple hosts → 1 invitee" | "Panel interviews, group sales calls, etc." |

Plan-gated items show a small "Upgrade" or crown badge (Group, Collective need Standard; Round robin needs Teams) [V plans]. Clone: no gating.

**More ways to meet** [V]

| Item | Subtitle |
|---|---|
| One-off meeting | "Offer time outside your normal schedule" [M] |
| Meeting poll | "Let invitees vote on a time to meet" [M] |

Selecting an event type kind opens the event type editor for a new event with defaults: name "New Meeting" (one-on-one) or e.g. "New Group Meeting", duration 30 min, no location, availability = default schedule, host = you [M]. Kind cannot be changed later (to switch, create a new event type) [V].

---

## 7. Event type editor (side-panel editor with live preview)

### 7.1 Overall layout [V for structure, M for pixels]

- Full-page view that replaces the app content (sidebar stays or collapses).
- **Left: settings panel** about 440px wide, white, 1px right border, its own scroll. **Right: live preview** of the booking page on a `#FAFAFA` canvas, updating in real time as you edit [V]. The preview has a banner at the top: "This is a preview. To book an event, share the link with your invitees." [M] and a "View booking page" / external link icon.
- Panel header: back arrow + "Event types" (or "Back"), then a small eyebrow with the kind ("One-on-One", "Group", "Collective", "Round Robin"), and a kebab for event actions (make secret, change language, permissions, delete) [M].
- Panel body: a vertical stack of **collapsible sections**. Each collapsed section is a row with an icon, a bold title, a one-line gray summary of the current value and a chevron. Clicking expands it inline (accordion; one or many open).
- Panel footer (sticky): **"More options"** link (reveals the additional sections) [V], **"Preview"** [V] (on narrow screens it toggles to the preview), secondary "Cancel" and primary **"Save changes"** [V]. Unsaved changes trigger a "You have unsaved changes" guard modal when leaving ("Discard changes" / "Keep editing") [M].

### 7.2 Primary sections (always visible) [V]

To create an event type you must set Event name, Duration, Location, Availability, Host(s) [V].

1. **Event name + Event color**
   - Text input "Event name" (required, e.g. "30 Minute Meeting"), with a color dot button to the left that opens the 10-swatch event color palette (section 1.1).
   - Summary when collapsed: the name itself, large.
2. **Duration**
   - Dropdown with presets: 15 min, 30 min, 45 min, 60 min, Custom (custom shows number + unit min/hrs) [M].
   - **"+ Add duration option"** to offer multiple durations (up to four; not for Group or managed types) [V]. Each option row has hover action **"Make default"** [V]. Invitees see a duration dropdown next to the clock icon on the booking page [V].
3. **Location**
   - Row of location tiles/buttons with logos: Zoom, Phone call, In-person, Google Meet, Microsoft Teams, Webex, GoTo Meeting, "Custom", "Ask invitee", plus "+ More options" for others [V list from help: Phone call, In-person, Custom, Ask invitee, video tools].
   - Phone call sub-options [V]: "Require invitee's phone number" vs "Provide a phone number to invitees after they schedule" (host phone input).
   - In-person [V]: address input and additional notes; "Display location only after confirmation" checkbox [M].
   - Custom [V]: location text and choose whether to display on booking page or only after booking.
   - Ask invitee [V]: adds a location question to the booking form.
   - Multiple locations allowed: invitee chooses one on the details form (radio list) [V "manage multiple locations"].
   - Video tools not connected show "Connect" which deep-links to Integrations [V].
   - Summary: "No location given" or "Zoom" / "Google Meet" / "Phone call" etc.
4. **Availability**
   - Summary: "Weekdays, 9 am - 5 pm" or "Weekdays, hours vary" [M].
   - **Date-range** sentence with inline dropdowns [V]: "Invitees can schedule **60 days** into the future with at least **4 hours** notice". Range dropdown options [V]: "Number of days into the future" (choose **calendar days** or **week days**), "Within a date range" (date range picker), "Indefinitely into the future". Notice dropdown: minutes, hours, days (minimum scheduling notice).
   - **Schedule:** dropdown listing schedules ("Working hours (default)", other schedules) and **"Custom schedule"** (event-only hours) [V]; an **"Apply to/from event types"** icon lets you "Apply to" or "Copy from" other event types [V].
   - Under it, the weekly hours editor (same component as the Availability page, section 9), date-specific hours, and the **time zone** shown under the available hours, click to change [V].
   - Collective: shows "Showing times that all hosts are available" plus each host's schedule source [M].
5. **Host(s)** (label "Host" / "Hosts and invitees")
   - One-on-one: "You" with avatar; "+ Add host" turns it into a co-hosted or collective event on paid plans [M].
   - Group: **"Invitee limit"** section [V]: "Max invitees in a spot" number (min 2, max 9,999) [V] and checkbox **"Display remaining spots"** [V]. Booking page then shows "X spots left" under each time [M].
   - Collective: list of hosts with avatars and their availability status; option to "Schedule with multiple groups of hosts" on Teams plans [V].
   - Round robin: list of hosts with **priority stars** (1-5 or Low/Medium/High), **assignment** setting with two radio options [V]: **"Maximize for availability"** (book with any available host, ties broken by priority then by who was least recently booked then random) and **"Optimize for equal distribution"** (hides a host whose meeting count is 3 or more ahead). **Rescheduling preferences dropdown** [V]: "Reassign host(s) through round robin" (default) vs "Use same hosts as original meeting".

### 7.3 "More options" sections [V for names and order]

Revealed by **More options**. Order: Description, Limits and buffers, Free/busy rules, Booking page options, Invitee form, Payment, Notifications and automations, Confirmation page.

1. **Description**
   - Rich text editor (bold, italic, underline, bullet list, numbered list, link) with placeholder "Write a summary and any details your invitee should know about the event." [M]. Shown on the booking page left panel under the details.
2. **Limits and buffers** [V]
   - **Buffer time**: "+ Set buffer time" reveals "Before event" and "After event" dropdowns (0 min, 5, 10, 15, 30, 45 min, 1 hr, 1.5 hrs, 2 hrs, 2.5 hrs, 3 hrs) [V for feature, M for values]. Helper: "Add time before or after booked events".
   - **Meeting limits**: "+ Set limit" adds rows "Max number of meetings" [number] per [day | week | month] [V]. Multiple rows allowed (one per period).
   - Minimum notice lives in Availability (Date-range) [V].
3. **Free/busy rules** [V]
   - Explanation: let invitees book over specific events on your connected calendars.
   - "+ Add meeting exception": dropdown **"Includes"** or **"Matches exactly"** + event title text, press Enter to add a chip. Calendly meetings booked over trigger an alert in the "New Event" email with "View in Calendly".
4. **Booking page options** [V]
   - **Event link**: `calendly.com/{username}/` + editable slug input.
   - **Start time increments**: "Show available start times in increments of" dropdown (5, 10, 15, 20, 30, 45, 60 min ...). Example: 30 min shows 9:00, 9:30, 10:00.
   - **Time zone display**: radio "Automatically detect and show the times in my invitee's time zone" (recommended) vs **"Lock the timezone"** (best for in-person events) with a time zone selector [V].
5. **Invitee form** [V]
   - Default fields: **Name** (choose "Name" single field or "First Name, Last Name") [M] and **Email** (required, not removable).
   - Checkbox "Allow invitees to add guests" [M] (guest emails, up to 10) and "Autofill Invitee Name, Email, and Text Reminder Phone Number from prior bookings" [M].
   - Question list (drag to reorder), default question "Please share anything that will help prepare for our meeting." (Multiple lines, optional) [M].
   - Up to **10 custom questions** [V]. **"+ Add new question"** [V] opens an editor: Question text, **Required** checkbox [V], **Answer type** [V]: One line, Multiple lines, Radio buttons, Checkboxes, Dropdown, Phone number; answer choices for choice types (add/remove rows, "Include 'other' option" [M]); **On/Off** switch per question [V]; delete icon [V]. Buttons "Cancel" / "Apply" (or "Save").
6. **Payment** [V]
   - If no processor connected: "Connect Stripe" / "Connect PayPal" cards.
   - Connected: **"Require payment"** toggle, processor select (Stripe or PayPal), **Amount** and **Currency**, optional **coupon code(s)**, **Payment terms** text (e.g. "Non-refundable meeting deposit"). Invitee pays on the details step before "Schedule Event". Stripe supports cards, Apple Pay, Google Pay.
7. **Notifications and automations** [V]
   - Rows each with a three-dots menu (Edit, On/Off toggle): **Calendar invitation** (or **Email confirmation**), **Email reminders**, **Text reminders**, **Email follow-up**, **Cancellation policy** [M for the last three names].
   - Calendar invitation vs Email confirmation editor: banner "Switch to calendar invitation" / "Switch to email confirmation" at the top; fields for event title, description, "Include cancel and reschedule links" [V], subject and body (Standard plan and above can customize subject/body and variables) [V]; button "Save and close" [V].
   - Section footer: list of Workflows applied to this event type and "+ Add workflow" / "Create new automation" link [M].
8. **Confirmation page** [V]
   - **After booking**: radio **"Display confirmation page"** or **"Redirect to an external site"** (URL input + checkbox "Pass event details to your redirected page" [M]).
   - Links on confirmation page: built-in "Schedule another event" link with **Link name** text field and **Status** toggle [V]; **"+ Add new link"** (link name + URL) [V].

Additional settings outside the panel (from the card kebab) [V]: Event language ("Change invitee language", affects page and notifications), Event permissions (who can view/edit), Secret event (Make secret / Make public), Internal note.

### 7.4 Kind-specific notes

- Group events use email confirmations (each invitee gets their own .ics) not calendar invites [V]. Once booked, language, location and duration are locked (gray box) [V].
- One-off meetings and polls cannot use Workflows and cannot be rescheduled [V].
- Multiple durations are not available for Group types [V].

---

## 8. One-off meeting flow [V]

Opened from **+ Create > More ways to meet > One-off Meeting**. Full-screen, three steps.

1. **Choose times to offer**: left column sets **Time zone**, **Duration**, **additional hosts**. Main area is a week calendar (Google Calendar-like): existing calendar events shown as gray blocks, click a time to add a slot (blue block with the time). Slots can be over non-Calendly events and outside available hours. Each day header has **"+ Add times"** to add all free times for that day. Slots must be within 3 months of each other. Buffers and meeting appear as one block. Button **"Next"**.
2. **Set up meeting details**: **meeting name**, **location**, optional **description/instructions**, **Optional settings** (e.g. Reserve times, invitee questions, hide/allow guests). Button **"Share meeting link"**.
3. **Share**: unique link with editable ending, **"View live page"**, **"Copy Link"**, and **"Add times to email"**. Appears under Scheduling > Single-use links. **Reserve Times** holds the offered slots as placeholder events on host calendars until booked (then auto-cleared); manual "Clear reserved times" from the kebab, confirm "Clear reservations".

Single-use link flow (from an event card): see 5.5.

---

## 9. Availability

### 9.1 Classic page structure [V for features, M for layout]

- Title **"Availability"**. Tabs: **"Schedules"**, **"Calendar settings"**, **"Advanced settings"** (2026: Settings > Scheduling > Available hours / Calendars / Advanced availability) [V].
- Also reachable from Scheduling via **"Manage availability"** [V].

### 9.2 Schedules tab [V]

- Top card header:
  - **"Schedule"** label with a dropdown of schedules ("Working hours (default)", others) and at the bottom of that dropdown **"+ Create schedule"** (modal "New schedule", input "Schedule name", buttons "Cancel" / **"Create"**) [V].
  - **"Active on"** dropdown: "Active on: 2 event types" with checkbox list of event types and **"Apply"** [V].
  - Kebab: Rename, Set as default, Clone, Delete [M].
  - View switch: **List** / **Calendar** segmented control [V].
- Changes **save automatically** (no save button; show a small "Saved" toast) [V].
- **List view, left column "Weekly hours"** (subtitle "Set when you are typically available for meetings" [M]):
  - Seven rows, Sunday first (or Monday per locale). Each row: a 32px circle with the day initial ("S", "M", "T"...) in navy fill/white text (or the 3-letter name "SUN") [M], then either:
    - **Unavailable** state: gray text "Unavailable" and a **"+"** icon button to add hours [V].
    - **Available**: one or more interval rows: start time input "9:00am", a hyphen "-", end time input "5:00pm", an **"x"** remove icon [V]. The first interval row also has **"+"** (add another interval, e.g. after lunch) [V] and a **copy icon** that opens "Copy times to..." popover with checkboxes for each day (and "Select all") and an **"Apply"** button [M].
  - Time inputs are typeable comboboxes with a dropdown of 15-minute steps; invalid ranges show red text "Choose an end time later than the start time." and overlapping intervals "Times overlap with another set of times." [M].
- **Right column "Date-specific hours"** (subtitle "Adjust hours for specific days" [M]) with **"+ Hours"** button [V]. List of overrides sorted by date: date label ("Thu, Oct 22, 2026"), hours ("10:00am - 2:00pm" or "Unavailable"), edit pencil and delete trash on hover.
- **Date-specific hours modal** [V/M]: title "Select the date(s) you want to assign specific hours", a month calendar (multi-select: click several dates; today has a dot; prev/next arrows), below it "What hours are you available?" with interval rows (+ and x, empty means Unavailable), buttons "Cancel" / **"Apply"** [V].
- **Time zone** dropdown at the bottom of the list view [V]: searchable, shows local time next to each option, schedule saves automatically.
- **Calendar view** [V]: month grid, each day cell shows its hours; select a date (or drag across multiple), popover offers "Edit date" or "Edit all [weekday]" then interval editor and **"Apply"**. Used for non-weekly schedules.
- **Holidays** (classic location: Availability page section; 2026: Advanced availability) [V]: "Holidays" with **country** select (Australia, Brazil, Canada, France, Germany, Mexico, Netherlands, Spain, United Kingdom, United States) and a list of holidays with **On/Off** switches (On = unavailable).

### 9.3 Calendar settings tab [V]

- **Calendar connections** card: list of connected accounts (provider logo, account email, connection status, kebab with "Disconnect"/"Remove"). Header shows count like "1 of 6 calendar accounts" [M]. Button **"+ Connect calendar account"** opens a modal with tiles: Google Calendar, Office 365 / Outlook.com, Exchange, Outlook plug-in, iCloud [V]. Free plan: 1 calendar, paid: up to 6 [V].
- **Configuration**:
  - **"Calendars to check for conflicts"**: per account, checkbox list of calendars, with "Edit" to open the selection modal [V]. Copy: "These calendars will be used to prevent double bookings" [M].
  - **"Calendar to add events to"**: single selection (radio list across accounts) with "Edit" [V]. Copy: "Set the calendar you would like to add new events to as they're scheduled" [M].
  - **Sync settings** (per calendar) [V]: checkbox "Include buffers on this calendar", checkbox "Automatically sync cancellations and reschedules from this calendar to Calendly".
- Error state: red banner "There is a problem with your calendar connection. Reconnect" (troubleshoot code NOCAL) [M].

### 9.4 Advanced settings tab [V]

- **Meeting limits** across all event types: "+ Add a meeting limit" rows "Max number of meetings" per day/week/month; saves automatically.
- **Holidays** (see above).
- Clone may also host here: default start time increments and default minimum notice (not Calendly, optional).

---

## 10. Meetings page (Scheduled events, 2026 "Calendar")

### 10.1 Classic layout [M]

- Title **"Meetings"** (formerly "Scheduled Events"). Top controls: "My Calendly" dropdown (switch user/team), **"Show buffers"** toggle [V], counter "Displaying 1 - 4 of 4 Events".
- Tabs: **"Upcoming"**, **"Unconfirmed"** (when reconfirmation workflows exist), **"Past"**, **"Date Range"** (opens a range calendar picker). Right side: **"Export"** button (CSV download) [V export exists] and **"Filter"** button.
- Filter panel (dropdown row): Teams, Host, Event Types, Status (Active events / Canceled events), Tracking ID, Invitee Emails; "Clear all filters" link.
- List grouped by date headers (e.g. "Wednesday, 14 October 2026"), white card container with rows separated by 1px lines. Each row:
  - Left: event color dot (16px circle) and time range "10:00am - 10:30am".
  - Middle: invitee name (bold) and "Event type **30 Minute Meeting**"; for groups "3 invitees"; canceled rows show "Canceled" red badge and strike-through time.
  - "1 host | 0 non-hosts" small gray.
  - Right: **"Details"** toggle with a chevron (expands inline).
- **Expanded details** (two columns):
  - Left column of actions (secondary pill buttons with icons): **"Reschedule"**, **"Cancel"**, then text links "Edit Event Type", "Filter by Event Type", "Schedule Invitee Again", "Report this event".
  - Right column: labelled blocks (eyebrow labels): EMAIL, LOCATION (with "Join now" link for video), INVITEE TIME ZONE, QUESTIONS (question and answer pairs), MEETING HOST, plus guests; **"Add meeting notes"** link [V] (notes visible only to hosts); footer "Created 10 Oct 2026 by Jane Doe".
  - **No-show**: "Mark as no-show" toggle/button on past meetings [V], undo available.
  - Group events: invitee list with three-dots per invitee: "Reschedule invitee", "Remove invitee" [V]; "Edit invitee limit" [V].
- Buffers (when Show buffers is on): small gray blocks before/after with a pencil icon to edit or delete [V].
- Empty state: illustration and "No Upcoming Events" (Past: "No Past Events") [M].

### 10.2 2026 Calendar page [V]

Timeline grouped by date, scroll for past or upcoming, search and filters, select a meeting to open details with a **Notes** tab ("Your notes" area, "Save changes"/"Update"). Can also show connected Google/Outlook events.

### 10.3 Cancel and reschedule from host side [V]

- **Cancel**: modal "Cancel event" with event summary, optional message textarea ("Reason for canceling" / "Add a cancellation message", included in invitee email), buttons "Cancel" (dismiss) and red **"Yes, cancel"**. Group: canceling removes for all; use "Remove invitee" for one.
- **Reschedule**: free plan goes straight to the booking page to pick a new time; paid plans get a choice dialog: **"Share new times to meet"** (cancels and emails a link, optional reminder after 1, 3 or 7 days) or **"Reschedule meeting now"** (pick a new time for the invitee). Round robin prompts to keep assignment or choose a host.

---

## 11. Public booking pages (invitee side)

All public pages: `#FAFAFA` canvas, centered white card, Proxima-like font, `#0A2540` text, blue `#006BFF`/`#004EBA` actions, diagonal "powered by Calendly" ribbon on free plans, **"Cookie settings"** button and **"Privacy Policy"** link at the bottom of the left panel [V].

### 11.1 User landing page `/{username}` [V]

- Page title `Calendly - {Name}`; card centered, max-width about 1060px.
- Top center: avatar (if uploaded, 64-80px circle) [M], **name** as h1 (e.g. "Petar"), welcome message below in `#476788`, default **"Welcome to my scheduling page. Please follow the instructions to add an event to my calendar."** [V].
- 1px divider, then the list of active, non-secret event types in a two-column grid (one column on mobile): each tile shows the event color circle (or left accent), **event name** (bold), optional short description (2 lines max), and a right chevron/triangle; whole tile clickable, hover `#F4F8FF` background. Links append `?back=1` [V].
- Optional logo (Branding) top-left of card [M].
- Empty state if no public events: "No event types available" or similar [M].

### 11.2 Event booking page, step 1: "Select a Date & Time" [V]

Document title: **"Select a Date & Time - Calendly"** [V].

**Container**:
- Wrapper: `margin-top: 66px; margin-bottom: 30px; padding: 0 5%`, and `min-height: 700px` on tall screens [V].
- Card: `width: 95%`, `max-width: 800px` and `min-height: 550px` before a date is chosen; when a date is selected the card widens to `min-width: 900px; max-width: 1060px` with a `0.22s ease-out` transition [V].
- Two panels: **side panel** (event details) `width: 50%; min-width: 300px; border-right: 1px solid #D4E0ED; padding-bottom: 25px`, shrinking to `width: 35%` when the times column opens; **main panel** `flex: 1 1 50%` [V].

**Left side panel (event details)** [V]:
- Optional back arrow circle button (44px, 1px border, blue arrow) top-left when arriving from the landing page (`back=1`) [M].
- Optional company logo at top, separated by a divider (Branding) [M].
- Host avatar (if set) and **host name** in `#476788`, 16px bold, 24px line-height [V].
- **Event type name** as h1, 28px bold, 32px line-height, `#0A2540` [V].
- Detail rows (icon 20px in `#476788` + text 16px semibold-ish, `#476788`/`#0A2540`), 12px apart on desktop [V]:
  - Clock icon + **"30 min"** (becomes a dropdown when multiple durations exist) [V].
  - Location icon + text, e.g. video icon + **"Web conferencing details provided upon confirmation."** [V], phone icon + "Phone call", pin icon + address, or "Location will be provided after booking".
  - Payment: card icon + "$100.00 USD" [M].
- Description rich text under the details [V].
- Bottom: "Cookie settings" and "Privacy Policy" small links [V].
- Padding: name and event name use `padding-left: 30px; padding-right: 10px` on desktop [V].

**Main panel (calendar)** [V]:
- Heading **"Select a Date & Time"** (h2, 22px bold, left aligned with 32px side padding; 20px bottom margin) [V].
- **Month header**: centered month title "October 2026" (14px bold), with circular arrow buttons (38px, blue `#004EBA` chevrons, light blue `#F4F8FF` fill when enabled) aria-labels **"Go to previous month"** / **"Go to next month"**; previous is disabled for the current month [V]. Live region announces "October is now displayed" [V].
- **Weekday header** row: "Sun Mon Tue Wed Thu Fri Sat" in `#476788`, 12px semibold [V] (Monday-first when the user's locale/setting says so) [M].
- **Day grid** (table `aria-label="Select a Day"`) [V]:
  - Each day is a **44x44 circle button**, 16px text.
  - **Available day**: fill `#F4F8FF`, text `#004EBA`, bold; aria-label "Monday, October 12 - Times available" [V].
  - **Unavailable day**: no fill, text `#476788` (gray-blue), disabled; aria-label "Sunday, October 4 - No times available" [V].
  - **Hover/focus** (not selected): fill `#F4F8FF` (classic) / `#E6F0FF`, text `#004EBA` [V].
  - **Selected day**: fill `#006BFF`, white text [V].
  - **Today**: a 4px dot centered 13px below the number in `currentColor` (5px when bold) [V], plus `aria-current="date"`.
  - Days from adjacent months are rendered but `visibility: hidden` [V].
  - If the current month has no availability, the picker jumps to the first month with availability [M].
- **Time zone** block below the calendar [V]: label **"Time zone"** (bold), then a button with a globe icon, the zone name **"Eastern Time - US & Canada"**, the current local time in parentheses **"(7:10pm)"** and a chevron. Opens a dropdown (`timezone-menu`): search input, a 12h/24h toggle ("am/pm" | "24h") [M], and grouped lists (US/CANADA, AMERICA, AFRICA, ASIA, ATLANTIC, AUSTRALIA, EUROPE, PACIFIC, UTC) with current time on the right of each item [M]. Changing the zone re-renders days and times. Hidden/locked when the event locks the time zone [V].
- **Troubleshoot** link (only for the logged-in owner or in preview) at the bottom: toggles diagnostics mode [V].

### 11.3 Step 1b: date selected, time slot list [V]

- The card widens; a third column appears at right with the date subtitle, e.g. **"Wednesday, October 14"** (16px regular, 38px tall, sticky on tablet) [V].
- Scrollable list of **time buttons**: `width: 100%; height: 52px; border: 1px solid #006BFF; color: #004EBA; border-radius: 4px`, time label bold (e.g. "9:00am"), `margin: 10px 2px` between slots [V]. Hover/focus: border 2px `#006BFF` [V].
- 12h format "9:00am" (lowercase, no space) by default; 24h "09:00" when toggled [M/V class names `time-notation12h`, `time-notation24h`].
- **Click a time**: the button splits [V]:
  - Left half (`48.5%`): the selected time on a dark translucent fill `rgba(10,37,64,0.5)` with white text.
  - Right half (`48.5%`, `margin-left: 3%`): **"Next"** button, `#006BFF` fill, white text, shadow `0 1px 6px 0 rgba(10,37,64,0.1)`, slides in from `translateX(40px)`; hover `#004EBA`; focus outline 2px `#006BFF`.
- Clicking another time moves the split. Clicking "Next" goes to step 2.
- Group events: under each time "X spots left" (when Display remaining spots is on) [M].
- No times for the date: "No times available" text [M] (normally prevented because only bookable days are clickable).
- Troubleshoot mode: unavailable slots render with a **dashed border** `1px dashed #A6BBD1` and a code label (CALENDAR, TOOSOON, BUFFER, ...); double-bookable slots get an outline [V].

### 11.4 Step 2: "Enter Details" form [V/M]

- Left panel keeps event details and adds: calendar icon + **"10:00am - 10:30am, Wednesday, October 14, 2026"**, globe icon + **"Eastern Time - US & Canada"** [M].
- Right panel: back arrow circle button (top-left) to return to the calendar; heading **"Enter Details"** (22px bold) [M].
- Fields (labels bold 14px above inputs, required marked with asterisk) [M]:
  - **"Name *"** (or "First Name *" and "Last Name *").
  - **"Email *"**.
  - **"Add Guests"** secondary pill button; clicking reveals **"Guest Email(s)"** input (chips, comma separated) with helper "Notify up to 10 additional guests of the scheduled event."
  - Location choice (radio list) when multiple locations or Ask invitee.
  - Phone number with country flag selector when phone location or required phone question.
  - Custom questions in order (textarea for Multiple lines, radio, checkbox, select, phone).
  - Default question **"Please share anything that will help prepare for our meeting."** (textarea).
  - Payment section (if required): Stripe card element / PayPal buttons and terms text, the submit button becomes "Pay & Schedule" style [M].
- Terms text above the button: "By proceeding, you confirm that you have read and agree to Calendly's Terms of Use and Privacy Notice." (links) [M].
- Primary pill **"Schedule Event"** [V via tutorials], disabled while submitting with a spinner.
- Validation: inline red text under fields ("Can't be blank", "Invalid email") [M].
- Invisible reCAPTCHA runs on submit [V]. Clone: optional Turnstile/honeypot.
- If the slot was taken meanwhile: inline error "Sorry, that time is no longer available. Please choose another time." and return to step 1 [M].

### 11.5 Confirmation page [V for title copy, M for layout]

- Single centered card (no side panel), host avatar at top (optional).
- Green check circle icon + heading **"You are scheduled"** (24px bold).
- Subtext **"A calendar invitation has been sent to your email address."**
- Optional secondary pill **"Open Invitation"** (opens the calendar event) [M].
- Summary box (1px border, 8px radius, 24px padding): event name (bold 18px), person icon + host name, calendar icon + "10:00am - 10:30am, Wednesday, October 14, 2026", globe icon + time zone, location icon + "Web conferencing details to follow." or the meeting link [M].
- Links (if enabled): **"Schedule another event"** (custom link name, returns to the same event type) [V] and custom links added in Confirmation page settings [V].
- Free-plan promo footer: "Schedule your own meetings with Calendly for free" with sign-up buttons [M]. Clone: optional "Powered by" footer only.
- Group events: also offers "Add to calendar" (Google, Outlook, Office 365, iCal .ics download) [M]. Clone: always offer "Add to calendar" links plus .ics.
- If Redirect is configured: immediately navigate to the external URL, optionally with query params (`invitee_full_name`, `invitee_email`, `event_type_name`, `event_start_time`, `answer_1`...) [M].

### 11.6 Cancel page `/cancellations/{token}` [M]

- Same two-panel card. Left: event details (name, host, time, time zone, location).
- Right: heading **"Cancel Event"** with copy "Are you sure you want to cancel?" (optional), textarea **"Reason for canceling"** (optional, or required if the host demands), cancellation policy text if set, primary pill **"Cancel Event"**.
- After submit: **"Cancellation Confirmed"** heading with "Your meeting with {Host} at {time}, {date} is cancelled." and a link/button "Schedule another event" (back to booking page).
- Already canceled: "This event has already been canceled."; past event: "This event has already occurred."

### 11.7 Reschedule page `/reschedulings/{token}` [V for "former" styling, M for copy]

- Same booking flow (Select a Date & Time). Left panel lists the event details with a small label **"Former Time"** (11px label) above the old date/time which is shown with **line-through** [V CSS `former-label`, `crossed-items`].
- Step 2 is prefilled (name, email, answers read-only or editable) and adds **"Reason for rescheduling"** textarea (optional; cannot be made required) [V community]. Button **"Reschedule Event"** (older "Update Event") [M].
- Confirmation: "You are scheduled" (or "Rescheduled") with the new time, and old time struck through [M].

### 11.8 Embed variants [V]

- **Inline embed**: the booking page inside an iframe (`min-width: 320px; height: 700px` default), no outer canvas, optional hidden event details (`hide_event_type_details=1`), hidden cookie banner (`hide_gdpr_banner=1`), colors via `background_color`, `text_color`, `primary_color` (hex without `#`), and `hide_landing_page_details=1` for landing page embeds.
- **Popup widget**: floating pill button bottom-right ("Schedule time with me", `#0069FF` background, white text, optional "powered by Calendly" under it); click opens a modal overlay (dark scrim, white rounded frame with close "x" top-right, spinner while loading) containing the booking page.
- **Popup text**: inline text link that opens the same modal.
- The modern embedded card uses no border, 1.25rem radius and soft shadow (section 1.4) [V].
- Embed posts window messages to the parent: `calendly.profile_page_viewed`, `calendly.event_type_viewed`, `calendly.date_and_time_selected`, `calendly.event_scheduled`, `calendly.page_height` [M, from Calendly embed API docs]. Clone: emit equivalents.

### 11.9 Error and edge states [M]

- Unknown user/event: "This Calendly URL isn't valid" style 404 card with a link to the homepage.
- Event turned off: card with "This event type is not currently available" / "Sorry, this page is unavailable".
- Single-use link already booked: "Someone has already used this link to book a meeting" [V community].
- No availability in range: calendar shows all days disabled and a message "No times available" plus "View next month" button [M].
- Loading: skeleton (gray rounded bars) for details and a spinner in the calendar area.

### 11.10 Booking page responsive behavior [V class names, M for exact breakpoints]

Calendly computes `is-phone`, `is-tablet-up`, `is-tablet-down`, `is-desktop-up` modes:

- **Desktop** (wide, about 1000px+): two panels side by side, third column (times) appears on date selection, card animates from 800px to 1060px.
- **Tablet** (about 600-999px): side panel on top (centered text, content constrained to 440px via `padding: calc((100% - 440px) / 2)`), calendar below; the time list appears below the calendar with a sticky date subtitle [V].
- **Phone** (below about 600px): card is full-bleed (no border, no radius, full height `100dvh`), event details centered at top (event name 26px, side padding 25px), calendar full width, picking a date slides to a separate times view with a back arrow; "Next" split button behavior unchanged; details form single column [V for sizes].
- The ribbon shrinks (`top: 15px; left: -5px`, "POWERED BY" 7px) on small screens [V].

---

## 12. Meeting polls (Doodle replacement)

### 12.1 Rules [V]

- Anyone with the link can vote, no account needed. Up to **40 time slots** and **40 participants**. You cannot add new time slots after publishing. Workflows and rescheduling are not supported. Votes are final once submitted (cannot change). Invitees see times in their own time zone. If the invitee is also a Calendly user, the poll can highlight times that work across both calendars. Proposed times can be **reserved** on the host calendar (placeholder events, RESERVED troubleshoot code) [V].
- A poll closes when you book the meeting, when all proposed times pass, or when you delete it (link becomes inactive, voting disabled) [V].
- You can book over Calendly buffers; conflicts with external events are flagged but the time remains visible; conflicts with Calendly bookings cannot be booked over [V].
- Other voters' names are visible to invitees only if **"Show votes on page"** is on [V].

### 12.2 Create poll (host) [V for steps and labels]

Entry: **+ Create > More ways to meet > Meeting poll** (also from browser extensions).

1. **Choose times to offer**: set **time zone**, **meeting duration**, **additional hosts**. A week calendar (same as one-off meeting) shows your existing events; click to add proposed slots (overlapping and consecutive slots allowed). Counter **"x/40 times selected"** (click it to see/remove the list) and **"Clear all"**. Button **"Next"**. Validation: "Select at least one host" [V community].
2. **Set up meeting details**: **meeting name**, **location**, optional **description/instructions**, **Optional settings** (Reserve times; Show votes on page; optional invitee form/questions [M]). Button **"Share meeting poll"**.
3. **Share**: unique link (editable ending), **"View live page"**, **"Copy Link"**.

Marketing summarizes the flow as "Kick off the poll", "Reserve times", "Share the link", "Book the meeting" [V].

### 12.3 Polls list (Scheduling > Meeting polls tab) [V/M]

Card or row per poll: poll name, duration and location, number of votes ("3 votes"), status ("In progress", "Scheduled" with the booked time, "Closed"), **Copy link**, kebab (**View**, **Edit**, **Delete**). Edits allowed while in progress; booking closes the poll [V]. Empty state: "Find a time that works for everyone. Send a meeting poll to let invitees vote on times." with "+ Create meeting poll" [M].

### 12.4 Voting page (invitee) [M]

- Same visual shell as booking pages. Left panel: host name/avatar, poll name, duration, location, description, time zone selector.
- Right panel heading: "Select the times that work for you" (or "Vote for times that work for you"), with subtext "Times are shown in {time zone}".
- Options grouped by date (date headers "Wed, Oct 14"), each option row: time range "10:00am - 10:30am", a checkbox or Yes toggle chip (blue check when selected); if "Show votes on page" is on, a vote count and small avatars/initials of voters next to each option; "Best time" or star marker on the current leader.
- Optional "Sign in with Calendly to see your availability" (clone: optional "Connect calendar to see conflicts"; conflicts shown as a small "Busy" tag).
- Footer form: "Name *", "Email *", button **"Submit"** (or "Vote").
- Thank-you state: check icon, "Thanks for voting!" / "Your votes were submitted", "{Host} will send a calendar invitation once a time is booked." Votes cannot be changed.
- Closed state: "This poll is closed" (booked shows "This meeting has been scheduled for {time}").

### 12.5 Results and booking (host) [V]

- Open the poll from the Meeting polls tab: results list of options sorted by date with vote counts; **"Top times"** section highlighting the most voted; hover votes to see who voted.
- On a time slot, click **"Book"** [V]. Pop-up shows meeting details and invitee list (voters prefilled), **"+ Add Invitee"** (name and email for people who did not vote) [V], then **"Book Meeting"** [V]. Calendly sends calendar invitations to all, location details auto-populated, the poll closes and reserved placeholders are cleared.
- Hosts receive notifications as votes come in [V].

---

## 13. Workflows (2026 "Automations")

### 13.1 List page [V/M]

- Title **"Workflows"**. Primary button **"+ Create workflow"** [M] (2026: "Create your own automation" [V]).
- Tabs [M]: "My workflows" and "Templates" (2026 page: My automations, Automations assigned to you, Managed automations, Integrations & apps [V]).
- Each workflow row/card: name, trigger summary ("24 hours before event starts"), action summary ("Send email to invitees"), "Active on 3 event types", kebab (**Edit, Clone, Delete**) [V edit/clone/delete], toggle for on/off [M]. Workflows sort chronologically and cannot be rearranged (Calendly recommends a naming system) [V].
- Limit: up to **50** workflows per user or team [V].
- Templates gallery: cards with icon, title, description, **"Use automation"** / "Use workflow" [V]. Typical templates [M]: "Email reminder to host", "Email reminder to invitees", "Text reminder to host", "Text reminder to invitees", "Send thank you email", "Email your own feedback survey", "Text booking confirmation to invitee", "Text cancellation notification to host", "Remind invitees to join via email", "Ask for a review", "Send reconfirmation request", "Email no-shows to reschedule".

### 13.2 Builder [V for sections]

- **Workflow name** field [V].
- **"When this happens"** [V]: trigger select: **New event is booked**, **Before event starts**, **Event starts**, **Event is rescheduled**, **Event ends**, **Event is canceled**, **No-show marked**; plus **time** offset for timed triggers ("24" [hours | minutes | days] "before event starts" / "after event ends").
- **"Do this"** [V]: action select, then **Next**. Actions [M]: Send email to invitees, Send email to host, Send email to other emails, Send text to invitees, Send text to host, Send text to other phone numbers; (newer: Update contact / Create task). Click **Edit** to customize the message: subject, rich text body, **Variables** toolbar dropdown [V] (Event Name, Event Date, Event Time, Event Description, Location, Event Time Zone, My Name / Host Name, Invitee Full Name, Invitee First Name, Invitee Last Name, Invitee Email, Questions and Answers, Cancel link, Reschedule link [M]); variables render as chips like `{{event_name}}`. Checkbox "Include cancel and reschedule links" [M]. **Done** [V].
- **"Add Actions"** to add more steps [V].
- **"Which event types will this apply to?"** checkbox list with search, **Apply** [V].
- **Save** [V]. Changes only apply to future meetings [V].
- Text messages require invitee phone (adds a "Send text reminder to" phone field on the booking form) [M]. Reconfirmation workflows ask invitees to confirm; unconfirmed meetings appear in an "Unconfirmed" tab [V reconfirmation exists].
- No-shows only receive no-show workflows, not thank-you/follow-up workflows [V].

---

## 14. Routing forms

### 14.1 List page [V/M]

- Classic: sidebar **Routing**; 2026: **Scheduling > Routing forms** [V].
- Button **"New routing form"** with options **"Create a new form"** (or connect HubSpot/Marketo/Pardot/Salesforce forms) [V]. Modal: "Form name" input, **"Create form"** [V].
- List rows: form name, status (Published/Draft), submissions count, last updated, **Copy link**, kebab (Edit, Duplicate, Permissions, View responses, Export, Delete) [M].

### 14.2 Builder [V]

- Tabs/steps across the top [M]: **Form**, **Routing logic**, then Preview/Publish.
- **Form** step: optional **headline** and **description**, customizable **submit button text** [V]. **"Add a question"** with format choices [V; formats M]: Name, Email, Phone, Short text, Long text, Dropdown, Radio buttons, Checkboxes. Each question card: label, required toggle, options list, "Save" [V]. Button **"Next"** [V].
- **Routing logic** step [V]: **"Create"** a route, choose **"Use form answers"** (or Salesforce/HubSpot lookup), condition builder rows: [question] [qualifier: is / is not / contains / is any of ...] [answer], combine with **"or"** / **"and"**, **"Add another question"**; then a **Destination**: **Event Type** (select), **Custom message** (text), **External URL** (url); **Save**. Routes evaluated top to bottom (drag to reorder) [M].
- **Fallback route** [V]: always present for visitors who match no route; defaults to a custom message, editable.
- **"Preview form"** [V]: popup where you can fill and submit to test routing; responses are not recorded.
- **"Publish form"** [V] then share dialog: **"Share a link"** (copy) and **"Add to website"** (embed code) [V].
- Public form page: same booking-page shell, single column card, headline, description, questions, primary submit button; on submit routes to the event booking page with answers prefilled, or shows the message, or redirects [M].

---

## 15. Contacts [V features, M layout]

- Title **"Contacts"**, search "Search contacts", **"+ Add contact"** (or "New contact") button.
- Table: Name (avatar + name), Email, Phone, Company, Job title, Location/Country, Last meeting, Next meeting; sortable headers; row hover `#F4F8FF`.
- Contacts are created/updated automatically when someone books [V].
- Contact detail drawer/page: name, email, phone, company, job title, LinkedIn, time zone; actions **"Book meeting"** (schedule now), **"Share availability"** (send a link by email, paid), **"Email"** (send email with or without a booking link, paid) [V]; sections "Upcoming meetings", "Past meetings" (meeting history), notes; "Edit" and "Delete".
- "Follow up on missed opportunities": contacts who received your link but have not booked [V, limited].
- Empty state: "Contacts are created automatically when someone schedules with you, or you can add them manually." with "+ Add contact" [M].

---

## 16. Analytics [V widgets, M layout]

- Title **"Analytics"**. Tabs: **"Events"** and **"Routing"** (routing form analytics) [M].
- Filter bar at the top: **date range** (default last 30 days, up to 1 year), **User**, **Team**, **Group**, **Event type** [V]. Owners/admins see org-wide data; users see their own [V]. Export button [M].
- Widgets [V]: **Created events**, **Completed events** (with trend), **Rescheduled events**, **Canceled events** (KPI tiles with big number and sparkline/line chart), **Event distribution by duration** (bar chart), **Popular events** (ranked list with counts), **Popular times** (day of week x hour heatmap or bar chart of busiest days and times), plus "Users with the most events" for admins [M].
- Admin dashboard ("Activity last week"): created, completed, canceled events in the past 7 days [V].
- Empty state: "No data for this time period" [M].

---

## 17. Integrations & apps [M layout, V for which integrations matter]

- Title **"Integrations & apps"**, search "Find integrations, apps, and more".
- Left category filter or chips: All, Calendars, Video conferencing, CRM, Email messaging, Embed, API and connectors, Payments, Analytics, Recruiting, Extensions, Sales and marketing.
- Grid of tiles (about 240x160): logo top-left, name bold, one-line description, "Connected" green badge or nothing; whole tile clickable; some tiles labeled "Popular" or "New".
- Tiles relevant to the clone: Google Calendar, Office 365 / Outlook.com Calendar, iCloud (CalDAV), CalDAV, ICS feed (clone-only), Zoom, Google Meet, Microsoft Teams, Jitsi (clone-only), Stripe, PayPal (later), Twilio SMS (clone-only), Webhooks, API keys, Embed, Zapier-style webhooks.
- Detail page per integration: header with logo, name, "Connect" primary button (or "Disconnect"), description, "How it works" bullets, settings once connected (e.g. Zoom: "Connected as user@example.com", "Disconnect").
- Video conferencing connection is required before choosing it as a location; the location picker deep links here [V].

---

## 18. Admin center and account settings [V lists, M layout]

- **Admin center** (Classic) / **Settings > Admin** (2026): Workspace (organization name, logo), Dashboard, People (Active users, Pending users, Groups, Event type permissions, Automations permissions, Invitation permissions), Access (Domain control, Single sign-on, User provisioning, Activity log), Security (Data, Privacy), Billing, Managed events [V]. Users table: Name, Email, Role (Owner, Admin, User), Status, Teams, last active; "Invite users" button opens modal with email chips and role select [M].
- **Profile** [M]: avatar upload ("Upload picture", JPG/PNG/GIF max 5MB), Name, Welcome message (textarea, shown on landing page), Language, Date format (MM/DD/YYYY or DD/MM/YYYY), Time format (12h am/pm or 24h), Country, Time zone; "Save changes"; "Delete account" danger zone.
- **Branding** [M/V]: Logo upload ("Your logo will appear on your booking pages and in notifications"), toggle "Use Calendly branding" (shows/hides the ribbon) [V community], booking page colors (Background, Text, Button & link) with live preview [V].
- **My Link** [M]: "Changing your Calendly URL will mean that all of your copied links will no longer work and will need to be updated." with `calendly.com/` prefix input and "Save changes".
- **Notifications / Communication settings** [M]: email notification toggles ("New bookings", "Cancellations", "Daily agenda email"), and the no-reply email option.
- **Login preferences / Security** [M]: connected sign-in methods (Google, Microsoft, email/password), change password, active sessions, two-factor (optional).
- **Cookie settings** [V]: modal from the booking page "Cookie settings" button with categories and "Accept all"/"Reject non-essential".

---

## 19. Notifications and email copy

Calendly sends two notification types [V]: **Calendar invitation** (event created in host's connected calendar, invitee added as guest, updates propagate; from the host calendar address) and **Email confirmation** (Calendly sends an .ics; from notifications@calendly.com; replies go to login email unless a no-reply address is set). Group events always use email confirmations. Hosts always get a booking notification email from Calendly that cannot be turned off [V].

Representative email patterns [M, adapt]:

- Invitee confirmation subject: "Confirmed: {Event Name} with {Host Name} on {Weekday}, {Month} {Day}, {Year}". Body: "Hi {Invitee First Name}," / "Your {Event Name} with {Host Name} at {Time} ({Time zone}) on {Date} is scheduled." then **Event** block, **Location**, **Invitee Time Zone**, **Questions**, then "Need to make changes to this event?" with **Cancel** and **Reschedule** links, footer "Powered by Calendly".
- Host new booking subject: "New Event: {Invitee Name} - {Time} {Weekday}, {Month} {Day}, {Year} - {Event Name}". Body: "Hi {Host Name}, A new event has been scheduled." Fields: Event Type, Invitee, Invitee Email, Event Date/Time, Location, Invitee Time Zone, Questions, button "View event in Calendly". Booked-over conflict alert block when free/busy rules allowed it [V].
- Cancellation subject: "Canceled: {Event Name} with {Invitee Name} on {date}" with "Reason: {reason}" and canceled-by.
- Reschedule: "Updated: {Event Name} ..." with former time struck through.
- Reminder: "Reminder: {Event Name} with {Host Name} at {Time} {Date} ({TZ})" default 24 hours before.
- Text reminders (Twilio): "Reminder: {Event} with {Host} on {date} at {time}. Details: {link}. Reply STOP to opt out." [M]

---

## 20. Mobile responsive behavior (app, not booking pages) [M]

- App pages collapse to one column below about 768px: sidebar becomes a drawer, page header keeps title + "+ Create" icon button.
- Scheduling list: cards stack full width; quick actions move into the kebab; bulk select via long-press is not on web, keep checkboxes.
- Event type editor: settings panel full width; "Preview" toggles to a full-screen preview with a "Back to editor" bar.
- Availability: weekly rows wrap intervals to multiple lines; Date-specific hours column moves under Weekly hours.
- Meetings: rows show time, name and event; Details expands to a single column.
- Minimum tap target 40px; inputs 16px font to avoid iOS zoom.

---

## 21. Implementation checklist for the clone (UX acceptance criteria)

Use this as a parity checklist. Each line is something a user would notice if it were missing.

1. Booking calendar: 44px circle days, `#F4F8FF` fill + bold `#004EBA` for available, `#006BFF` selected with white text, today dot, disabled previous month arrow, adjacent month days hidden, aria labels "Weekday, Month D - Times available".
2. Time slot list: 52px outlined buttons, click splits into [dark time chip][blue "Next"] with slide-in animation; card widens from 800px to 1060px; side panel 50% to 35%.
3. Time zone selector under the calendar with local time "(7:10pm)" and grouped searchable menu; 12h/24h toggle.
4. Left panel order: host name (gray), event name (28px bold), duration row, location row, description; "Cookie settings" and "Privacy Policy" at the bottom.
5. Details form with Add Guests, custom questions (6 answer types), required asterisks, terms sentence, "Schedule Event".
6. Confirmation "You are scheduled" + "A calendar invitation has been sent to your email address." + summary box + "Schedule another event".
7. Cancel and reschedule pages using the same shell, Former Time struck through, reason fields.
8. Landing page with default welcome message text.
9. Event type list with color strip, kebab items in the exact order (section 5.1), On/Off switch at the bottom of the menu, Copy link, hover quick actions, drag reorder, bulk toolbar.
10. Create menu with the four kinds and their "1 host → 1 invitee" style subtitles, plus One-off meeting and Meeting poll.
11. Event editor: left accordion panel + live preview, "More options" reveals the 8 sections in order, sticky "Save changes".
12. Availability: Weekly hours rows with "+", "x", copy icon; Date-specific hours with "+ Hours" modal; schedule dropdown with "+ Create schedule"; "Active on"; auto-save; List/Calendar view; time zone at the bottom; Holidays by country.
13. Calendar settings: conflicts calendars checklist, single "Calendar to add events to", two sync checkboxes, "+ Connect calendar account".
14. Meetings: Upcoming/Past/Date Range tabs, grouped by date, expandable Details with Reschedule/Cancel/notes/no-show, Export CSV, Filter.
15. Meeting polls: week grid to pick up to 40 slots, "x/40 times selected", "Clear all", details step, share step, vote page with name/email, results with Top times and "Book", "+ Add Invitee", "Book Meeting".
16. Workflows: "When this happens" / "Do this" builder with the 7 triggers, variables, event type assignment, templates.
17. Routing forms: questions, routes with and/or conditions, three destination types, fallback route, preview, publish, share.
18. Troubleshoot mode on the owner's booking page with Calendly's codes: CALENDAR, NOCAL, DAILY MAX, WEEKLY MAX, MONTHLY MAX, DURATION, RANGE, TOOSOON, EVENT, GROUP, OVERLAP, HOLIDAY, MEETING LIMIT, HOST, ROUNDROBIN, UNFAIR, BUFFER, PAST, RESERVED [V].
19. Powered-by ribbon with the exact geometry in 1.5, hideable via Branding.
20. Every blue on public pages driven by `--primary-color` so Branding and embed `primary_color` work.

### 21.1 Troubleshoot code reference [V]

| Code | Meaning | Fix hint shown |
|---|---|---|
| CALENDAR | A "Busy" calendar event is blocking the time | Change the event to "Free" or remove it |
| NOCAL | Calendly can't access your calendar | Reconnect your calendar |
| DAILY MAX / WEEKLY MAX / MONTHLY MAX | Event type meeting limit reached | Adjust limits under Limits and buffers |
| DURATION | Not enough time for your event | Shorten the event or extend availability |
| RANGE | Date is outside your availability window | Adjust the date range |
| TOOSOON | Too soon based on minimum notice | Adjust minimum scheduling notice |
| EVENT | Another Calendly event of this event type is booked | Reschedule or use Free/busy rules |
| GROUP | Group event has max attendees | Increase the max invitee number |
| OVERLAP | Another Calendly event is booked | Reschedule or use Free/busy rules |
| HOLIDAY | Date is marked as a holiday | Edit holidays |
| MEETING LIMIT | Host-level meeting limit reached | Host adjusts their meeting limit |
| HOST | One or more Collective hosts unavailable | Make sure all hosts are free |
| ROUNDROBIN | No host available under distribution rules | Update host availability or distribution |
| UNFAIR | Booking would distribute meetings unfairly | Adjust distribution settings |
| BUFFER | A buffer is blocking this time | Edit or remove the buffer |
| PAST | Time is in the past | Choose a future date |
| RESERVED | A poll or pending one-off meeting holds this time | Clear reserved times |

### 21.2 Behavior facts worth encoding (from help center) [V]

- Buffers use the full meeting plus buffer window for availability, are checked against connected calendars, and may extend outside working hours at the edges (a 4:30pm slot with a 30 min after-buffer is still bookable when hours end at 5pm). Changing buffers does not affect already booked meetings.
- Both event-type limits and host-level limits apply; whichever is hit first blocks.
- Round robin "equal distribution" hides a host 3+ meetings ahead; adding/removing a host resets counts.
- Calendly keeps blocking times for events it created even if marked "free" in the calendar.
- Date-specific hours cannot override an active holiday.
- Each schedule is tied to one time zone; DST handled automatically.
- Rescheduling still follows event type availability and conflict rules (no override).
- Minimum notice and date range live in the Availability section; start time increments in Booking page options; lock time zone in Booking page options.

---

## 22. Sources

Calendly Help Center (all fetched Oct 2026): event-type-editor-overview, how-to-customize-your-event-types, how-to-organize-and-manage-your-event-types, how-to-set-up-an-event-type, event-types-overview, group-event-type-overview, round-robin-distribution-overview, how-to-set-up-multiple-durations-for-an-event-type, how-to-add-or-remove-invitee-questions, how-to-add-links-to-the-event-confirmation-page, how-to-set-your-availability, availability-overview, how-to-fine-tune-your-availability-settings, how-to-set-meeting-limits, how-to-use-buffers, free-busy-rules-overview, how-to-edit-holidays-within-calendly, time-zones-overview, how-to-connect-your-google-calendar, how-to-troubleshoot-unavailable-times-that-should-be-available, how-to-manage-your-meetings, how-to-cancel-a-meeting, how-to-reschedule-a-meeting, how-to-create-a-one-off-meeting, how-to-create-a-single-use-link, how-to-set-up-a-meeting-poll, meeting-polls-overview, automations-overview, how-to-create-an-automation, how-to-create-a-routing-form, contacts-overview, calendly-scheduling-notifications, how-to-set-up-basic-notifications, how-to-customize-your-embed, calendly-analytics (search excerpt), meet-the-new-calendly.

Live pages: calendly.com/signup (copy), a public business booking page and landing page (DOM structure, aria labels, default welcome message, title "Select a Date & Time - Calendly"), production booking stylesheet `assets.calendly.com/assets/booking/css/booking-df31d3071.css` (all [V] tokens, sizes, colors, ribbon geometry, slot and calendar styles, responsive class names, brand-2026 theme).

Secondary: Calendly blog (meeting-polls, redesigned-nav-event-types, stripe-integration, pay-at-booking), Calendly Community threads (reschedule reason, single-use link error, cancel message), refero.design Calendly.com style reference (marketing palette), YouTube "How to use Calendly for Beginners" chapter list (Simpletivity, 2024).
