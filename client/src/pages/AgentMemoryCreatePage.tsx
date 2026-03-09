import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../components/ui/PageShell";
import { Button, Card, Input, Select } from "../components/ui/primitives";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import {
  EMPTY_MEMORY_PAYLOAD_DRAFT,
  MEMORY_TYPE_OPTIONS,
  buildPayloadForMemoryType,
  fetchMemoryProjects,
  memoryApi,
  parseTags,
  type MemoryPayloadDraft,
  type MemoryProject,
  type MemoryScope,
  type MemoryType,
} from "./memoryApi";

export const AgentMemoryCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [projects, setProjects] = useState<MemoryProject[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [createScope, setCreateScope] = useState<Exclude<MemoryScope, "ALL">>("GLOBAL");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createTags, setCreateTags] = useState("");
  const [createConfidence, setCreateConfidence] = useState("0.72");
  const [createType, setCreateType] = useState<MemoryType>("core.note");
  const [createDraft, setCreateDraft] = useState<MemoryPayloadDraft>(EMPTY_MEMORY_PAYLOAD_DRAFT);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const normalized = await fetchMemoryProjects();
        setProjects(normalized);
      } catch {
        // best effort
      }
    };

    void loadProjects();
  }, []);

  const updateCreateDraft = (field: keyof MemoryPayloadDraft, value: string) => {
    setCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const renderTypedFields = () => {
    const labelCls = `mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`;
    if (createType === "risk") {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>{t("memory.fields.severity")} <span className="text-red-400">*</span></label>
            <Select 
              value={createDraft.severity} 
              onChange={(value) => updateCreateDraft("severity", value)} 
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
            <label className={labelCls}>{t("memory.fields.impact")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.impact} onChange={(event) => updateCreateDraft("impact", event.target.value)} required />
          </div>
          <div className="sm:col-span-3">
            <label className={labelCls}>{t("memory.fields.mitigation")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.mitigation} onChange={(event) => updateCreateDraft("mitigation", event.target.value)} required />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>{t("memory.fields.sourceRef")}</label>
            <Input value={createDraft.sourceRef} onChange={(event) => updateCreateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.evidenceUrl")}</label>
            <Input value={createDraft.evidenceUrl} onChange={(event) => updateCreateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (createType === "decision") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.decision")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.decision} onChange={(event) => updateCreateDraft("decision", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.rationale")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.rationale} onChange={(event) => updateCreateDraft("rationale", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.sourceRef")}</label>
            <Input value={createDraft.sourceRef} onChange={(event) => updateCreateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.evidenceUrl")}</label>
            <Input value={createDraft.evidenceUrl} onChange={(event) => updateCreateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (createType === "resource") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.resourceKind")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.resourceKind} onChange={(event) => updateCreateDraft("resourceKind", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.resourceRef")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.resourceRef} onChange={(event) => updateCreateDraft("resourceRef", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.sourceRef")}</label>
            <Input value={createDraft.sourceRef} onChange={(event) => updateCreateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.evidenceUrl")}</label>
            <Input value={createDraft.evidenceUrl} onChange={(event) => updateCreateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (createType === "constraint") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.constraint")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.constraint} onChange={(event) => updateCreateDraft("constraint", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.scopeHint")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.scopeHint} onChange={(event) => updateCreateDraft("scopeHint", event.target.value)} required />
          </div>
        </div>
      );
    }

    if (createType === "handover") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("memory.fields.nextAction")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.nextAction} onChange={(event) => updateCreateDraft("nextAction", event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>{t("memory.fields.owner")} <span className="text-red-400">*</span></label>
            <Input value={createDraft.owner} onChange={(event) => updateCreateDraft("owner", event.target.value)} required />
          </div>
        </div>
      );
    }

    return null;
  };

  const saveEntry = async () => {
    if (!createDraft.note.trim()) {
      const msg = t("memory.error.noteRequired");
      setError(msg);
      toast.error(msg);
      return;
    }
    if (createScope === "PROJECT" && !createProjectId) {
      const msg = t("memory.error.projectRequired");
      setError(msg);
      toast.error(msg);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await memoryApi("/api/memory", {
        method: "POST",
        body: JSON.stringify({
          scope: createScope,
          projectId: createScope === "PROJECT" ? createProjectId : undefined,
          memoryType: createType,
          title: createTitle.trim(),
          note: createDraft.note.trim(),
          payload: buildPayloadForMemoryType(createType, createDraft),
          tags: parseTags(createTags),
          confidence: Number(createConfidence),
          expiresAt: createDraft.validUntil ? createDraft.validUntil : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Save failed (${response.status})`));
      }

      toast.success(t("memory.toast.saved"));
      navigate(data?.id ? `/memory/${data.id}` : "/memory");
    } catch (err: any) {
      const msg = err?.message || t("memory.error.save");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const labelCls = `mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`;
  const canCreate =
    createDraft.note.trim().length > 0 &&
    (createScope !== "PROJECT" || Boolean(createProjectId));

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">🧠 {t("memory.create.title")}</span>}
      subtitle={t("memory.create.subtitle")}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={() => navigate("/memory")} disabled={saving}>
            {t("memory.list.cancel")}
          </Button>
          <Button type="button" onClick={() => void saveEntry()} disabled={saving || !canCreate}>
            {saving ? t("common.loading") : t("memory.create.action")}
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

        <Card className="p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className={labelCls}>{t("memory.create.scope")}</label>
              <Select
                value={createScope}
                onChange={(value) => {
                  const nextScope = value as Exclude<MemoryScope, "ALL">;
                  setCreateScope(nextScope);
                  if (nextScope !== "PROJECT") setCreateProjectId("");
                }}
                options={[
                  { value: "PROJECT", label: t("memory.scope.project") },
                  { value: "GLOBAL", label: t("memory.scope.global") },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>
                {t("memory.create.project")}
                {createScope === "PROJECT" && <span className="text-red-400"> *</span>}
              </label>
              <Select
                value={createProjectId}
                onChange={(value) => setCreateProjectId(value)}
                disabled={createScope !== "PROJECT"}
                placeholder={t("memory.filter.projectPlaceholder")}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
              />
            </div>
            <div>
              <label className={labelCls}>{t("memory.create.type")}</label>
              <Select 
                value={createType} 
                onChange={(value) => setCreateType(value as MemoryType)}
                options={MEMORY_TYPE_OPTIONS.map((type) => ({
                  value: type,
                  label: t(`memory.type.${type}`),
                }))}
              />
            </div>
            <div>
              <label className={labelCls}>{t("memory.create.confidence")}</label>
              <Input
                value={createConfidence}
                onChange={(event) => setCreateConfidence(event.target.value)}
                type="number"
                step="0.01"
                min="0"
                max="1"
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-4">
            <div className="xl:col-span-1">
              <label className={labelCls}>{t("memory.create.titleLabel")}</label>
              <Input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
            </div>
            <div className="xl:col-span-1">
              <label className={labelCls}>{t("memory.create.tags")}</label>
              <Input
                value={createTags}
                onChange={(event) => setCreateTags(event.target.value)}
                placeholder={t("memory.create.tagsPlaceholder")}
              />
            </div>
            <div className="xl:col-span-2">
              <label className={labelCls}>{t("memory.create.note")} <span className="text-red-400">*</span></label>
              <textarea
                value={createDraft.note}
                onChange={(event) => updateCreateDraft("note", event.target.value)}
                placeholder={t("memory.create.notePlaceholder")}
                required
                className={`w-full min-h-[100px] resize-y rounded-lg border px-3 py-2 text-sm ${
                  isDark
                    ? "border-gray-700/50 bg-gray-900 text-gray-100 placeholder:text-gray-500"
                    : "border-gray-300/60 bg-white text-gray-900 placeholder:text-gray-400"
                }`}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>{t("memory.fields.owner")}</label>
              <Input value={createDraft.owner} onChange={(event) => updateCreateDraft("owner", event.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t("memory.fields.lastValidatedAt")}</label>
              <Input
                type="date"
                value={createDraft.lastValidatedAt}
                onChange={(event) => updateCreateDraft("lastValidatedAt", event.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>{t("memory.fields.validUntil")}</label>
              <Input
                type="date"
                value={createDraft.validUntil}
                onChange={(event) => updateCreateDraft("validUntil", event.target.value)}
              />
            </div>
          </div>

          <div className="mt-3">{renderTypedFields()}</div>
        </Card>
      </div>
    </PageShell>
  );
};
