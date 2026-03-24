import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useTheme } from "../contexts/ThemeContext";
import { PageShell } from "../components/ui/PageShell";
import { Card, Badge, Button, SectionHeader, Select } from "../components/ui/primitives";
import { ConnectorInfo, ConnectorAction, fetchConnectors } from "../services/connectorApi";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

interface TestResult {
  success: boolean;
  status: number;
  data: unknown;
  durationMs: number;
  error?: string;
}

export const ConnectorTestPage: React.FC = () => {
  const { connectorId } = useParams<{ connectorId: string }>();
  const { token } = useAuthStore();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [connector, setConnector] = useState<ConnectorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const loadConnector = useCallback(async () => {
    if (!token || !connectorId) return;
    try {
      setLoading(true);
      const connectors = await fetchConnectors(token);
      const found = connectors.find((c) => c.id === connectorId);
      setConnector(found || null);
      if (found && found.actions.length > 0) {
        setSelectedAction(found.actions[0].id);
      }
    } catch (err) {
      console.error("Failed to load connector:", err);
    } finally {
      setLoading(false);
    }
  }, [token, connectorId]);

  useEffect(() => {
    void loadConnector();
  }, [loadConnector]);

  const currentAction = connector?.actions.find((a) => a.id === selectedAction);

  const handleExecute = async () => {
    if (!token || !connectorId || !selectedAction) return;
    try {
      setExecuting(true);
      setResult(null);
      const res = await fetch(`${API_BASE}/admin/connectors/${connectorId}/test/${selectedAction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(inputs),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ success: false, status: 0, data: null, durationMs: 0, error: String(err) });
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <PageShell maxWidth="4xl">
        <div className="flex items-center justify-center h-32">Laden...</div>
      </PageShell>
    );
  }

  if (!connector) {
    return (
      <PageShell maxWidth="4xl" title="Connector nicht gefunden">
        <Link to="/admin/connectors" className={`text-sm hover:underline ${isDark ? "text-blue-400" : "text-blue-600"}`}>
          &larr; Zurück zur Connector-Verwaltung
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="4xl" title={`Test: ${connector.name}`} subtitle="Connector-Actions direkt testen">
      <div className="space-y-4">
        <Link to="/admin/connectors" className={`text-sm hover:underline ${isDark ? "text-blue-400" : "text-blue-600"}`}>
          &larr; Zurück zur Connector-Verwaltung
        </Link>

        <Card className="p-4 space-y-4">
          <SectionHeader title="Action auswählen" />
          <Select
            value={selectedAction}
            onChange={(val) => {
              setSelectedAction(val);
              setInputs({});
              setResult(null);
            }}
            options={connector.actions.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` }))}
          />

          {currentAction && (
            <>
              <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>{currentAction.description}</p>

              <SectionHeader title="Parameter" />
              <div className="space-y-3">{renderInputFields(currentAction, inputs, setInputs, isDark)}</div>

              <Button onClick={handleExecute} disabled={executing}>
                {executing ? "Ausführen..." : "Ausführen"}
              </Button>
            </>
          )}
        </Card>

        {result && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Badge variant={result.success ? "success" : "danger"}>{result.status || "Fehler"}</Badge>
              <span className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>{result.durationMs}ms</span>
            </div>
            {result.error && (
              <div className={`text-sm p-2 rounded ${isDark ? "bg-red-900/20 text-red-300" : "bg-red-50 text-red-700"}`}>
                {result.error}
              </div>
            )}
            <pre className={`text-xs p-3 rounded overflow-auto max-h-96 ${isDark ? "bg-gray-900 text-gray-300" : "bg-gray-50 text-gray-800"}`}>
              {typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2)}
            </pre>
          </Card>
        )}
      </div>
    </PageShell>
  );
};

function renderInputFields(
  action: ConnectorAction,
  inputs: Record<string, string>,
  setInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  isDark: boolean,
): React.ReactNode {
  const paramSets: Record<string, { name: string; placeholder: string; required?: boolean }[]> = {
    "sharepoint.list": [
      { name: "driveId", placeholder: "SharePoint Drive ID", required: true },
      { name: "path", placeholder: "/ (Ordner-Pfad)" },
    ],
    "sharepoint.read": [
      { name: "driveId", placeholder: "SharePoint Drive ID", required: true },
      { name: "path", placeholder: "Dateipfad", required: true },
    ],
    "sharepoint.upload": [
      { name: "driveId", placeholder: "SharePoint Drive ID", required: true },
      { name: "path", placeholder: "Dateipfad", required: true },
      { name: "content", placeholder: "Dateiinhalt", required: true },
    ],
    "jira.listIssues": [
      { name: "cloudId", placeholder: "Jira Cloud ID", required: true },
      { name: "jql", placeholder: "JQL Query (optional)" },
    ],
    "jira.getIssue": [
      { name: "cloudId", placeholder: "Jira Cloud ID", required: true },
      { name: "issueKey", placeholder: "Issue Key (z.B. PROJ-123)", required: true },
    ],
    "jira.createIssue": [
      { name: "cloudId", placeholder: "Jira Cloud ID", required: true },
      { name: "projectKey", placeholder: "Projekt-Key", required: true },
      { name: "summary", placeholder: "Zusammenfassung", required: true },
      { name: "description", placeholder: "Beschreibung" },
    ],
    "jira.updateIssue": [
      { name: "cloudId", placeholder: "Jira Cloud ID", required: true },
      { name: "issueKey", placeholder: "Issue Key", required: true },
      { name: "summary", placeholder: "Zusammenfassung" },
      { name: "status", placeholder: "Status" },
    ],
  };

  const params = paramSets[action.id] || [{ name: "input", placeholder: "JSON Input" }];

  return params.map((param) => (
    <div key={param.name}>
      <label className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
        {param.name}
        {param.required ? " *" : ""}
      </label>
      <input
        type="text"
        value={inputs[param.name] || ""}
        onChange={(e) => setInputs((prev) => ({ ...prev, [param.name]: e.target.value }))}
        placeholder={param.placeholder}
        className={`w-full px-3 py-1.5 rounded-lg border text-sm ${
          isDark
            ? "bg-gray-800 border-gray-700 text-white placeholder-gray-500"
            : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
        } focus:outline-none focus:ring-2 focus:ring-blue-500`}
      />
    </div>
  ));
}
