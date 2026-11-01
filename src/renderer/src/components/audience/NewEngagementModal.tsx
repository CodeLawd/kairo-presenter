import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { cleanIpcError } from "@shared/ipc-error";
import type { AudienceState } from "@shared/audience";
import { DEFAULT_AUDIENCE_ROOM_SETTINGS } from "@shared/audience-protocol";
import { Loader2, X } from "@/icons";
import { MovableDialog } from "@/components/shared/MovableDialog";
import { RoomSettings } from "./RoomSettings";

const DEFAULT_TITLE = "Engagement Title";
const LABEL = "block text-[12px] font-medium text-zinc-300";

/** `yyyy-mm-dd` from a date input → local midnight (start) or end of day (end). */
function dayToTime(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59).getTime()
    : new Date(year, month - 1, day).getTime();
}

/**
 * New engagement: a title, optional dates and how questions work. Start it now
 * to take questions straight away, or save it for later and open it from the list.
 */
export function NewEngagementModal({
  open,
  onOpenChange,
  onSaved,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A saved engagement: the list should reload. */
  onSaved: () => void;
  onStarted: (state: AudienceState) => void;
}): React.ReactElement {
  const [title, setTitle] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [settings, setSettings] = useState(DEFAULT_AUDIENCE_ROOM_SETTINGS);
  const [pending, setPending] = useState<"start" | "save" | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");

  // A fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setStarts("");
    setEnds("");
    setSettings(DEFAULT_AUDIENCE_ROOM_SETTINGS);
    setError("");
  }, [open]);

  useEffect(() => {
    if (!pending) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [pending]);

  const startsAt = dayToTime(starts, false);
  const endsAt = dayToTime(ends, true);
  const datesInvalid =
    startsAt !== null && endsAt !== null && endsAt < startsAt;

  const submit = async (mode: "start" | "save"): Promise<void> => {
    if (datesInvalid || pending) return;
    setPending(mode);
    setError("");
    const name = title.trim() || DEFAULT_TITLE;
    try {
      if (mode === "start") {
        onStarted(
          await window.api.audience.startSource("kairo", {
            title: name,
            settings,
            startsAt,
            endsAt,
          }),
        );
      } else {
        await window.api.audience.createEngagement({
          title: name,
          startsAt,
          endsAt,
          status: "draft",
          settings,
        });
        onSaved();
      }
      onOpenChange(false);
    } catch (e) {
      setError(cleanIpcError(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/35 animate-fade-in motion-reduce:animate-none" />
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
          <MovableDialog className="w-full max-w-[460px]">
          <Dialog.Content className="w-full overflow-hidden rounded-2xl modal-glass text-white outline-none animate-spring-in motion-reduce:animate-none">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit("start");
            }}
          >
            <div className="px-6 pb-5 pt-6">
              <div data-modal-drag className="flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-[18px] font-semibold tracking-tight">
                    New engagement
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-[13px] text-zinc-400">
                    People join with a code and send questions. You choose what
                    goes on screen.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-surface-tertiary hover:text-white"
                    aria-label="Close"
                    disabled={!!pending}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>

              <label className={`${LABEL} mt-5`} htmlFor="engagement-title">
                Title
              </label>
              <input
                id="engagement-title"
                autoFocus
                className="input mt-1.5"
                placeholder={DEFAULT_TITLE}
                maxLength={100}
                value={title}
                disabled={!!pending}
                onChange={(event) => setTitle(event.target.value)}
              />

              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className={LABEL}>
                  Start date{" "}
                  <span className="font-normal text-zinc-500">· optional</span>
                  <input
                    type="date"
                    className="input mt-1.5 [color-scheme:dark]"
                    value={starts}
                    disabled={!!pending}
                    onChange={(event) => setStarts(event.target.value)}
                  />
                </label>
                <label className={LABEL}>
                  End date{" "}
                  <span className="font-normal text-zinc-500">· optional</span>
                  <input
                    type="date"
                    className="input mt-1.5 [color-scheme:dark]"
                    value={ends}
                    min={starts || undefined}
                    disabled={!!pending}
                    onChange={(event) => setEnds(event.target.value)}
                  />
                </label>
              </div>
              {datesInvalid && (
                <p className="mt-1.5 text-[12px] text-red-400">
                  The end date is before the start date.
                </p>
              )}

              <p className={`${LABEL} mt-5`}>Questions</p>
              <RoomSettings
                settings={settings}
                disabled={!!pending}
                onChange={setSettings}
              />

              {error && (
                <p role="alert" className="mt-4 text-[13px] text-red-400">
                  {error}
                </p>
              )}
              {slow && (
                <p className="mt-4 text-[12px] text-zinc-400">
                  Still working. The first one of the day can take up to a
                  minute.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 bg-surface-tertiary px-6 py-4">
              <button
                type="button"
                className="btn-secondary min-h-9"
                disabled={!!pending || datesInvalid}
                onClick={() => void submit("save")}
              >
                {pending === "save" ? "Saving…" : "Save for later"}
              </button>
              <button
                type="submit"
                className="btn-primary flex min-h-9 min-w-28 items-center justify-center gap-2"
                disabled={!!pending || datesInvalid}
              >
                {pending === "start" && (
                  <Loader2
                    size={13}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                )}
                {pending === "start" ? "Starting…" : "Start now"}
              </button>
            </div>
          </form>
          </Dialog.Content>
          </MovableDialog>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
