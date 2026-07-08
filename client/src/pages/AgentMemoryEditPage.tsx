import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { CubeTransparentIcon } from "@heroicons/react/24/outline";
import { PageShell } from "../components/ui/PageShell";
import { Button, Card, EmptyState, Input, Select } from "../components/ui/primitives";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import {
  EMPTY_MEMORY_PAYLOAD_DRAFT,
  MEMORY_TYPE_OPTIONS,
  buildPayloadForMemoryType,
  memoryApi,
  parseTags,
  toMemoryType,
  toPayloadDraft,
  type MemoryEntry,
  type MemoryPayloadDraft,
  type MemoryType,
} from "./memoryApi";

export const AgentMemoryEditPage: React.FC = () => {
  const navigate = useNavigate();
  const { memoryId = "" } = useParams<{ memoryId: string }>();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [entry, setEntry] = useState<MemoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [memoryType, setMemoryType] = useState<MemoryType>("core.note");
  const [confidence, setConfidence] = useState("0.70");
  const [draft, setDraft] = useState<MemoryPayloadDraft>(EMPTY_MEMORY_PAYLOAD_DRAFT);

  const loadEntry = useCallback(async () => {
    if (!memoryId) return;
    setLoading(true);
    setError("");

    try {
      const response = await memoryApi(`/api/memory/${encodeURIComponent(memoryId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Load failed (${response.status})`));
      }

      const current = data as MemoryEntry;
      setEntry(current);
      setTitle(String(current.title || ""));
      setTags(Array.isArray(current.tags) ? current.tags.join(", ") : "");
      setMemoryType(toMemoryType(current.memoryType));
      setConfidence(typeof current.confidence === "number" ? current.confidence.toFixed(2) : "0.70");
      setDraft(toPayloadDraft(current));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("memory.error.load"));
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [memoryId, t]);

  useEffect(() => {
    void loadEntry();
  }, [loadEntry]);

  const updateDraft = (field: keyof MemoryPayloadDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const renderTypedFields = () => {
    if (memoryType === "risk") {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>{t("memory.fields.severity")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Select 
              value={draft.severity} 
              onChange={(value) => updateDraft("severity", value)} 
              placeholder={t("memory.fields.select")}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>{t("memory.fields.impact")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.impact} onChange={(event) => updateDraft("impact", event.target.value)} required />
          </div>
          <div className="sm:col-span-3">
            <label className={labelCls}>{t("memory.fields.mitigation")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.mitigation} onChange={(event) => updateDraft("mitigation", event.target.value)} required />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>{t("memory.fields.sourceRef")}</label>
            <Input value={draft.sourceRef} onChange={(event) => updateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.evidenceUrl")}</label>
            <Input value={draft.evidenceUrl} onChange={(event) => updateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (memoryType === "decision") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.decision")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.decision} onChange={(event) => updateDraft("decision", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.rationale")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.rationale} onChange={(event) => updateDraft("rationale", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.sourceRef")}</label>
            <Input value={draft.sourceRef} onChange={(event) => updateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.evidenceUrl")}</label>
            <Input value={draft.evidenceUrl} onChange={(event) => updateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (memoryType === "resource") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.resourceKind")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.resourceKind} onChange={(event) => updateDraft("resourceKind", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.resourceRef")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.resourceRef} onChange={(event) => updateDraft("resourceRef", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.sourceRef")}</label>
            <Input value={draft.sourceRef} onChange={(event) => updateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.evidenceUrl")}</label>
            <Input value={draft.evidenceUrl} onChange={(event) => updateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (memoryType === "constraint") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.constraint")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.constraint} onChange={(event) => updateDraft("constraint", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.scopeHint")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.scopeHint} onChange={(event) => updateDraft("scopeHint", event.target.value)} required />
          </div>
        </div>
      );
    }

    if (memoryType === "handover") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.nextAction")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.nextAction} onChange={(event) => updateDraft("nextAction", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.owner")} <span className={isDark ? "text-red-400" : "text-red-600"}>*</span></label>
            <Input value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value)} required />
          </div>
        </div>
      );
    }

    return null;
  };

  const save = async () => {
    if (!entry) return;
    if (!entry.editable) {
      toast.error(t("memory.error.notEditable"));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await memoryApi(`/api/memory/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          note: draft.note.trim(),
          tags: parseTags(tags),
          memoryType,
          confidence: Number(confidence),
          payload: buildPayloadForMemoryType(memoryType, draft),
          expiresAt: draft.validUntil ? draft.validUntil : null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Update failed (${response.status})`));
      }
      toast.success(t("memory.toast.updated"));
      navigate(`/memory/${entry.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("memory.error.update");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const labelCls = `mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`;

  return (
    <PageShell
      maxWidth="3xl"
      title={t("memory.edit.title")}
      subtitle={t("memory.edit.subtitle")}
      actions={
        <>
          <Button size="sm" type="button" variant="secondary" onClick={() => navigate(memoryId ? `/memory/${memoryId}` : "/memory")}>
            {t("memory.list.cancel")}
          </Button>
          <Button size="sm" type="button" onClick={() => void save()} disabled={saving || !entry?.editable}>
            {saving ? t("common.loading") : t("memory.list.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        {error && (
          <div className={`rounded p-3 text-sm ${isDark ? "bg-red-900/50 text-red-200" : "bg-red-50 text-red-700"}`}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : !entry ? (
          <EmptyState
            title={t("memory.detail.notFound")}
            icon={<CubeTransparentIcon className="w-8 h-8" />}
            action={
              <Button type="button" size="sm" variant="secondary" onClick={() => navigate("/memory")}>
                {t("memory.detail.back")}
              </Button>
            }
          />
        ) : (
          <Card className="p-4 sm:p-5">
            <div className="grid gap-4">
              <div>
                <label className={labelCls}>{t("memory.create.titleLabel")}</label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>

              <div>
                <label className={labelCls}>
                  {t("memory.create.note")}
                  {(memoryType === "core.note" || memoryType === "risk") && <span className={isDark ? "text-red-400" : "text-red-600"}> *</span>}
                </label>
                <textarea
                  value={draft.note}
                  onChange={(event) => updateDraft("note", event.target.value)}
                  placeholder={t("memory.create.notePlaceholder")}
                  required={memoryType === "core.note" || memoryType === "risk"}
                  className={`w-full min-h-[160px] resize-y rounded-lg border px-3 py-2 text-sm ${
                    isDark
                      ? "border-gray-700/50 bg-gray-900 text-gray-100 placeholder:text-gray-500"
                      : "border-gray-300/60 bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>{t("memory.create.type")}</label>
                  <Select 
                    value={memoryType} 
                    onChange={(value) => setMemoryType(value as MemoryType)}
                    options={MEMORY_TYPE_OPTIONS.map((type) => ({
                      value: type,
                      label: t(`memory.type.${type}`),
                    }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t("memory.create.tags")}</label>
                  <Input
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder={t("memory.create.tagsPlaceholder")}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t("memory.create.confidence")}</label>
                  <Input
                    value={confidence}
                    onChange={(event) => setConfidence(event.target.value)}
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>{t("memory.fields.owner")}</label>
                  <Input value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("memory.fields.lastValidatedAt")}</label>
                  <Input
                    type="date"
                    value={draft.lastValidatedAt}
                    onChange={(event) => updateDraft("lastValidatedAt", event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t("memory.fields.validUntil")}</label>
                  <Input type="date" value={draft.validUntil} onChange={(event) => updateDraft("validUntil", event.target.value)} />
                </div>
              </div>

              {renderTypedFields()}

              {!entry.editable && (
                <div className={`rounded-lg border px-3 py-2 text-sm ${isDark ? "border-amber-700 bg-amber-900/30 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                  {t("memory.error.notEditable")}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
};
