import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuthStore } from "../stores/authStore";
import { useTheme } from "../contexts/ThemeContext";
import { useLanguage } from "../contexts/LanguageContext";
import { PageShell } from "../components/ui/PageShell";
import {
  Card,
  SectionHeader,
  Button,
  Input,
  Select,
} from "../components/ui/primitives";
import {
  AgentConfig,
  DEFAULT_AGENT_CONFIG,
  fetchAgentConfig,
  updateAgentConfig,
} from "../services/agentConfigApi";
import {
  ConnectorInfo,
  fetchConnectors,
  fetchPermissions,
  updatePermissions,
  PermissionUpdate,
} from "../services/connectorApi";

export const AgentConfigPage: React.FC = () => {
  const { agentTokenId } = useParams<{ agentTokenId: string }>();
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_AGENT_CONFIG);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [permissions, setPermissions] = useState<Map<string, string[]>>(new Map());
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  useEffect(() => {
    if (!agentTokenId || !token) return;

    const loadConfig = async () => {
      try {
        setLoading(true);
        const data = await fetchAgentConfig(agentTokenId);
        setAgentName(data.name || agentTokenId || "");
        setConfig(data.config);
        setFeedback(null);
      } catch (error) {
        console.error("Failed to load agent config:", error);
        toast.error(t("agentConfig.error.loadConfig"));
        navigate("/admin");
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [agentTokenId, token, navigate, t]);

  useEffect(() => {
    if (!agentTokenId || !token) return;
    const loadPermissions = async () => {
      try {
        setPermissionsLoading(true);
        const [conns, perms] = await Promise.all([
          fetchConnectors(),
          fetchPermissions(agentTokenId),
        ]);
        setConnectors(conns.filter((c) => c.status !== "disconnected"));
        const permMap = new Map<string, string[]>();
        for (const p of perms) {
          permMap.set(p.connectorId, p.allowedActions);
        }
        setPermissions(permMap);
      } catch (err) {
        console.error("Failed to load connector permissions:", err);
      } finally {
        setPermissionsLoading(false);
      }
    };
    loadPermissions();
  }, [agentTokenId, token]);

  const handleSave = async () => {
    if (!agentTokenId || !token || !config) return;

    try {
      setSaving(true);
      const data = await updateAgentConfig(agentTokenId, config);
      const permUpdates: PermissionUpdate[] = [];
      permissions.forEach((actions, connectorId) => {
        if (actions.length > 0) {
          permUpdates.push({ connectorId, allowedActions: actions });
        }
      });
      await updatePermissions(agentTokenId, permUpdates);
      setConfig(data.config);
      setFeedback({ type: "success", text: t("agentConfig.configSaved") });
      toast.success(t("agentConfig.configSaved"));
    } catch (error) {
      console.error("Failed to save agent config:", error);
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : t("agentConfig.error.saveConfig"),
      });
      toast.error(t("agentConfig.error.saveConfig"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_AGENT_CONFIG);
    setFeedback({ type: "success", text: t("agentConfig.resetDone") });
    toast.success(t("agentConfig.resetDone"));
  };

  const updateField = <K extends keyof AgentConfig>(
    field: K,
    value: AgentConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <PageShell maxWidth="3xl">
        <div className="flex items-center justify-center h-32">{t("agentConfig.loading")}</div>
      </PageShell>
    );
  }

  const Toggle = ({
    label,
    checked,
    onChange,
  }: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }) => (
    <div className="flex items-center justify-between py-2">
      <span className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          checked ? "bg-blue-600" : isDark ? "bg-gray-600" : "bg-gray-200"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );

  return (
    <PageShell
      maxWidth="3xl"
      title={t("agentConfig.pageTitle").replace("{name}", agentName)}
      subtitle={t("agentConfig.pageSubtitle")}
    >
      <div className="mb-6">
        <Link
          to="/admin"
          className={`text-sm hover:underline ${isDark ? "text-blue-400" : "text-blue-600"}`}
        >
          &larr; {t("agentConfig.backToAdmin")}
        </Link>
      </div>

      <div className="space-y-6">
        <Card className="p-4 sm:p-6">
          <SectionHeader title={t("agentConfig.section.communication")} className="mb-4" />
          <div className="space-y-4">
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("agentConfig.field.messageFrequency")}
              </label>
              <Select
                value={config.messageFrequency}
                onChange={(val) =>
                  updateField(
                    "messageFrequency",
                    val as AgentConfig["messageFrequency"],
                  )
                }
                options={[
                  { value: "low", label: t("agentConfig.option.frequencyLow") },
                  { value: "medium", label: t("agentConfig.option.frequencyMedium") },
                  { value: "high", label: t("agentConfig.option.frequencyHigh") },
                ]}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("agentConfig.field.proactivity")}
              </label>
              <Select
                value={config.proactivity}
                onChange={(val) =>
                  updateField("proactivity", val as AgentConfig["proactivity"])
                }
                options={[
                  { value: "reactive", label: t("agentConfig.option.reactive") },
                  { value: "balanced", label: t("agentConfig.option.balanced") },
                  { value: "proactive", label: t("agentConfig.option.proactive") },
                ]}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("agentConfig.field.maxMessagesPerMinute")}
              </label>
              <Input
                type="number"
                min={1}
                max={60}
                value={config.maxMessagesPerMinute}
                onChange={(e) =>
                  updateField(
                    "maxMessagesPerMinute",
                    Math.max(
                      1,
                      Math.min(60, parseInt(e.target.value, 10) || 1),
                    ),
                  )
                }
              />
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-6">
          <SectionHeader title={t("agentConfig.section.actions")} className="mb-4" />
          <div className="space-y-2 divide-y divide-gray-200 dark:divide-gray-700/50">
            <Toggle
              label={t("agentConfig.toggle.canUploadAttachments")}
              checked={config.canUploadAttachments}
              onChange={(val) => updateField("canUploadAttachments", val)}
            />
            <Toggle
              label={t("agentConfig.toggle.canCreateTasks")}
              checked={config.canCreateTasks}
              onChange={(val) => updateField("canCreateTasks", val)}
            />
            <Toggle
              label={t("agentConfig.toggle.canUpdateTaskStatus")}
              checked={config.canUpdateTaskStatus}
              onChange={(val) => updateField("canUpdateTaskStatus", val)}
            />
            <Toggle
              label={t("agentConfig.toggle.canDeleteMessages")}
              checked={config.canDeleteMessages}
              onChange={(val) => updateField("canDeleteMessages", val)}
            />
          </div>
        </Card>

        <Card className="p-4 sm:p-6">
          <SectionHeader title={t("agentConfig.section.content")} className="mb-4" />
          <div className="space-y-4">
            <div className="pb-2 border-b border-gray-200 dark:border-gray-700/50">
              <Toggle
                label={t("agentConfig.toggle.suppressMetaReflections")}
                checked={config.suppressMetaReflections}
                onChange={(val) => updateField("suppressMetaReflections", val)}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("agentConfig.field.maxResponseLength")}
              </label>
              <Input
                type="number"
                min={100}
                step={100}
                value={config.maxResponseLength}
                onChange={(e) =>
                  updateField(
                    "maxResponseLength",
                    Math.max(
                      100,
                      Math.min(10000, parseInt(e.target.value, 10) || 100),
                    ),
                  )
                }
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("agentConfig.field.language")}
              </label>
              <Select
                value={config.language}
                onChange={(val) => updateField("language", val as "de" | "en")}
                options={[
                  { value: "de", label: t("agentConfig.option.languageDe") },
                  { value: "en", label: t("agentConfig.option.languageEn") },
                ]}
              />
            </div>
          </div>
        </Card>

        {connectors.length > 0 && (
          <Card className="p-4 sm:p-6">
            <SectionHeader title={t("agentConfig.section.connectorAccess")} className="mb-4" />
            {permissionsLoading ? (
              <div className="text-sm text-gray-400">{t("agentConfig.loading")}</div>
            ) : (
              <div className="space-y-4">
                {connectors.map((connector) => {
                  const allowed = permissions.get(connector.id) || [];
                  const isEnabled = allowed.length > 0;
                  return (
                    <div
                      key={connector.id}
                      className={`rounded-lg border p-3 ${isDark ? "border-gray-700/50" : "border-gray-200"}`}
                    >
                      <Toggle
                        label={connector.name}
                        checked={isEnabled}
                        onChange={(checked) => {
                          const newPerms = new Map(permissions);
                          if (checked) {
                            newPerms.set(
                              connector.id,
                              connector.actions.map((a) => a.id),
                            );
                          } else {
                            newPerms.delete(connector.id);
                          }
                          setPermissions(newPerms);
                        }}
                      />
                      {isEnabled && (
                        <div className="ml-4 mt-2 space-y-1">
                          {connector.actions.map((action) => (
                            <label
                              key={action.id}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={allowed.includes(action.id)}
                                onChange={(e) => {
                                  const newPerms = new Map(permissions);
                                  const current =
                                    newPerms.get(connector.id) || [];
                                  if (e.target.checked) {
                                    newPerms.set(connector.id, [
                                      ...current,
                                      action.id,
                                    ]);
                                  } else {
                                    const filtered = current.filter(
                                      (a) => a !== action.id,
                                    );
                                    if (filtered.length === 0) {
                                      newPerms.delete(connector.id);
                                    } else {
                                      newPerms.set(connector.id, filtered);
                                    }
                                  }
                                  setPermissions(newPerms);
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span
                                className={isDark ? "text-gray-300" : "text-gray-700"}
                              >
                                {action.name}
                              </span>
                              <span
                                className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                              >
                                ({action.id})
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {feedback && (
          <Card
            tone="muted"
            className={`p-3 text-sm border ${
              feedback.type === "success"
                ? isDark
                  ? "border-emerald-700/60 text-emerald-300"
                  : "border-emerald-200 text-emerald-700"
                : isDark
                  ? "border-red-700/60 text-red-300"
                  : "border-red-200 text-red-700"
            }`}
          >
            {feedback.text}
          </Card>
        )}

        <div className="flex items-center justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={handleReset} disabled={saving}>
            {t("agentConfig.button.reset")}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? t("agentConfig.button.saving") : t("agentConfig.button.save")}
          </Button>
        </div>
      </div>
    </PageShell>
  );
};
