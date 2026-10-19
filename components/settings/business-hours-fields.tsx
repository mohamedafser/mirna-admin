"use client";

import { CopyCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import { WEEKDAYS, type BusinessHours, type Weekday } from "@/lib/settings/rules";

type DayState = { open: boolean; from: string; to: string };

// Prefill for a store that hasn't set hours yet; nothing is shown publicly
// until the admin turns hours on and saves.
const DEFAULT_DAY: DayState = { open: true, from: "09:00", to: "18:00" };

function initialHours(saved: BusinessHours | null): Record<Weekday, DayState> {
  return Object.fromEntries(
    WEEKDAYS.map((day) => {
      if (!saved) return [day, DEFAULT_DAY];
      const hours = saved[day];
      return [
        day,
        hours ? { open: true, from: hours.open, to: hours.close } : { ...DEFAULT_DAY, open: false },
      ];
    }),
  ) as Record<Weekday, DayState>;
}

/**
 * Weekly opening hours: one row per day (Monday first) with an "Open" box and
 * from / to times. Submits hours.<day>.open / .from / .to; a closed day's
 * times are disabled, so they aren't submitted. A "to" time earlier than
 * "from" means the store closes after midnight.
 */
export function BusinessHoursFields({
  saved,
  disabled,
  errors,
  onChange,
}: {
  saved: BusinessHours | null;
  disabled: boolean;
  /** Error text per day. */
  errors: Partial<Record<Weekday, string>>;
  onChange: () => void;
}) {
  const { locale, messages } = useI18n();
  const f = messages.settings.fields;
  const id = useId();
  const [hours, setHours] = useState(() => initialHours(saved));

  // 2024-01-01 was a Monday; names come from Intl in the UI language.
  const dayNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
    return Object.fromEntries(
      WEEKDAYS.map((day, index) => [day, formatter.format(Date.UTC(2024, 0, 1 + index))]),
    ) as Record<Weekday, string>;
  }, [locale]);

  const update = (day: Weekday, patch: Partial<DayState>) => {
    setHours((current) => ({ ...current, [day]: { ...current[day], ...patch } }));
    onChange();
  };
  const copyFirst = () => {
    setHours(
      (current) =>
        Object.fromEntries(WEEKDAYS.map((day) => [day, { ...current.mon }])) as Record<
          Weekday,
          DayState
        >,
    );
    onChange();
  };

  return (
    <div className="grid gap-2">
      <ul className="divide-y rounded-xl border">
        {WEEKDAYS.map((day) => {
          const value = hours[day];
          const error = errors[day];
          const errorId = `${id}-${day}-error`;
          return (
            <li
              key={day}
              className="grid gap-2 px-3 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center"
            >
              <label className="flex min-h-9 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name={`hours.${day}.open`}
                  checked={value.open}
                  disabled={disabled}
                  onChange={(event) => update(day, { open: event.target.checked })}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="font-medium">{dayNames[day]}</span>
              </label>
              {value.open ? (
                <div className="grid gap-1">
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
                    dir="ltr"
                  >
                    <Input
                      type="time"
                      name={`hours.${day}.from`}
                      data-field={`hours.${day}`}
                      aria-label={format(f.hoursFrom, { day: dayNames[day] })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      value={value.from}
                      disabled={disabled}
                      required
                      onChange={(event) => update(day, { from: event.target.value })}
                    />
                    <span aria-hidden className="text-muted-foreground">
                      –
                    </span>
                    <Input
                      type="time"
                      name={`hours.${day}.to`}
                      aria-label={format(f.hoursTo, { day: dayNames[day] })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      value={value.to}
                      disabled={disabled}
                      required
                      onChange={(event) => update(day, { to: event.target.value })}
                    />
                  </div>
                  {error && (
                    <p id={errorId} role="alert" className="text-sm text-error">
                      {error}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground sm:min-h-9 sm:content-center">
                  {f.hoursClosed}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{f.hoursOvernightHint}</p>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={copyFirst}>
          <CopyCheck aria-hidden />
          {format(f.hoursCopy, { day: dayNames.mon })}
        </Button>
      </div>
    </div>
  );
}
