// OWNER: foundation-ui.
//
// Gallery: replicas of the public landing page and booking page built from the public components (visual parity with
// the owner's reference screenshots: 1060px landing card, 800px booking card widening to 1060px, 44px day circles,
// the split time slot and the ribbon). Static demo data only.
"use client";

import { Clock, Globe, Video } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type * as React from "react";
import { CookieBanner } from "@/components/public/cookie-banner";
import { COOKIE_CONSENT_EVENT, readCookieConsent } from "@/components/public/cookie-consent";
import { BackButton } from "@/components/public/back-button";
import {
  BookingBrandHeader,
  BookingCard,
  BookingDetailList,
  BookingDetailRow,
  BookingEventTitle,
  BookingHostName,
  BookingMainSection,
  BookingPanelHeading,
  BookingSideFooter,
  BookingSideSection,
} from "@/components/public/booking-card";
import { EventTypeList } from "@/components/public/event-type-list";
import { LandingEvents, LandingFooter } from "@/components/public/landing-layout";
import { ProfileHeader } from "@/components/public/profile-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { brandingStyle } from "@/components/public/public-page-shell";
import { TimeSlotList } from "@/components/public/time-slot-list";
import { Avatar } from "@/components/ui/avatar";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { dayLabel } from "@/components/ui/month-calendar-utils";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TimeZoneButton } from "@/components/ui/time-zone-select";
import { Switch } from "@/components/ui/switch";
import { GallerySection } from "./section";

const TEST_TRACKER_SRC = "https://www.googletagmanager.com/gtag/js?id=G-KAIROSDEMO";
const subscribeConsent = (cb: () => void) => {
  window.addEventListener(COOKIE_CONSENT_EVENT, cb);
  return () => window.removeEventListener(COOKIE_CONSENT_EVENT, cb);
};

/** Simulates PublicTrackers: loads a tracker script only after consent (GEN-14). */
function ConsentDemo() {
  const [configured, setConfigured] = useState(false);
  const consent = useSyncExternalStore(subscribeConsent, readCookieConsent, () => "unknown" as const);
  const load = configured && consent === "granted";
  useEffect(() => {
    if (!load || document.querySelector(`script[src="${TEST_TRACKER_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = TEST_TRACKER_SRC;
    script.async = true;
    document.head.appendChild(script);
  }, [load]);
  return (
    <div className="flex flex-col gap-2">
      <Switch label="Simulate a configured tracker (GA4)" checked={configured} onCheckedChange={setConfigured} />
      <p className="text-body-md text-ink-2" data-testid="consent-state">
        {`Consent: ${consent}. Tracker ${load ? "loaded" : "not loaded"}.`}
      </p>
      {configured && <CookieBanner trackersConfigured />}
    </div>
  );
}

const AVAILABLE = ["13", "14", "15", "16", "18", "20", "21", "22", "23", "25", "27", "28"].map((d) => `2026-10-${d}`);
const SLOTS_12 = ["9:00am", "9:30am", "10:00am", "10:30am", "11:00am", "1:00pm", "1:30pm", "2:00pm", "3:30pm", "4:00pm"];
const SLOTS_24 = ["09:00", "09:30", "10:00", "10:30", "11:00", "13:00", "13:30", "14:00", "15:30", "16:00"];

function Canvas({ children, color }: { children: React.ReactNode; color: string | null }) {
  return (
    <div data-force-light="" style={brandingStyle({ primaryColor: color })} className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-canvas px-[5%] pt-[66px] pb-[30px] max-[599px]:px-0 max-[599px]:pt-0">
      {children}
    </div>
  );
}

export function PublicSection() {
  const [color, setColor] = useState<"default" | "red">("default");
  const primary = color === "red" ? "#ff0000" : null;
  const [month, setMonth] = useState("2026-10");
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [zone, setZone] = useState("America/New_York");
  const [hour12, setHour12] = useState(true);
  const [mobileView, setMobileView] = useState<"main" | "times">("main");
  const slots = (hour12 ? SLOTS_12 : SLOTS_24).map((label, i) => ({ value: `${date ?? "x"}-${i}`, label, detail: i === 2 ? "3 spots left" : null }));

  return (
    <GallerySection id="public" title="Public pages" description="Landing page and booking page replicas. Every blue reads --primary-color (try the red branding).">
      <ConsentDemo />
      <SegmentedControl<"default" | "red">
        aria-label="Branding color"
        value={color}
        onValueChange={setColor}
        options={[
          { value: "default", label: "Classic blue" },
          { value: "red", label: "Red (ff0000)" },
        ]}
      />
      <div data-testid="landing-replica">
        <Canvas color={primary}>
          <PublicCard width="default">
            <ProfileHeader name="Julian Joseph" welcomeMessage="Welcome to my scheduling page. Please follow the instructions to add an event to my calendar." />
            <LandingEvents>
              <EventTypeList
                items={[
                  { id: "30min", name: "30 Minute Virtual", color: "#8247f5", href: "/app/dev/ui#public" },
                  { id: "60min", name: "60 Minute Virtual", color: "#8247f5", href: "/app/dev/ui#public" },
                  { id: "meal", name: "In-Person Meal or Coffee", color: "#17e885", href: "/app/dev/ui#public" },
                ]}
              />
            </LandingEvents>
            <LandingFooter>
              <PublicFooterLinks showPrivacyPolicy={false} operatorEmail="operator@example.com" pageUrl="https://kairos.example/julianjoseph" />
            </LandingFooter>
          </PublicCard>
        </Canvas>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-label">Phone view</span>
        <SegmentedControl<"main" | "times">
          aria-label="Phone view"
          value={mobileView}
          onValueChange={setMobileView}
          options={[
            { value: "main", label: "Calendar" },
            { value: "times", label: "Times" },
          ]}
        />
      </div>
      <div data-testid="booking-replica">
        <Canvas color={primary}>
          <BookingCard
            expanded={Boolean(date)}
            mobileView={mobileView}
            side={
              <>
                <BookingBrandHeader>
                  <Avatar name="Julian Joseph" alt="" size={120} />
                </BookingBrandHeader>
                <BookingSideSection>
                  {date && (
                    <div className="mb-4 hidden min-[1000px]:block">
                      <BackButton onClick={() => setDate(null)} label="Back to calendar" />
                    </div>
                  )}
                  <Avatar name="Julian Joseph" alt="" size={64} />
                  <BookingHostName className="mt-1.5">Julian Joseph</BookingHostName>
                  <BookingEventTitle>30 Minute Virtual</BookingEventTitle>
                  <BookingDetailList>
                    <BookingDetailRow icon={<Clock aria-hidden="true" />}>30 min</BookingDetailRow>
                    <BookingDetailRow icon={<Video aria-hidden="true" />}>Web conferencing details provided upon confirmation.</BookingDetailRow>
                    {date && slot && (
                      <BookingDetailRow icon={<Globe aria-hidden="true" />}>Eastern Time - US & Canada</BookingDetailRow>
                    )}
                  </BookingDetailList>
                </BookingSideSection>
                <BookingSideFooter>
                  <PublicFooterLinks operatorEmail="operator@example.com" pageUrl="https://kairos.example/julianjoseph/30min" />
                </BookingSideFooter>
              </>
            }
            times={
              <TimeSlotList
                dateLabel={date ? dayLabel(date) : undefined}
                slots={slots}
                selected={slot}
                onSelect={setSlot}
                onNext={() => undefined}
                stickyHeader
              />
            }
          >
            <BookingMainSection className="pb-[29px]">
              <BookingPanelHeading>Select a Date &amp; Time</BookingPanelHeading>
            </BookingMainSection>
            <div className="px-3 min-[600px]:px-5">
              <MonthCalendar
                month={month}
                onMonthChange={setMonth}
                minMonth="2026-10"
                today="2026-10-11"
                selected={date}
                onSelect={(d) => {
                  setDate(d);
                  setSlot(null);
                  setMobileView("times");
                }}
                availableDates={month === "2026-10" ? AVAILABLE : []}
              />
            </div>
            <BookingMainSection className="pt-[25px]">
              <TimeZoneButton value={zone} onChange={setZone} hour12={hour12} onHour12Change={setHour12} />
            </BookingMainSection>
          </BookingCard>
        </Canvas>
      </div>
    </GallerySection>
  );
}
