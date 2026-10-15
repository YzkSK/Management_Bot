import { IconCalendar, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { ja } from "react-day-picker/locale/ja";
import { Button } from "@/components/starwind/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/starwind/popover";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD`(ローカル日付)をDateにする。形式不正や存在しない日付(2月31日等)はundefined。UTC解釈にしないので日付はずれない。 */
export function parseDateString(value: string): Date | undefined {
  const match = DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

/** Dateをローカル日付の`YYYY-MM-DD`にする(toISOStringはUTCになり日付がずれるため使わない)。 */
export function formatDateString(date: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** トリガーに出す表示(`YYYY/MM/DD`)。未選択・不正値はundefined。 */
export function formatDateDisplay(value: string): string | undefined {
  return parseDateString(value) ? value.replaceAll("-", "/") : undefined;
}

const navButton =
  "hover:bg-accent inline-flex size-8 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-50";

/** 日付選択。値は`YYYY-MM-DD`文字列(空文字=未選択)。選択するとパネルを閉じる。 */
export function DatePicker({
  value,
  onChange,
  placeholder = "日付を選択",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateString(value);
  const display = formatDateDisplay(value);

  return (
    <Popover open={open} onOpenChange={setOpen} className="w-full">
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label={ariaLabel} className="text-foreground w-full justify-start font-normal">
          <IconCalendar aria-hidden="true" />
          {display ?? <span className="text-muted-foreground">{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent role="dialog" aria-label={ariaLabel} align="start" className="w-auto gap-1 p-2">
        <DayPicker
          key={value}
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(formatDateString(date));
            setOpen(false);
          }}
          locale={ja}
          weekStartsOn={0}
          components={{
            Chevron: ({ orientation, className }) =>
              orientation === "right" ? (
                <IconChevronRight className={className} aria-hidden="true" />
              ) : (
                <IconChevronLeft className={className} aria-hidden="true" />
              ),
          }}
          classNames={{
            root: "text-sm",
            months: "relative flex flex-col",
            month: "flex flex-col gap-2",
            month_caption: "flex h-8 items-center justify-center",
            caption_label: "text-sm font-medium",
            nav: "absolute inset-x-0 top-0 flex items-center justify-between",
            button_previous: navButton,
            button_next: navButton,
            chevron: "size-4",
            month_grid: "border-collapse",
            weekday: "text-muted-foreground size-9 text-center text-xs font-normal",
            day: "size-9 p-0 text-center [&>button]:size-9 [&>button]:rounded-md [&>button]:outline-none [&>button]:hover:bg-accent [&>button]:hover:text-accent-foreground [&>button]:focus-visible:ring-outline/50 [&>button]:focus-visible:ring-[3px]",
            selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
            today: "[&>button]:ring-outline [&>button]:font-semibold [&>button]:ring-1",
            outside: "[&>button]:text-muted-foreground [&>button]:opacity-60",
            disabled: "[&>button]:opacity-40",
            hidden: "invisible",
          }}
        />
        <div className="flex justify-end border-t pt-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={value === ""}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            クリア
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
