import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuthStore } from "../stores/authStore";
import { useTheme } from "../contexts/ThemeContext";
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

export const AgentConfigPage: React.FC = () => {
  const { agentTokenId } = useParams<{ agentTokenId: string }>();
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_AGENT_CONFIG);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!agentTokenId || !token) return;

    const loadConfig = async () => {
      try {
        setLoading(true);
        const data = await fetchAgentConfig(agentTokenId, token);
        setAgentName(data.name || agentTokenId || "");
        setConfig(data.config);
        setFeedback(null);
      } catch (error) {
        console.error("Failed to load agent config:", error);
        toast.error("Fehler beim Laden der Konfiguration");
        navigate("/admin");
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [agentTokenId, token, navigate]);

  const handleSave = async () => {
    if (!agentTokenId || !token || !config) return;

    try {
      setSaving(true);
      const data = await updateAgentConfig(agentTokenId, config, token);
      setConfig(data.config);
      setFeedback({ type: "success", text: "Konfiguration gespeichert." });
      toast.success("Konfiguration gespeichert");
    } catch (error) {
      console.error("Failed to save agent config:", error);
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Fehler beim Speichern der Konfiguration",
      });
      toast.error("Fehler beim Speichern der Konfiguration");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_AGENT_CONFIG);
    setFeedback({ type: "success", text: "Auf Standardwerte zurueckgesetzt." });
    toast.success("Auf Standardwerte zurueckgesetzt");
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
        <div className="flex items-center justify-center h-32">Laden...</div>
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
      title={`Agent-Konfiguration: ${agentName}`}
      subtitle="Passe das Verhalten und die Berechtigungen des Agenten an."
    >
      <div className="mb-6">
        <Link
          to="/admin"
          className={`text-sm hover:underline ${isDark ? "text-blue-400" : "text-blue-600"}`}
        >
          &larr; Zurück zur Administration
        </Link>
      </div>

      <div className="space-y-6">
        <Card className="p-4 sm:p-6">
          <SectionHeader title="Kommunikation" className="mb-4" />
          <div className="space-y-4">
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Nachrichtenhäufigkeit
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
                  { value: "low", label: "Niedrig (low)" },
                  { value: "medium", label: "Mittel (medium)" },
                  { value: "high", label: "Hoch (high)" },
                ]}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Proaktivität
              </label>
              <Select
                value={config.proactivity}
                onChange={(val) =>
                  updateField("proactivity", val as AgentConfig["proactivity"])
                }
                options={[
                  { value: "reactive", label: "Reaktiv (reactive)" },
                  { value: "balanced", label: "Ausgewogen (balanced)" },
                  { value: "proactive", label: "Proaktiv (proactive)" },
                ]}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Max. Nachrichten pro Minute
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
          <SectionHeader title="Aktionen" className="mb-4" />
          <div className="space-y-2 divide-y divide-gray-200 dark:divide-gray-700/50">
            <Toggle
              label="Dateien hochladen (canUploadAttachments)"
              checked={config.canUploadAttachments}
              onChange={(val) => updateField("canUploadAttachments", val)}
            />
            <Toggle
              label="Aufgaben erstellen (canCreateTasks)"
              checked={config.canCreateTasks}
              onChange={(val) => updateField("canCreateTasks", val)}
            />
            <Toggle
              label="Aufgabenstatus aktualisieren (canUpdateTaskStatus)"
              checked={config.canUpdateTaskStatus}
              onChange={(val) => updateField("canUpdateTaskStatus", val)}
            />
            <Toggle
              label="Nachrichten löschen (canDeleteMessages)"
              checked={config.canDeleteMessages}
              onChange={(val) => updateField("canDeleteMessages", val)}
            />
          </div>
        </Card>

        <Card className="p-4 sm:p-6">
          <SectionHeader title="Inhalt" className="mb-4" />
          <div className="space-y-4">
            <div className="pb-2 border-b border-gray-200 dark:border-gray-700/50">
              <Toggle
                label="Meta-Reflexionen unterdrücken (suppressMetaReflections)"
                checked={config.suppressMetaReflections}
                onChange={(val) => updateField("suppressMetaReflections", val)}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Max. Antwortlänge (Zeichen)
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
                Sprache
              </label>
              <Select
                value={config.language}
                onChange={(val) => updateField("language", val as "de" | "en")}
                options={[
                  { value: "de", label: "Deutsch (de)" },
                  { value: "en", label: "Englisch (en)" },
                ]}
              />
            </div>
          </div>
        </Card>

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
            Zuruecksetzen
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </div>
      </div>
    </PageShell>
  );
};
