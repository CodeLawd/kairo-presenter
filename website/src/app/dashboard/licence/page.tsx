"use client";
import { useCallback, useEffect, useState } from "react";
import type {
  LicenseSnapshot,
  LicenseActivationKey,
  LicenseDevice,
  LicenseStatus,
} from "@contracts/licensing";
import { useDashboard } from "@/components/dashboard/dashboard-provider";
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
import { Copy, Plus, Trash2 } from "lucide-react";
import { FEATURES, dateLabel, failureMessage } from "@/lib/licensing";

const STATUS: Record<LicenseStatus, { label: string; dot: string }> = {
  active: { label: "Active", dot: "bg-emerald-400" },
  suspended: { label: "Suspended", dot: "bg-amber-400" },
  revoked: { label: "Revoked", dot: "bg-destructive" },
};

function Meter({
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
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {used.toLocaleString()}{" "}
          <span className="text-muted-foreground">
            / {total.toLocaleString()}
          </span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${share >= 0.9 ? "bg-destructive" : "bg-foreground/70"}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function LicencePage(): React.ReactElement {
  const { session, request } = useDashboard();
  const [data, setData] = useState<LicenseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activationKey, setActivationKey] = useState<LicenseActivationKey | null>(
    null,
  );
  const [fresh, setFresh] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
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
      setActivationKey(currentKey);
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
      setFresh(true);
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
        setMessage("Key copied. Paste it into Kairo to activate a computer.");
      })
      .catch(() => setError("Couldn't copy. Select the key and copy it manually."));
  const revoke = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/v1/licensing/key", { method: "DELETE" });
      setActivationKey(null);
      setFresh(false);
      setRevokeOpen(false);
      setMessage(
        "Key revoked. Create a new one when you need to activate another computer.",
      );
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
      setMessage("Computer deactivated.");
      await load();
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const licence = data?.license;
  const full = !!licence && licence.devices.length >= licence.maxDevices;
  const status = licence ? STATUS[licence.status] : null;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <h2 className="font-display text-[28px] leading-[1.1] font-medium tracking-[-.045em]">
          Licence &amp; devices
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Each Kairo computer needs an activation key from this page. Licences
          are free for now.
        </p>
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
          <Skeleton className="h-[180px] w-full rounded-2xl" />
          <Skeleton className="h-[120px] w-full rounded-2xl" />
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Church licence</CardTitle>
                {status && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`size-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                )}
              </div>
              <CardDescription>
                {licence
                  ? licence.expiresAt
                    ? `Valid until ${new Date(licence.expiresAt).toLocaleDateString()}.`
                    : "No expiry."
                  : "Your church doesn't have a licence yet. Creating your first activation key sets one up."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {licence && (
                <>
                  <div className="space-y-4">
                    <Meter
                      label="Computers"
                      used={licence.devices.length}
                      total={licence.maxDevices}
                    />
                    {licence.features.includes("transcription") && (
                      <Meter
                        label="Transcription minutes this month"
                        used={licence.usage.transcriptionMinutes}
                        total={licence.transcriptionMinutes}
                      />
                    )}
                    <Meter
                      label="Online requests this month"
                      used={licence.usage.managedRequests}
                      total={licence.managedRequests}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Includes{" "}
                    {licence.features
                      .filter((f) => f !== "presentation")
                      .map((f) => FEATURES[f].toLowerCase())
                      .join(", ")}
                    .
                  </p>
                </>
              )}
              {!canEdit && (
                <p className="text-sm text-muted-foreground">
                  Ask a church owner or admin for an activation key.
                </p>
              )}
            </CardContent>
          </Card>
          {canEdit && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>Activation key</CardTitle>
                    <CardDescription>
                      Paste this key into Kairo on any of your church&apos;s
                      computers. It stays the same until you revoke it, so you
                      can always come back and copy it.
                    </CardDescription>
                  </div>
                  {!activationKey && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void issue()}
                    >
                      <Plus /> {busy ? "Creating…" : "Create key"}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {full && (
                  <p className="text-xs text-muted-foreground">
                    Every computer slot is in use. The key can reactivate one of
                    the computers below — deactivate one to add a different
                    computer.
                  </p>
                )}
                {!activationKey ? (
                  <p className="text-sm text-muted-foreground">
                    No key yet. Create one when you&apos;re ready to set up a
                    computer.
                  </p>
                ) : (
                  <div
                    className={`flex items-center gap-2 rounded-xl p-2 pl-3 bg-muted ${fresh ? "ring-1 ring-foreground/15" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <code className="block truncate font-mono text-[13px] select-all">
                        {activationKey.key}
                      </code>
                      <p className="text-xs text-muted-foreground">
                        {activationKey.createdAt
                          ? `Created ${new Date(activationKey.createdAt).toLocaleDateString()}`
                          : "Church activation key"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copy(activationKey)}
                    >
                      <Copy /> Copy
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Revoke key"
                      title="Revoke key"
                      disabled={busy}
                      onClick={() => setRevokeOpen(true)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Computers</CardTitle>
              <CardDescription>
                Deactivating a computer frees its slot so another computer can
                use the key. Deactivated computers need the key again to
                reactivate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!licence?.devices.length ? (
                <p className="text-sm text-muted-foreground">
                  No computers activated yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {licence.devices.map((device) => (
                    <li
                      key={device.deviceId}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{device.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          Last seen {dateLabel(device.lastSeenAt)}
                        </p>
                      </div>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
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
              Computers already activated keep working, but this key will no
              longer activate one. You can create a new key afterwards.
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
              {busy ? "Revoking…" : "Revoke key"}
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
              This frees its slot. If it&apos;s offline, it may keep working
              for a few days until it next checks in.
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
