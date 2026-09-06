import { useEffect, useMemo, useState } from "react";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";
import type { ResilienceStatus, ServiceHealth } from "@shared/ipc";

export interface ServiceStatusCard {
  label: string;
  status: "ok" | "degraded" | "error" | "unknown";
  error?: string;
}

/**
 * The PP / STT / AI status cards shown under the live output preview.
 *
 * Operator derives these from state it already subscribes to; every other
 * screen that shows the rail gets them from here so the three cards read the
 * same on all tabs instead of only existing on Operator.
 */
export function deriveServiceStatuses(
  health: ServiceHealth[],
  resilienceStatus: ResilienceStatus | null,
): ServiceStatusCard[] {
  const statusOf = (
    serviceName: string,
  ): "ok" | "degraded" | "error" | "unknown" =>
    health.find((entry) => entry.service === serviceName)?.status ?? "unknown";
  const errorOf = (serviceName: string): string | undefined =>
    health.find((entry) => entry.service === serviceName)?.lastError;

  const ppReconnectCountdown = resilienceStatus?.ppReconnectCountdown ?? 0;
  const ppStatus = resilienceStatus
    ? ppReconnectCountdown > 0 || resilienceStatus.overallHealth === "CRITICAL"
      ? "error"
      : "ok"
    : statusOf("propresenter");
  const ppError =
    resilienceStatus && ppReconnectCountdown > 0
      ? `Disconnected. Reconnecting... (Queue: ${resilienceStatus.ppQueueSize} items)`
      : errorOf("propresenter");

  const sttHealth = resilienceStatus?.health.find(
    (entry) => entry.service === "stt",
  );
  const sttStatus = sttHealth
    ? sttHealth.status === "degraded"
      ? "degraded"
      : sttHealth.status === "error"
        ? "error"
        : "ok"
    : statusOf("stt");
  const sttError = sttHealth?.lastError ?? errorOf("stt");

  const aiStatus = resilienceStatus
    ? resilienceStatus.claudeFallbackActive
      ? "degraded"
      : "ok"
    : statusOf("detector");
  const aiError = resilienceStatus?.claudeFallbackActive
    ? "Claude unavailable — local detection in use"
    : errorOf("detector");

  return [
    { label: "PP", status: ppStatus, error: ppError },
    { label: "STT", status: sttStatus, error: sttError },
    { label: "AI", status: aiStatus, error: aiError },
  ];
}

/** Subscribes to orchestrator + resilience status and returns the three cards. */
export function useServiceStatuses(): ServiceStatusCard[] {
  const [health, setHealth] = useState<ServiceHealth[]>([]);
  const [resilienceStatus, setResilienceStatus] =
    useState<ResilienceStatus | null>(null);

  useEffect(() => {
    // Bootstrap already holds the last orchestrator snapshot; use it so the
    // cards are populated before the first live push arrives.
    const bootstrapped = useBootstrapStore.getState().orchestrator;
    if (bootstrapped) setHealth(bootstrapped.health);

    const unsubStatus = window.api.orchestrator.onStatus((status) => {
      setHealth(status.health);
    });
    window.api.resilience
      .getStatus()
      .then(setResilienceStatus)
      .catch(() => undefined);
    const unsubResilience = window.api.resilience.onStatusChange((status) => {
      setResilienceStatus(status);
    });
    return () => {
      unsubStatus();
      unsubResilience();
    };
  }, []);

  return useMemo(
    () => deriveServiceStatuses(health, resilienceStatus),
    [health, resilienceStatus],
  );
}
