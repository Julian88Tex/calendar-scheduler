// OWNER: foundation-ui.
//
// Gallery: time zones, times, durations and calendars.
"use client";

import { useState } from "react";
import { DatePicker, DateRangePicker, type DateRange } from "@/components/ui/date-picker";
import { DurationSelect } from "@/components/ui/duration-select";
import { FormField } from "@/components/ui/form-field";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { formatMinutes } from "@/components/ui/time-input-utils";
import { TimeInput } from "@/components/ui/time-input";
import { TimeZoneButton, TimeZoneSelect } from "@/components/ui/time-zone-select";
import { Demo, GallerySection } from "./section";

const OCT_AVAILABLE = ["13", "14", "15", "16", "18", "20", "21", "22", "23", "25", "27", "28"];

export function TimeSection() {
  const [zone, setZone] = useState("America/New_York");
  const [bookingZone, setBookingZone] = useState("America/New_York");
  const [hour12, setHour12] = useState(true);
  const [start, setStart] = useState<number | null>(540);
  const [end, setEnd] = useState<number | null>(1020);
  const [duration, setDuration] = useState(30);
  const [month, setMonth] = useState("2026-10");
  const [day, setDay] = useState<string | null>(null);
  const [multiMonth, setMultiMonth] = useState("2026-10");
  const [many, setMany] = useState<string[]>(["2026-10-20", "2026-10-21"]);
  const [date, setDate] = useState<string | null>("2026-10-14");
  const [range, setRange] = useState<DateRange>({ start: "2026-10-01", end: "2026-10-31" });
  return (
    <GallerySection id="time" title="Time and dates" description="Friendly zone names with the current local time, typeable times and the 44px booking calendar.">
      <div className="grid gap-6 lg:grid-cols-2">
        <FormField label="Time zone (dashboard picker)">
          {(control) => <TimeZoneSelect id={control.id} value={zone} onChange={setZone} />}
        </FormField>
        <div className="flex flex-col gap-2">
          <TimeZoneButton value={bookingZone} onChange={setBookingZone} hour12={hour12} onHour12Change={setHour12} />
          <p className="text-body-sm text-ink-2">Booking page style: opens search, the am/pm and 24h toggle and the grouped list.</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-label">Available hours (TimeInput)</span>
          <div className="flex items-center gap-2">
            <TimeInput aria-label="Start time" value={start} onChange={setStart} />
            <span aria-hidden="true">-</span>
            <TimeInput aria-label="End time" value={end} onChange={setEnd} allowEndOfDay min={start ?? 0} />
          </div>
          <p className="text-body-sm text-ink-2">
            {`Type "9", "930", "9:30 pm" or "21:30". Value: ${start === null ? "none" : formatMinutes(start)} to ${end === null ? "none" : formatMinutes(end)}.`}
          </p>
        </div>
        <FormField label="Duration">{(control) => <DurationSelect id={control.id} value={duration} onChange={setDuration} />}</FormField>
        <FormField label="Date (DatePicker)">{(control) => <DatePicker id={control.id} value={date} onChange={setDate} clearable />}</FormField>
        <div className="flex flex-col gap-2">
          <span className="text-label">Date range (DateRangePicker)</span>
          <DateRangePicker
            value={range}
            onChange={setRange}
            maxDays={366}
            presets={[
              { label: "This month", start: "2026-10-01", end: "2026-10-31" },
              { label: "Next 7 days", start: "2026-10-12", end: "2026-10-18" },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <Demo label="Booking calendar (single)" className="max-w-[400px]">
          <MonthCalendar
            className="w-full"
            month={month}
            onMonthChange={setMonth}
            minMonth="2026-10"
            selected={day}
            onSelect={setDay}
            today="2026-10-11"
            availableDates={month === "2026-10" ? OCT_AVAILABLE.map((d) => `2026-10-${d}`) : []}
          />
        </Demo>
        <Demo label="Multiple selection (date overrides)" className="max-w-[400px]">
          <MonthCalendar
            className="w-full"
            month={multiMonth}
            onMonthChange={setMultiMonth}
            mode="multiple"
            selected={many}
            onSelect={(d) => setMany((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
            labels={{ available: "", unavailable: "Unavailable" }}
            isDisabled={(d) => d < "2026-10-11"}
            today="2026-10-11"
            weekStart={1}
          />
        </Demo>
        <Demo label="Loading" className="max-w-[400px]">
          <MonthCalendar className="w-full" month="2026-11" onMonthChange={() => undefined} loading aria-label="Loading calendar" />
        </Demo>
      </div>
    </GallerySection>
  );
}
