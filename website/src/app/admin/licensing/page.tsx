"use client";
import { useCallback, useEffect, useState } from "react";
import type {
  AdminChurchLicense,
  ChurchLicense,
  LicenseStatus,
  LicensePolicy,
  LicenseUpdate,
  ManagedProviderStatus,
  ManagedProviderPatch,
  LicensedFeature,
} from "@contracts/licensing";
import { useDashboard } from "@/components/dashboard/dashboard-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  AudioLines,
  BookOpen,
  BrainCircuit,
  ChevronRight,
  Eye,
  EyeOff,
  Languages,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/admin/list-controls";
import { formatDate } from "@/lib/admin";
import { FEATURES, PROVIDERS, integer, failureMessage } from "@/lib/licensing";

const POLICY_FIELDS = {
  defaultMaxDevices: "Default device limit",
  defaultMaxTranscriptionSessions: "Default concurrent sessions",
  defaultTranscriptionMinutes: "Default monthly transcription minutes",
  defaultManagedRequests: "Default monthly managed requests",
  offlineGraceDays: "Offline grace (days)",
} as const;
const LIMIT_FIELDS = {
  maxDevices: "Device limit",
  maxTranscriptionSessions: "Concurrent sessions",
  transcriptionMinutes: "Monthly transcription minutes",
  managedRequests: "Monthly managed requests",
} as const;
const BOUNDS: Record<string, [number, number]> = {
  maxDevices: [1, 100],
  maxTranscriptionSessions: [1, 20],
  transcriptionMinutes: [0, 100000],
  managedRequests: [0, 1000000],
  defaultMaxDevices: [1, 100],
  defaultMaxTranscriptionSessions: [1, 20],
  defaultTranscriptionMinutes: [0, 100000],
  defaultManagedRequests: [0, 1000000],
  offlineGraceDays: [1, 14],
};
const SECRET_FIELDS = {
  deepgram: "deepgramApiKey",
  bible: "bibleApiKey",
  anthropic: "anthropicApiKey",
  deepseek: "deepseekApiKey",
  brave: "braveApiKey",
  googleTranslate: "googleTranslateApiKey",
} as const;
type Provider = keyof typeof PROVIDERS;
const PROVIDER_META: Record<Provider, { icon: LucideIcon; use: string }> = {
  deepgram: { icon: AudioLines, use: "Live transcription" },
  bible: { icon: BookOpen, use: "Scripture text and search" },
  anthropic: { icon: Sparkles, use: "Scripture detection and translation" },
  deepseek: { icon: BrainCircuit, use: "Scripture detection and translation" },
  brave: { icon: Search, use: "Finding song lyrics online" },
  googleTranslate: { icon: Languages, use: "Lyric translation" },
};

function ProviderRow({
  id,
  saved,
  hint,
  onSave,
}: {
  id: Provider;
  saved: boolean;
  hint: string;
  onSave: (value: string | null) => Promise<void>;
}): React.ReactElement {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const { icon: Icon, use } = PROVIDER_META[id];
  const name = PROVIDERS[id];
  const close = () => {
    setMode("view");
    setDraft("");
    setReveal(false);
  };
  const submit = async (value: string | null) => {
    setBusy(true);
    try {
      await onSave(value);
      close();
    } catch {
      // The page shows the error; keep the draft so it can be retried.
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{use}</p>
        </div>
        {mode === "view" &&
          (saved ? (
            <div className="flex items-center gap-1">
              <span className="mr-2 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {hint ? `••••${hint}` : "Saved"}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Replace ${name} key`}
                title="Replace key"
                onClick={() => setMode("edit")}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${name} key`}
                title="Remove key"
                onClick={() => setMode("remove")}
              >
                <Trash2 />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode("edit")}
            >
              <Plus /> Add key
            </Button>
          ))}
      </div>
      {mode === "edit" && (
        <form
          className="mt-3 flex gap-2 pl-12"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void submit(draft.trim());
          }}
        >
          <div className="relative flex-1">
            <Input
              aria-label={`${name} key`}
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              spellCheck={false}
              autoFocus
              disabled={busy}
              value={draft}
              placeholder={saved ? "Paste the new key" : "Paste key"}
              className="pr-9 font-mono"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            />
            <button
              type="button"
              aria-label={reveal ? "Hide key" : "Show key"}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
              onClick={() => setReveal((r) => !r)}
            >
              {reveal ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          <Button type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
        </form>
      )}
      {mode === "remove" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
          <p className="flex-1 text-sm text-muted-foreground">
            {use} stops working for every church until a new key is added.
          </p>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void submit(null)}
          >
            {busy ? "Removing…" : "Remove key"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}

function ProviderKeys({
  status,
  onSaved,
}: {
  status: ManagedProviderStatus;
  onSaved: (next: ManagedProviderStatus, message: string) => void;
}): React.ReactElement {
  const { request } = useDashboard();
  const [error, setError] = useState("");
  const ids = Object.keys(PROVIDERS) as Provider[];
  const count = ids.filter((id) => status.configured[id]).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle>Provider keys</CardTitle>
          <span className="text-xs text-muted-foreground">
            {count} of {ids.length} connected
          </span>
        </div>
        <CardDescription>
          Every church uses these. Only the last four characters of a saved key
          are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ul className="divide-y">
          {ids.map((id) => (
            <ProviderRow
              key={id}
              id={id}
              saved={status.configured[id]}
              hint={status.hints?.[id] ?? ""}
              onSave={async (value) => {
                setError("");
                try {
                  const patch: ManagedProviderPatch = {
                    [SECRET_FIELDS[id]]: value,
                  };
                  const next = await request<ManagedProviderStatus>(
                    "/v1/admin/licensing/providers",
                    { method: "PATCH", body: patch },
                  );
                  onSaved(
                    next,
                    `${PROVIDERS[id]} key ${value === null ? "removed" : "saved"}.`,
                  );
                } catch (e) {
                  setError(failureMessage(e));
                  throw e;
                }
              }}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function LimitField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={BOUNDS[id.split("-").at(-1) ?? id]?.[0] ?? 0}
        max={BOUNDS[id.split("-").at(-1) ?? id]?.[1] ?? 1000000}
        step={1}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) =>
          onChange(e.target.value === "" ? NaN : Number(e.target.value))
        }
      />
    </div>
  );
}
const STATUS: Record<LicenseStatus, { label: string; dot: string }> = {
  active: { label: "Active", dot: "bg-emerald-400" },
  suspended: { label: "Suspended", dot: "bg-amber-400" },
  revoked: { label: "Revoked", dot: "bg-destructive" },
};
type ChurchFilter = LicenseStatus | "all";
type ChurchSort = "name" | "newest" | "usage";
const PAGE_SIZE = 10;

function StatusLabel({ status }: { status: keyof typeof STATUS }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`size-1.5 rounded-full ${STATUS[status].dot}`} />
      {STATUS[status].label}
    </span>
  );
}

/** Used / limit, muted limit; turns red near the cap. */
function Usage({ used, total }: { used: number; total: number }) {
  const hot = total > 0 && used / total >= 0.9;
  return (
    <span className={`tabular-nums ${hot ? "text-destructive" : ""}`}>
      {used.toLocaleString()}
      <span className="text-muted-foreground"> / {total.toLocaleString()}</span>
    </span>
  );
}

function usageShare(l: ChurchLicense): number {
  return Math.max(
    l.transcriptionMinutes ? l.usage.transcriptionMinutes / l.transcriptionMinutes : 0,
    l.managedRequests ? l.usage.managedRequests / l.managedRequests : 0,
  );
}

function ChurchEditor({
  church,
  saved,
  close,
}: {
  church: AdminChurchLicense;
  saved: (l: ChurchLicense) => void;
  close: () => void;
}): React.ReactElement {
  const { request } = useDashboard();
  const licence = church.license;
  const [draft, setDraft] = useState<LicenseUpdate>({
    status: licence.status,
    expiresAt: licence.expiresAt,
    features: licence.features,
    maxDevices: licence.maxDevices,
    maxTranscriptionSessions: licence.maxTranscriptionSessions,
    transcriptionMinutes: licence.transcriptionMinutes,
    managedRequests: licence.managedRequests,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const statusChanged = draft.status !== licence.status;
  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      for (const k of Object.keys(LIMIT_FIELDS) as (keyof typeof LIMIT_FIELDS)[])
        integer(String(draft[k]), LIMIT_FIELDS[k], ...BOUNDS[k]);
      if (draft.expiresAt && !Number.isFinite(Date.parse(draft.expiresAt)))
        throw new Error("Enter a valid expiry date.");
      saved(
        await request<ChurchLicense>(
          `/v1/admin/licensing/licenses/${encodeURIComponent(church.orgId)}`,
          { method: "PATCH", body: draft },
        ),
      );
      close();
    } catch (error) {
      setNotice(failureMessage(error));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{church.orgName || "Unnamed church"}</SheetTitle>
        <SheetDescription>
          {church.ownerEmail || "No owner email"}
          {" · "}
          {licence.devices.length} of {licence.maxDevices} computers
        </SheetDescription>
      </SheetHeader>
      <form
        id={`licence-${church.orgId}`}
        noValidate
        className="flex-1 space-y-6 overflow-y-auto px-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (statusChanged) setConfirm(true);
          else void save();
        }}
      >
        <fieldset disabled={busy} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${church.orgId}-status`}>Status</Label>
              <select
                id={`${church.orgId}-status`}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    status: e.target.value as LicenseStatus,
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${church.orgId}-expiry`}>Expires</Label>
              <Input
                id={`${church.orgId}-expiry`}
                type="date"
                value={draft.expiresAt?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    expiresAt: e.target.value
                      ? `${e.target.value}T23:59:59.000Z`
                      : null,
                  }))
                }
              />
            </div>
            {(Object.keys(LIMIT_FIELDS) as (keyof typeof LIMIT_FIELDS)[]).map(
              (k) => (
                <LimitField
                  key={k}
                  id={`${church.orgId}-${k}`}
                  label={LIMIT_FIELDS[k]}
                  value={draft[k] ?? 0}
                  onChange={(n) => setDraft((d) => ({ ...d, [k]: n }))}
                />
              ),
            )}
          </div>
          <fieldset className="space-y-2.5">
            <legend className="mb-2 text-sm font-medium">Online features</legend>
            {Object.entries(FEATURES)
              .filter(([id]) => id !== "presentation")
              .map(([id, name]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={
                      draft.features?.includes(id as LicensedFeature) ?? false
                    }
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        features: e.target.checked
                          ? [...(d.features ?? []), id as LicensedFeature]
                          : d.features?.filter((f) => f !== id),
                      }))
                    }
                  />
                  {name}
                </label>
              ))}
          </fieldset>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Presentations and installed Bibles always work offline. Suspending
            or revoking stops new activations; computers already activated keep
            working until their offline access runs out. Expiry is at 23:59 UTC.
          </p>
          {licence.devices.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Computers</p>
              <ul className="divide-y rounded-lg border text-sm">
                {licence.devices.map((d) => (
                  <li
                    key={d.deviceId}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="truncate">{d.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(d.lastSeenAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </fieldset>
        {notice && (
          <p role="alert" className="text-sm text-destructive">
            {notice}
          </p>
        )}
      </form>
      <SheetFooter className="flex-row justify-end border-t">
        <Button variant="ghost" disabled={busy} onClick={close}>
          Cancel
        </Button>
        <Button type="submit" form={`licence-${church.orgId}`} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </SheetFooter>
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {church.orgName || "this church"} as{" "}
              {draft.status && STATUS[draft.status].label.toLowerCase()}?
            </DialogTitle>
            <DialogDescription>
              {draft.status === "active"
                ? "The church can activate computers and use online features again."
                : "The church can't activate new computers or renew online access. Computers already activated keep working until their offline access runs out."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              autoFocus
              onClick={() => setConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant={draft.status === "active" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChurchLicences({
  churches,
  onSaved,
}: {
  churches: AdminChurchLicense[];
  onSaved: (l: ChurchLicense) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChurchFilter>("all");
  const [sort, setSort] = useState<ChurchSort>("name");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const status = (c: AdminChurchLicense) => c.license.status;
  const counts = churches.reduce<Record<string, number>>(
    (acc, c) => ({ ...acc, [status(c)]: (acc[status(c)] ?? 0) + 1 }),
    {},
  );
  const q = query.trim().toLowerCase();
  const rows = churches
    .filter((c) => filter === "all" || status(c) === filter)
    .filter(
      (c) =>
        !q ||
        c.orgName.toLowerCase().includes(q) ||
        c.ownerEmail.toLowerCase().includes(q),
    )
    .sort((a, b) =>
      sort === "newest"
        ? (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
        : sort === "usage"
          ? usageShare(b.license) - usageShare(a.license)
          : a.orgName.localeCompare(b.orgName),
    );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const open = churches.find((c) => c.orgId === openId) ?? null;
  const filters: ChurchFilter[] = ["all", "active", "suspended", "revoked"];
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="font-heading text-[17px] font-medium tracking-[-.025em]">
          Churches
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {churches.length.toLocaleString()}{" "}
          {churches.length === 1 ? "church has" : "churches have"} a licence
          {churches.length ? `, ${(counts.active ?? 0).toLocaleString()} active` : ""}.
          Churches get one when they create their first activation key.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search church or owner"
            aria-label="Search churches"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Filter by status"
          className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
        >
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : STATUS[f].label}
              <span className="ml-1.5 tabular-nums opacity-60">
                {f === "all" ? churches.length : (counts[f] ?? 0)}
              </span>
            </button>
          ))}
        </div>
        <select
          aria-label="Sort churches"
          className="ml-auto h-9 rounded-md border bg-background px-3 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as ChurchSort)}
        >
          <option value="name">Name A–Z</option>
          <option value="newest">Newest first</option>
          <option value="usage">Most usage</option>
        </select>
      </div>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Church</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Computers</TableHead>
              <TableHead className="text-right">Minutes this month</TableHead>
              <TableHead className="text-right">Requests this month</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows
              .slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
              .map((c) => {
                const l = c.license;
                return (
                  <TableRow
                    key={c.orgId}
                    className="cursor-pointer"
                    onClick={() => setOpenId(c.orgId)}
                  >
                    <TableCell>
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(c.orgId);
                        }}
                      >
                        {c.orgName || "Unnamed church"}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {c.ownerEmail || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <StatusLabel status={status(c)} />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Usage used={l.devices.length} total={l.maxDevices} />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Usage used={l.usage.transcriptionMinutes} total={l.transcriptionMinutes} />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Usage used={l.usage.managedRequests} total={l.managedRequests} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.expiresAt ? formatDate(l.expiresAt) : "Never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <ChevronRight className="size-4" />
                    </TableCell>
                  </TableRow>
                );
              })}
            {!rows.length && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {churches.length
                    ? "No churches match these filters."
                    : "No church has a licence yet. One appears here once its owner creates an activation key."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      {rows.length > PAGE_SIZE && (
        <Pager
          page={current}
          pageSize={PAGE_SIZE}
          total={rows.length}
          onPage={setPage}
        />
      )}
      <Sheet
        open={!!open}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
      >
        <SheetContent className="w-full gap-0 sm:max-w-md">
          {open && (
            <ChurchEditor
              key={open.orgId}
              church={open}
              saved={onSaved}
              close={() => setOpenId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
export default function AdminLicensingPage(): React.ReactElement {
  const { session, request } = useDashboard();
  const allowed = session.user.platformRole === "superadmin";
  const [policy, setPolicy] = useState<LicensePolicy | null>(null);
  const [providers, setProviders] = useState<ManagedProviderStatus | null>(
    null,
  );
  const [licences, setLicences] = useState<AdminChurchLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, s, l] = await Promise.all([
        request<LicensePolicy>("/v1/admin/licensing/policy"),
        request<ManagedProviderStatus>("/v1/admin/licensing/providers"),
        request<AdminChurchLicense[]>("/v1/admin/licensing/licenses"),
      ]);
      setPolicy(p);
      setProviders(s);
      setLicences(l);
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setLoading(false);
    }
  }, [request]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  if (!allowed)
    return (
      <p role="alert">
        Only a superadmin can manage licences and platform providers.
      </p>
    );
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-display text-4xl font-medium tracking-tight">
          Licensing
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage free church licences and centrally provided services. Licence
          issuance is independent of subscriptions.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading licensing settings…</p>
      ) : !policy || !providers ? (
        <Button onClick={() => void load()}>Try again</Button>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Free licence policy</CardTitle>
              <CardDescription>
                Defaults apply to newly issued licences. Edit existing churches
                individually below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                noValidate
                className="space-y-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  setMessage("");
                  try {
                    for (const k of Object.keys(
                      POLICY_FIELDS,
                    ) as (keyof typeof POLICY_FIELDS)[])
                      integer(
                        String(policy[k]),
                        POLICY_FIELDS[k],
                        ...BOUNDS[k],
                      );
                    setPolicy(
                      await request<LicensePolicy>(
                        "/v1/admin/licensing/policy",
                        { method: "PATCH", body: policy },
                      ),
                    );
                    setMessage("Licence policy saved.");
                  } catch (e) {
                    setError(failureMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <fieldset disabled={busy} className="space-y-5">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={policy.freeIssuanceEnabled}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          freeIssuanceEnabled: e.target.checked,
                        })
                      }
                    />
                    Allow church owners and admins to issue free licences
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(
                      Object.keys(
                        POLICY_FIELDS,
                      ) as (keyof typeof POLICY_FIELDS)[]
                    ).map((k) => (
                      <LimitField
                        key={k}
                        id={k}
                        label={POLICY_FIELDS[k]}
                        value={policy[k]}
                        onChange={(n) => setPolicy({ ...policy, [k]: n })}
                      />
                    ))}
                  </div>
                  <Button type="submit">
                    {busy ? "Saving…" : "Save policy"}
                  </Button>
                </fieldset>
              </form>
            </CardContent>
          </Card>
          <ProviderKeys
            status={providers}
            onSaved={(next, note) => {
              setProviders(next);
              setError("");
              setMessage(note);
            }}
          />
          <ChurchLicences
            churches={licences}
            onSaved={(updated) =>
              setLicences((rows) =>
                rows.map((row) =>
                  row.orgId === updated.orgId
                    ? { ...row, license: updated }
                    : row,
                ),
              )
            }
          />
        </>
      )}
    </div>
  );
}
