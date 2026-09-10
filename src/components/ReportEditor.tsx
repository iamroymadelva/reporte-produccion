import { useCallback, useEffect, useRef, useState } from "react";
import OfflineDraftNotice from "./OfflineDraftNotice";
import PlatformModal from "./PlatformModal";
import {
  getConnectivitySnapshot,
  guardedMutationFetch,
  subscribeConnectivity,
  type ConnectivityState,
} from "../lib/connectivity";
import {
  acknowledgeConfirmedReportRevision,
  getReportDraft,
  OfflineReportStorageError,
  savePendingReportRevision,
} from "../lib/offline-report-store";
import { ClientOperationIdError, createClientOperationId } from "../lib/client-operation-id";
import {
  REPORT_EDITABLE_FIELDS,
  areReportEditableValuesEquivalent,
  pickReportEditableValues,
  reportFormToPayload,
  type ReportEditableField,
} from "../lib/report-fields";

type Option = { id: string; code: string; name: string };
type Shift = { id: string; name: string | null; start_time: string; end_time: string };
type Report = Record<string, unknown> & { id: string };
type ReportForm = Record<ReportEditableField, string>;
type SaveState =
  | "idle"
  | "local-saving"
  | "local-saved"
  | "pending"
  | "server-saving"
  | "server-saved"
  | "storage-error"
  | "server-error"
  | "review";
type ReviewReason = "server-changed" | "finalized" | null;

interface Props {
  report: Report;
  lines: Option[];
  clients: Option[];
  products: Option[];
  dosifierTypes: Option[];
  shifts: Shift[];
  canSubmit: boolean;
  adminCorrection: boolean;
  offlinePersistence?: boolean;
  authenticatedUserId?: string;
  serverUpdatedAt?: string;
  reportFolio?: string;
  machineId?: string;
  machineLabel?: string;
}

const percentageFields = new Set<ReportEditableField>(["process_performance", "operator_performance"]);
const timestampFields = new Set<ReportEditableField>(["started_at", "ended_at"]);
const LOCAL_SAVE_DEBOUNCE_MS = 275;
const SERVER_SAVE_DEBOUNCE_MS = 800;
const LOCAL_STORAGE_ERROR = "No se pudo guardar en este dispositivo. No cierres esta pantalla.";

function localDateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialForm(values: Record<string, unknown>): ReportForm {
  const result = {} as ReportForm;
  for (const field of REPORT_EDITABLE_FIELDS) {
    const value = values[field];
    if (timestampFields.has(field)) result[field] = localDateTime(value);
    else if (percentageFields.has(field) && value !== null && value !== "" && value !== undefined) {
      result[field] = String(Number(value) * 100);
    } else result[field] = value === null || value === undefined ? "" : String(value);
  }
  return result;
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es-CO");
}

function shiftLabel(shift: Shift) {
  const range = `${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)}`;
  return shift.name ? `${shift.name} · ${range}` : range;
}

function logOfflineStorageError(error: unknown) {
  const classified = error instanceof OfflineReportStorageError || error instanceof ClientOperationIdError;
  const cause = classified ? error.cause : undefined;
  const rootCause = cause instanceof ClientOperationIdError ? cause.cause : undefined;
  const summarize = (value: unknown) => value instanceof Error
    ? { name: value.name, message: value.message }
    : value === undefined ? undefined : String(value);
  console.error("[offline-report-storage]", {
    code: classified ? error.code : "UNKNOWN_STORAGE_ERROR",
    message: error instanceof Error ? error.message : String(error),
    cause: summarize(cause),
    rootCause: summarize(rootCause),
  });
}

export default function ReportEditor({
  report,
  lines,
  clients,
  products,
  dosifierTypes,
  shifts,
  canSubmit,
  adminCorrection,
  offlinePersistence = false,
  authenticatedUserId,
  serverUpdatedAt,
  reportFolio,
  machineId,
  machineLabel,
}: Props) {
  const offlineFieldEditingEnabled = offlinePersistence;
  const localPersistenceEnabled = offlinePersistence
    && Boolean(authenticatedUserId && serverUpdatedAt);
  const initialValues = initialForm(report);
  const [form, setForm] = useState<ReportForm>(initialValues);
  const [dirty, setDirty] = useState(false);
  const [hasLocalPending, setHasLocalPending] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<"submit" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [frequentQuestion, setFrequentQuestion] = useState<{ label: string; name: string } | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectivityState>("online");
  const [restoreChecking, setRestoreChecking] = useState(localPersistenceEnabled);
  const [confirmationLocked, setConfirmationLocked] = useState(false);
  const [reviewReason, setReviewReason] = useState<ReviewReason>(null);
  const [autoSaveRevision, setAutoSaveRevision] = useState<number | null>(null);

  const formRef = useRef(form);
  const dirtyRef = useRef(false);
  const localPendingRef = useRef(false);
  const storageFailedRef = useRef(false);
  const reviewReasonRef = useRef<ReviewReason>(null);
  const confirmationLockedRef = useRef(false);
  const connectionUnavailableRef = useRef(false);
  const revision = useRef(0);
  const persistedRevision = useRef(0);
  const serverVersionRef = useRef(serverUpdatedAt ?? String(report.updated_at ?? ""));
  const serverValuesRef = useRef(pickReportEditableValues(report));
  const submitting = useRef(false);
  const cancellationReasonRef = useRef<HTMLTextAreaElement>(null);
  const declinedFrequentValues = useRef(new Set<string>());
  const frequentAnswer = useRef<((answer: boolean) => void) | null>(null);
  const localPersistTimer = useRef<number | null>(null);
  const serverSaveTimer = useRef<number | null>(null);
  const localWriteChain = useRef<Promise<void>>(Promise.resolve());
  const localWritesByRevision = useRef(new Map<number, Promise<boolean>>());
  const writerInstanceId = useRef("");
  const serverSavePromise = useRef<Promise<boolean> | null>(null);
  const serverSaveRequested = useRef(false);
  const forceServerSaveRequested = useRef(false);
  const connectionUnavailable = connectionState === "offline" || connectionState === "unreachable";
  const fieldsDisabled = confirmationLocked
    || reviewReason !== null
    || (offlineFieldEditingEnabled ? restoreChecking : connectionUnavailable);
  const onlineActionDisabled = restoreChecking || reviewReason !== null || connectionUnavailable;

  const persistRevision = useCallback((targetRevision: number, values: ReportForm) => {
    if (!localPersistenceEnabled || !authenticatedUserId || !serverVersionRef.current) {
      return Promise.resolve(true);
    }
    if (persistedRevision.current >= targetRevision) return Promise.resolve(true);
    const existing = localWritesByRevision.current.get(targetRevision);
    if (existing) return existing;

    const task = localWriteChain.current.then(async () => {
      if (persistedRevision.current >= targetRevision) return true;
      if (targetRevision === revision.current) setSaveState("local-saving");
      const editablePayload = reportFormToPayload(values);
      try {
        if (!writerInstanceId.current) writerInstanceId.current = createClientOperationId();
        await savePendingReportRevision({
          userId: authenticatedUserId,
          reportId: report.id,
          folio: reportFolio ?? null,
          machineId: machineId ?? null,
          machineLabel: machineLabel ?? null,
          localValues: editablePayload,
          baseValues: serverValuesRef.current,
          payload: editablePayload,
          baseUpdatedAt: serverVersionRef.current,
          localRevision: targetRevision,
          syncState: "pending",
          writerInstanceId: writerInstanceId.current,
        });
        persistedRevision.current = targetRevision;
        localPendingRef.current = true;
        storageFailedRef.current = false;
        setHasLocalPending(true);
        if (targetRevision === revision.current && !serverSavePromise.current) {
          setSaveState("local-saved");
          setMessage("");
        }
        return true;
      } catch (error) {
        logOfflineStorageError(error);
        storageFailedRef.current = true;
        setSaveState("storage-error");
        setMessage(LOCAL_STORAGE_ERROR);
        return false;
      }
    });

    localWritesByRevision.current.set(targetRevision, task);
    localWriteChain.current = task.then(() => undefined);
    void task.finally(() => localWritesByRevision.current.delete(targetRevision));
    return task;
  }, [authenticatedUserId, localPersistenceEnabled, machineId, machineLabel, report.id, reportFolio]);

  const persistLatest = useCallback(async () => {
    if (localPersistTimer.current !== null) {
      window.clearTimeout(localPersistTimer.current);
      localPersistTimer.current = null;
    }
    if (!localPersistenceEnabled || revision.current < 1) return true;
    if (persistedRevision.current >= revision.current) {
      if (localPendingRef.current) setSaveState("local-saved");
      return true;
    }
    return persistRevision(revision.current, { ...formRef.current });
  }, [localPersistenceEnabled, persistRevision]);

  const requestServerSave = useCallback((force = false) => {
    serverSaveRequested.current = true;
    if (force) forceServerSaveRequested.current = true;
    if (serverSavePromise.current) return serverSavePromise.current;

    const task = (async () => {
      let completed = true;
      while (serverSaveRequested.current) {
        serverSaveRequested.current = false;
        const forceThisPass = forceServerSaveRequested.current;
        forceServerSaveRequested.current = false;

        if (connectionUnavailableRef.current || reviewReasonRef.current) {
          if (localPendingRef.current) setSaveState("pending");
          return false;
        }

        const savingRevision = revision.current;
        const savingValues = { ...formRef.current };
        const hasPendingWork = dirtyRef.current || localPendingRef.current;
        if (!hasPendingWork && !forceThisPass) continue;

        if (localPersistenceEnabled && hasPendingWork && savingRevision > 0) {
          const locallySaved = await persistRevision(savingRevision, savingValues);
          if (!locallySaved) return false;
          if (revision.current !== savingRevision) {
            serverSaveRequested.current = true;
            continue;
          }
        }

        const outgoing = reportFormToPayload(savingValues);
        setSaveState("server-saving");
        setMessage("");

        try {
          const response = await guardedMutationFetch(`/api/reports/${report.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(localPersistenceEnabled
              ? { ...outgoing, _base_updated_at: serverVersionRef.current }
              : outgoing),
          });
          const body = await response.json();
          if (!response.ok) {
            if (body.code === "REPORT_CONFLICT" || body.code === "REPORT_NOT_DRAFT") {
              const reason: ReviewReason = body.code === "REPORT_NOT_DRAFT" ? "finalized" : "server-changed";
              reviewReasonRef.current = reason;
              setReviewReason(reason);
              setSaveState("review");
              setMessage("");
            } else {
              setSaveState("server-error");
              setMessage(body.error ?? "No fue posible guardar en el servidor.");
            }
            return false;
          }

          const confirmedUpdatedAt = String(body.report?.updated_at ?? "");
          if (!confirmedUpdatedAt) throw new Error("El servidor no devolvió la versión guardada del reporte.");
          serverVersionRef.current = confirmedUpdatedAt;
          serverValuesRef.current = outgoing;

          if (localPersistenceEnabled && savingRevision > 0 && localPendingRef.current) {
            let acknowledgement;
            confirmationLockedRef.current = true;
            setConfirmationLocked(true);
            try {
              // Let React disable the fields before the transaction that may delete
              // the confirmed revision, then persist any edit still in its debounce.
              await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
              if (revision.current > savingRevision) {
                const newerPersisted = await persistRevision(revision.current, { ...formRef.current });
                if (!newerPersisted) return false;
              }
              acknowledgement = await acknowledgeConfirmedReportRevision({
                userId: authenticatedUserId!,
                reportId: report.id,
                confirmedLocalRevision: savingRevision,
                confirmedServerValues: outgoing,
                confirmedServerUpdatedAt: confirmedUpdatedAt,
              });
            } catch (error) {
              logOfflineStorageError(error);
              storageFailedRef.current = true;
              setSaveState("storage-error");
              setMessage(LOCAL_STORAGE_ERROR);
              return false;
            } finally {
              confirmationLockedRef.current = false;
              setConfirmationLocked(false);
            }

            if (acknowledgement.status === "cleared" || acknowledgement.status === "missing") {
              if (revision.current === savingRevision) {
                dirtyRef.current = false;
                localPendingRef.current = false;
                storageFailedRef.current = false;
                setDirty(false);
                setHasLocalPending(false);
                setSaveState("server-saved");
              } else {
                dirtyRef.current = true;
                localPendingRef.current = true;
                setDirty(true);
                setHasLocalPending(true);
                setSaveState("pending");
              }
            } else if (acknowledgement.status === "preserved_newer") {
              dirtyRef.current = true;
              localPendingRef.current = true;
              setDirty(true);
              setHasLocalPending(true);
              setSaveState("pending");
            } else {
              setSaveState("pending");
              setMessage("Los cambios locales se conservaron, pero su confirmación requiere revisión.");
              return false;
            }
          } else if (revision.current === savingRevision) {
            dirtyRef.current = false;
            setDirty(false);
            setSaveState("server-saved");
          }

          if (revision.current > savingRevision && !connectionUnavailableRef.current) {
            serverSaveRequested.current = true;
          }
        } catch (error) {
          completed = false;
          if (localPendingRef.current) setSaveState("pending");
          else setSaveState("server-error");
          setMessage(error instanceof Error ? error.message : "No fue posible guardar en el servidor.");
          return false;
        }
      }
      return completed;
    })();

    serverSavePromise.current = task;
    void task.finally(() => {
      if (serverSavePromise.current === task) serverSavePromise.current = null;
    });
    return task;
  }, [authenticatedUserId, localPersistenceEnabled, persistRevision, report.id]);

  useEffect(() => {
    setConnectionState(getConnectivitySnapshot().state);
    return subscribeConnectivity((snapshot) => {
      const unavailable = snapshot.state === "offline" || snapshot.state === "unreachable";
      connectionUnavailableRef.current = unavailable;
      setConnectionState(snapshot.state);
      if (unavailable) {
        setAutoSaveRevision(null);
        if (serverSaveTimer.current !== null) {
          window.clearTimeout(serverSaveTimer.current);
          serverSaveTimer.current = null;
        }
      }
      // A transition back online deliberately does not request an outbox replay.
    });
  }, []);

  useEffect(() => {
    if (!localPersistenceEnabled) {
      setRestoreChecking(false);
      return;
    }
    let active = true;

    void getReportDraft(authenticatedUserId!, report.id).then(async (draft) => {
      if (!active || !draft) return;
      revision.current = draft.localRevision;
      persistedRevision.current = draft.localRevision;
      localPendingRef.current = true;
      setHasLocalPending(true);

      if (serverVersionRef.current === draft.baseUpdatedAt) {
        const restoredForm = initialForm(draft.localValues);
        formRef.current = restoredForm;
        dirtyRef.current = true;
        setForm(restoredForm);
        setDirty(true);
        setSaveState("pending");
        return;
      }

      if (areReportEditableValuesEquivalent(serverValuesRef.current, draft.localValues)) {
        const result = await acknowledgeConfirmedReportRevision({
          userId: authenticatedUserId!,
          reportId: report.id,
          confirmedLocalRevision: draft.localRevision,
          confirmedServerValues: serverValuesRef.current,
          confirmedServerUpdatedAt: serverVersionRef.current,
        });
        if (!active) return;
        if (result.status === "cleared" || result.status === "missing") {
          localPendingRef.current = false;
          dirtyRef.current = false;
          setHasLocalPending(false);
          setDirty(false);
          setSaveState("server-saved");
          return;
        }
      }

      reviewReasonRef.current = "server-changed";
      setReviewReason("server-changed");
      setSaveState("review");
    }).catch((error) => {
      if (!active) return;
      logOfflineStorageError(error);
      storageFailedRef.current = true;
      setSaveState("storage-error");
      setMessage(LOCAL_STORAGE_ERROR);
    }).finally(() => {
      if (active) setRestoreChecking(false);
    });

    return () => { active = false; };
  }, [authenticatedUserId, localPersistenceEnabled, report.id]);

  useEffect(() => {
    if (!localPersistenceEnabled || restoreChecking || !dirty) return;
    if (persistedRevision.current >= revision.current) return;
    if (localPersistTimer.current !== null) window.clearTimeout(localPersistTimer.current);
    setSaveState("local-saving");
    const timer = window.setTimeout(() => {
      if (localPersistTimer.current === timer) localPersistTimer.current = null;
      void persistLatest();
    }, LOCAL_SAVE_DEBOUNCE_MS);
    localPersistTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (localPersistTimer.current === timer) localPersistTimer.current = null;
    };
  }, [dirty, form, localPersistenceEnabled, persistLatest, restoreChecking]);

  useEffect(() => {
    if (
      autoSaveRevision === null
      || autoSaveRevision !== revision.current
      || connectionUnavailable
      || restoreChecking
      || reviewReason !== null
    ) return;
    if (serverSaveTimer.current !== null) window.clearTimeout(serverSaveTimer.current);
    const timer = window.setTimeout(() => {
      if (serverSaveTimer.current === timer) serverSaveTimer.current = null;
      void requestServerSave();
    }, SERVER_SAVE_DEBOUNCE_MS);
    serverSaveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (serverSaveTimer.current === timer) serverSaveTimer.current = null;
    };
  }, [autoSaveRevision, connectionUnavailable, requestServerSave, restoreChecking, reviewReason]);

  useEffect(() => {
    const flushLocal = () => {
      if (localPersistenceEnabled && (dirtyRef.current || localPendingRef.current)) {
        void persistLatest();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushLocal();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushLocal);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushLocal);
      flushLocal();
    };
  }, [localPersistenceEnabled, persistLatest]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      const unsafe = dirtyRef.current
        || localPendingRef.current
        || storageFailedRef.current
        || localPersistTimer.current !== null
        || serverSavePromise.current !== null;
      if (!submitting.current && unsafe) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);

  const applyEditedForm = (next: ReportForm) => {
    if (confirmationLockedRef.current) return;
    const nextRevision = revision.current + 1;
    revision.current = nextRevision;
    formRef.current = next;
    dirtyRef.current = true;
    setForm(next);
    setDirty(true);
    setMessage("");

    if (localPersistenceEnabled) {
      localPendingRef.current = true;
      setHasLocalPending(true);
      setSaveState("local-saving");
    } else setSaveState("idle");

    if (connectionUnavailableRef.current) setAutoSaveRevision(null);
    else {
      setAutoSaveRevision(nextRevision);
      if (serverSavePromise.current) serverSaveRequested.current = true;
    }
  };

  const update = (field: ReportEditableField, value: string) => {
    applyEditedForm({ ...formRef.current, [field]: value });
  };

  const updateFrequentText = (
    field: "client_name" | "product_name",
    idField: "client_id" | "product_id",
    value: string,
    options: Option[],
  ) => {
    const exact = options.find((option) => normalized(option.name) === normalized(value));
    applyEditedForm({ ...formRef.current, [field]: value, [idField]: exact?.id ?? "" });
  };

  const askToSaveFrequentValue = (label: string, name: string) => new Promise<boolean>((resolve) => {
    frequentAnswer.current = resolve;
    setFrequentQuestion({ label, name });
  });

  const answerFrequentQuestion = (answer: boolean) => {
    frequentAnswer.current?.(answer);
    frequentAnswer.current = null;
    setFrequentQuestion(null);
  };

  const prepareFrequentValues = async () => {
    const next = { ...formRef.current };
    const candidates = [
      { catalog: "clients", label: "Cliente", nameField: "client_name", idField: "client_id", options: clients },
      { catalog: "products", label: "Producto", nameField: "product_name", idField: "product_id", options: products },
    ] as const;
    try {
      for (const candidate of candidates) {
        const name = next[candidate.nameField].trim();
        if (!name) {
          next[candidate.idField] = "";
          continue;
        }
        const existing = candidate.options.find((option) => normalized(option.name) === normalized(name));
        if (existing) {
          next[candidate.idField] = existing.id;
          continue;
        }
        next[candidate.idField] = "";
        const token = `${candidate.catalog}:${normalized(name)}`;
        if (declinedFrequentValues.current.has(token)) continue;
        const shouldSave = await askToSaveFrequentValue(candidate.label, name);
        if (!shouldSave) {
          declinedFrequentValues.current.add(token);
          continue;
        }
        const response = await guardedMutationFetch("/api/catalogs/frequent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ catalog: candidate.catalog, name }),
        });
        const body = await response.json();
        if (!response.ok || !body.id) {
          throw new Error(body.error ?? `No fue posible guardar ${candidate.label} como frecuente.`);
        }
        next[candidate.idField] = body.id;
        declinedFrequentValues.current.add(token);
      }
      if (JSON.stringify(next) !== JSON.stringify(formRef.current)) applyEditedForm(next);
      return next;
    } catch (error) {
      setSaveState("server-error");
      setMessage(error instanceof Error ? error.message : "No fue posible guardar el valor frecuente.");
      return null;
    }
  };

  const saveManually = async () => {
    if (localPersistenceEnabled) {
      const locallySaved = await persistLatest();
      if (!locallySaved) return;
      if (connectionUnavailableRef.current) {
        if (localPendingRef.current) setSaveState("local-saved");
        setMessage("");
        return;
      }
    }
    if (connectionUnavailableRef.current) return;
    const prepared = await prepareFrequentValues();
    if (prepared) await requestServerSave(true);
  };

  const submit = async () => {
    setModal(null);
    const prepared = await prepareFrequentValues();
    if (!prepared) return;
    submitting.current = true;
    if (!(await requestServerSave(true)) || dirtyRef.current || localPendingRef.current) {
      submitting.current = false;
      return;
    }
    setSaveState("server-saving");
    try {
      const response = await guardedMutationFetch(`/api/reports/${report.id}/submit`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No fue posible enviar el reporte.");
      window.location.reload();
    } catch (error) {
      submitting.current = false;
      setSaveState("server-error");
      setMessage(error instanceof Error ? error.message : "No fue posible enviar el reporte.");
    }
  };

  const cancel = async () => {
    const reason = cancelReason.trim();
    if (!reason) {
      setSaveState("server-error");
      setMessage("Debes indicar el motivo de cancelación.");
      return;
    }

    setModal(null);
    submitting.current = true;
    try {
      const response = await guardedMutationFetch(`/api/reports/${report.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No fue posible cancelar el reporte.");
      window.location.reload();
    } catch (error) {
      submitting.current = false;
      setSaveState("server-error");
      setMessage(error instanceof Error ? error.message : "No fue posible cancelar el reporte.");
    }
  };

  const select = (field: ReportEditableField, label: string, options: Option[]) => (
    <label>
      <span className="field-label">{label}</span>
      <select className="field-control" value={form[field]} disabled={fieldsDisabled} onChange={(event) => update(field, event.target.value)}>
        <option value="">Sin seleccionar</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.code} · {option.name}</option>)}
      </select>
    </label>
  );

  const input = (field: ReportEditableField, label: string, type = "text", extra: Record<string, string | number> = {}) => (
    <label className="min-w-0">
      <span className="field-label">{label}</span>
      <input className={`field-control ${type === "number" ? "text-lg tabular-nums" : ""}`} type={type} value={form[field]} disabled={fieldsDisabled} onChange={(event) => update(field, event.target.value)} {...extra} />
    </label>
  );

  const statusLabel = restoreChecking
    ? "Revisando cambios locales…"
    : saveState === "local-saving"
      ? "Guardando en este dispositivo…"
      : saveState === "local-saved"
        ? "Guardado en este dispositivo"
        : saveState === "pending"
          ? "Cambios pendientes de sincronizar"
          : saveState === "server-saving"
            ? "Guardando en servidor…"
            : saveState === "server-saved"
              ? "Guardado en servidor"
              : saveState === "storage-error"
                ? "Error de almacenamiento local"
                : saveState === "server-error"
                  ? "Error al guardar"
                  : saveState === "review"
                    ? "Cambios locales pendientes de revisión"
                    : dirty
                      ? "Cambios pendientes"
                      : "Sin cambios";
  const statusError = saveState === "storage-error" || saveState === "server-error";
  const statusReview = saveState === "review";

  return (
    <>
      <OfflineDraftNotice visible={reviewReason !== null} finalized={reviewReason === "finalized"} />
      <section className="panel">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{adminCorrection ? "Corrección administrativa" : "Datos del reporte"}</h2>
            <p className="text-sm text-slate-500">
              {connectionUnavailable
                ? localPersistenceEnabled
                  ? "Puedes seguir editando. Los cambios se guardan en este dispositivo."
                  : "La edición requiere conexión. Los cambios actuales no se guardarán automáticamente."
                : hasLocalPending
                  ? "Hay cambios locales pendientes. Usa Guardar ahora para enviarlos al servidor."
                  : "Los cambios se guardan automáticamente."}
            </p>
          </div>
          <p className={`rounded-full px-3 py-2 text-sm font-semibold ${statusError ? "bg-red-100 text-red-800" : statusReview ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`} aria-live="polite">
            {statusLabel}
          </p>
        </div>
        {message && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{message}</p>}
        {saveState === "storage-error" && (dirty || hasLocalPending) && (
          <button className="button-secondary mb-5" type="button" onClick={() => void persistLatest()}>
            Reintentar guardado local
          </button>
        )}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {input("report_date", "Fecha", "date")}
          {input("production_order", "Orden de producción (O.P.)")}
          {select("line_id", "Área / Línea", lines)}
          <label><span className="field-label">Cliente</span><input className="field-control" list="client-suggestions" value={form.client_name} disabled={fieldsDisabled} onChange={(event) => updateFrequentText("client_name", "client_id", event.target.value, clients)} /><datalist id="client-suggestions">{clients.map((client) => <option key={client.id} value={client.name}>{client.code}</option>)}</datalist></label>
          {input("lot", "Lote")}
          <label><span className="field-label">Turno</span><select className="field-control" value={form.shift_id} disabled={fieldsDisabled} onChange={(event) => update("shift_id", event.target.value)}><option value="">Sin seleccionar</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shiftLabel(shift)}</option>)}</select></label>
          <label><span className="field-label">Producto</span><input className="field-control" list="product-suggestions" value={form.product_name} disabled={fieldsDisabled} onChange={(event) => updateFrequentText("product_name", "product_id", event.target.value, products)} /><datalist id="product-suggestions">{products.map((product) => <option key={product.id} value={product.name}>{product.code}</option>)}</datalist></label>
          {input("weight", "Peso (gr)", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {input("g_min", "G/min", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {select("dosifier_type_id", "Tipo de dosificador", dosifierTypes)}
          {input("started_at", "Hora de inicio", "datetime-local")}
          {input("ended_at", "Hora de finalización", "datetime-local")}
          {input("programmed_hours", "Horas programadas", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {input("units_produced", "Unidades producidas", "number", { min: 0, step: 1, inputMode: "numeric" })}
          {input("waste", "Desperdicio", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {input("process_performance", "Rendimiento del proceso (%)", "number", { step: "any", inputMode: "decimal" })}
          {input("operator_performance", "Rendimiento del Operario (%)", "number", { step: "any", inputMode: "decimal" })}
          <label className="md:col-span-2 xl:col-span-3"><span className="field-label">Observaciones</span><textarea className="field-control min-h-28" value={form.observations} disabled={fieldsDisabled} onChange={(event) => update("observations", event.target.value)} /></label>
        </div>
        <p className="mt-4 text-sm text-slate-500">Cliente y Producto aceptan texto libre; los valores frecuentes aparecen como sugerencias.</p>
        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          {canSubmit ? <button className="button-danger w-full sm:w-auto" type="button" disabled={onlineActionDisabled} onClick={() => { setCancelReason(""); setModal("cancel"); }}>Cancelar reporte</button> : <span />}
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:justify-end">
            <button className="button-secondary w-full sm:w-auto" type="button" disabled={restoreChecking || reviewReason !== null || (connectionUnavailable && !localPersistenceEnabled)} onClick={() => void saveManually()}>
              {connectionUnavailable && localPersistenceEnabled ? "Guardar en este dispositivo" : "Guardar ahora"}
            </button>
            {canSubmit && <button className="button-primary w-full sm:w-auto" type="button" disabled={onlineActionDisabled} onClick={() => {
              if (!form.ended_at) {
                setSaveState("server-error");
                setMessage("Debes registrar la hora de finalización antes de enviar el reporte.");
                return;
              }
              setModal("submit");
            }}>Enviar reporte</button>}
          </div>
        </div>
        {modal === "submit" && <PlatformModal title="Enviar reporte" confirmLabel="Enviar reporte" confirmDisabled={connectionUnavailable} onCancel={() => setModal(null)} onConfirm={() => void submit()}>
          <p>Después de enviarlo, el reporte quedará en modo de solo lectura para el Operario y ya no podrá modificarlo.</p>
        </PlatformModal>}
        {modal === "cancel" && <PlatformModal title="Cancelar reporte" confirmLabel="Confirmar cancelación" destructive confirmDisabled={!cancelReason.trim() || connectionUnavailable} initialFocusRef={cancellationReasonRef} onCancel={() => setModal(null)} onConfirm={() => void cancel()}>
          <p>El reporte quedará en modo de solo lectura y la máquina se liberará para un nuevo reporte.</p>
          <label className="mt-5 block"><span className="field-label">Motivo de cancelación</span><textarea ref={cancellationReasonRef} className="field-control min-h-28" value={cancelReason} disabled={connectionUnavailable} onChange={(event) => setCancelReason(event.target.value)} required /></label>
        </PlatformModal>}
        {frequentQuestion && <PlatformModal title={`Guardar ${frequentQuestion.label.toLocaleLowerCase("es-CO")}`} cancelLabel="No guardar" confirmLabel="Guardar como frecuente" confirmDisabled={connectionUnavailable} onCancel={() => answerFrequentQuestion(false)} onConfirm={() => answerFrequentQuestion(true)}>
          <p>“{frequentQuestion.name}” no existe entre los valores frecuentes. ¿Deseas guardarlo para futuros reportes?</p>
        </PlatformModal>}
      </section>
    </>
  );
}
