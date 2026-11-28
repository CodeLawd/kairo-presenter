"use client";
import { useCallback, useEffect, useState } from "react";
import type {
  LicenseSnapshot,
  LicenseActivationKey,
  LicenseDevice,
  LicenseStatus,
} from "@contracts/licensing";
import { useDashboard } from "@/components/dashboard/dashboard-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, Copy, KeyRound, Laptop, Plus } from "lucide-react";
import { FEATURES, failureMessage } from "@/lib/licensing";
import { formatDate, formatRelative } from "@/lib/admin";

const STATUS: Record<
  LicenseStatus,
  { label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  active: { label: "Active", variant: "secondary" },
  suspended: { label: "Suspended", variant: "outline" },
  revoked: { label: "Revoked", variant: "destructive" },
};

/** One usage figure: a number over its allowance, with a thin bar. */
function Usage({
  label,
  used,
  total,
}: {
  label: string;
  used: number;
  total: number;
}): React.ReactElement {
  const share = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-medium tabular-nums leading-none">
        {used.toLocaleString()}
        <span className="text-sm font-normal text-muted-foreground">
          {" "}
          / {total.toLocaleString()}
        </span>
      </span>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full transition-[width] ${share >= 0.9 ? "bg-destructive" : "bg-foreground/60"}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}

/** "today", "3 days ago", or a date for anything older. */
function seen(value: string | null): string {
  const label = formatRelative(value);
  return /^(Today|Yesterday|Never)$|ago$/.test(label) ? label.toLowerCase() : label;
}

export default function LicencePage(): React.ReactElement {
  const { session, request } = useDashboard();
  const [data, setData] = useState<LicenseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activationKey, setActivationKey] =
    useState<LicenseActivationKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [signOutAll, setSignOutAll] = useState(false);
  const [message, setMessage] = useState("");
  const [remove, setRemove] = useState<LicenseDevice | null>(null);
  const canEdit = session.role === "owner" || session.role === "admin";
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [snapshot, currentKey] = await Promise.all([
        request<LicenseSnapshot>("/v1/licensing"),
        canEdit
          ? request<LicenseActivationKey | null>("/v1/licensing/key")
          : Promise.resolve(null),
      ]);
      setData(snapshot);
      setActivationKey(currentKey?.key ? currentKey : null);
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setLoading(false);
    }
  }, [request, canEdit]);
  useEffect(() => {
    if (session.orgId) void load();
    else setLoading(false);
  }, [load, session.orgId]);
  const issue = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await request<LicenseActivationKey>("/v1/licensing/key", {
        method: "POST",
      });
      setActivationKey(created);
      // A first key can also create the licence, so refresh the church summary.
      setData(await request<LicenseSnapshot>("/v1/licensing"));
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = (k: LicenseActivationKey) =>
    void navigator.clipboard
      .writeText(k.key)
      .then(() => {
        setError("");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() =>
        setError("Couldn't copy. Select the key and copy it yourself."),
      );
  const revoke = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(
        signOutAll ? "/v1/licensing/key?deactivate=all" : "/v1/licensing/key",
        { method: "DELETE" },
      );
      setActivationKey(null);
      setRevokeOpen(false);
      setMessage(
        signOutAll
          ? "Key revoked and every computer deactivated. Create a new key to set them up again."
          : "Key revoked. Computers already set up keep working.",
      );
      if (signOutAll) await load();
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const deactivate = async () => {
    if (!remove) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `/v1/licensing/devices/${encodeURIComponent(remove.deviceId)}`,
        { method: "DELETE" },
      );
      setRemove(null);
      setMessage(`${remove.name} deactivated.`);
      await load();
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const licence = data?.license;
  const devices = licence?.devices ?? [];
  const full = !!licence && devices.length >= licence.maxDevices;
  const status = licence ? STATUS[licence.status] : null;
  const included = (licence?.features ?? []).filter((f) => f !== "presentation");
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[28px] leading-[1.1] font-medium tracking-[-.045em]">
            Licence &amp; devices
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Set up each of your church&apos;s computers with one activation key.
            Licences are free for now.
          </p>
        </div>
        {status && (
          <Badge variant={status.variant} className="mt-2">
            {status.label}
          </Badge>
        )}
      </div>
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {error}{" "}
          <Button
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => void load()}
            disabled={busy}
          >
            Try again
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {!session.orgId ? (
        <p className="text-sm text-muted-foreground">
          Link a church to manage its licence.
        </p>
      ) : loading ? (
        <>
          <Skeleton className="h-[148px] w-full rounded-2xl" />
          <Skeleton className="h-[132px] w-full rounded-2xl" />
          <Skeleton className="h-[120px] w-full rounded-2xl" />
        </>
      ) : (
        <>
          {canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Activation key</CardTitle>
                <CardDescription>
                  Paste it into Kairo on each computer. It stays the same until
                  you revoke it.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {activationKey ? (
                  <>
                    <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3 sm:flex-row sm:items-center">
                      <code className="min-w-0 flex-1 font-mono text-[15px] tracking-wider break-all select-all sm:text-base">
                        {activationKey.key}
                      </code>
                      <Button
                        size="sm"
                        className="shrink-0"
                        onClick={() => copy(activationKey)}
                      >
                        {copied ? <Check /> : <Copy />}
                        {copied ? "Copied" : "Copy key"}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>
                        {activationKey.createdAt
                          ? `Created ${formatDate(activationKey.createdAt)}`
                          : "Church activation key"}
                        {full && " · Every computer slot is in use"}
                      </span>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0 text-xs text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={() => {
                          setSignOutAll(false);
                          setRevokeOpen(true);
                        }}
                      >
                        Revoke key
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-7 text-center">
                    <KeyRound className="size-5 text-muted-foreground" />
                    <p className="max-w-xs text-sm text-muted-foreground">
                      {licence
                        ? "No key right now. Create one when you're ready to set up a computer."
                        : "Create a key to start your church's free licence."}
                    </p>
                    <Button size="sm" disabled={busy} onClick={() => void issue()}>
                      <Plus /> {busy ? "Creating…" : "Create key"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
                <KeyRound className="size-4 shrink-0" />
                Ask a church owner or admin for the activation key.
              </CardContent>
            </Card>
          )}
          {licence && (
            <Card>
              <CardHeader>
                <CardTitle>This month</CardTitle>
                <CardDescription>
                  {licence.expiresAt
                    ? `Licence valid until ${formatDate(licence.expiresAt)}.`
                    : "Your licence doesn't expire."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <Usage
                    label="Computers"
                    used={devices.length}
                    total={licence.maxDevices}
                  />
                  {licence.features.includes("transcription") && (
                    <Usage
                      label="Transcription minutes"
                      used={licence.usage.transcriptionMinutes}
                      total={licence.transcriptionMinutes}
                    />
                  )}
                  <Usage
                    label="Online requests"
                    used={licence.usage.managedRequests}
                    total={licence.managedRequests}
                  />
                </div>
                {included.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {included.map((f) => (
                      <Badge key={f} variant="outline">
                        {FEATURES[f]}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Computers</CardTitle>
                {licence && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {devices.length} of {licence.maxDevices}
                  </span>
                )}
              </div>
              <CardDescription>
                Deactivate a computer to free its slot. It needs the key again
                to come back.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No computers set up yet.
                </p>
              ) : (
                <ul className="-mx-2 flex flex-col">
                  {devices.map((device) => (
                    <li
                      key={device.deviceId}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <Laptop className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {device.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Last seen {seen(device.lastSeenAt)}
                          {" · "}set up {formatDate(device.activatedAt)}
                        </p>
                      </div>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() => setRemove(device)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <Dialog
        open={revokeOpen}
        onOpenChange={(open) => {
          if (!busy && !open) setRevokeOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke the activation key?</DialogTitle>
            <DialogDescription>
              It will no longer set up new computers. You can create a new key
              afterwards.
            </DialogDescription>
          </DialogHeader>
          {devices.length > 0 && (
            <label className="flex items-start gap-2.5 rounded-xl border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-destructive"
                checked={signOutAll}
                onChange={(event) => setSignOutAll(event.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  Also deactivate {devices.length === 1 ? "the computer" : `all ${devices.length} computers`}
                </span>
                <span className="text-muted-foreground">
                  Use this if the key was shared with someone it shouldn&apos;t
                  have been. Each computer needs the new key to work again; one
                  that&apos;s offline stops when its licence next renews.
                </span>
              </span>
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRevokeOpen(false)}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void revoke()}
            >
              {busy
                ? "Revoking…"
                : signOutAll
                  ? "Revoke and deactivate"
                  : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!busy && !open) setRemove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {remove?.name}?</DialogTitle>
            <DialogDescription>
              This frees its slot. If it&apos;s offline, it keeps working until
              its licence next renews.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(null)}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void deactivate()}
            >
              {busy ? "Deactivating…" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
