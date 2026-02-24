import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { PageShell } from "../components/ui/PageShell";
import { Card } from "../components/ui/primitives";

type DocsTabKey = "chat" | "admin" | "projects" | "secrets" | "settings";

interface DocsGroup {
  title: string;
  items: string[];
  tone?: "default" | "muted" | "accent";
}

interface DocsSection {
  headline: string;
  intro: string;
  groups: DocsGroup[];
  links: Array<{ label: string; to: string }>;
}

export const DocsPage: React.FC = () => {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const isDe = language === "de";
  const [activeTab, setActiveTab] = useState<DocsTabKey>("projects");

  const copy = isDe
    ? {
        title: "Beta Docs",
        subtitle: "Was du in der Beta konkret machen und einstellen kannst.",
        audience: "Diese Seite richtet sich an Beta-User (nicht an Entwickler-Dokumentation).",
        tabs: {
          chat: "Chat",
          admin: "Admin",
          projects: "Projekte",
          secrets: "Secrets",
          settings: "Einstellungen",
        },
        quickLinks: "Direkt öffnen",
        inProgressTitle: "Aktuell in Arbeit",
        inProgressItems: [
          "Direkte Secret-Nutzung in Agent-Runtime (z. B. GITHUB_PAT in Jobs).",
          "GitHub Connect und automatisierte PR-Flows.",
          "Weitere Workflow-Automation und Team-Analytics.",
        ],
      }
    : {
        title: "Beta Docs",
        subtitle: "What you can do and configure in beta right now.",
        audience: "This page is for beta users (not developer docs).",
        tabs: {
          chat: "Chat",
          admin: "Admin",
          projects: "Projects",
          secrets: "Secrets",
          settings: "Settings",
        },
        quickLinks: "Open directly",
        inProgressTitle: "Currently in progress",
        inProgressItems: [
          "Direct secret usage in agent runtime (e.g. GITHUB_PAT in jobs).",
          "GitHub connect and automated PR flows.",
          "More workflow automation and team analytics.",
        ],
      };

  const tabs: Array<{ key: DocsTabKey; icon: string; label: string }> = [
    { key: "chat", icon: "💬", label: copy.tabs.chat },
    { key: "admin", icon: "🔧", label: copy.tabs.admin },
    { key: "projects", icon: "📋", label: copy.tabs.projects },
    { key: "secrets", icon: "🔑", label: copy.tabs.secrets },
    { key: "settings", icon: "⚙️", label: copy.tabs.settings },
  ];

  const content: Record<DocsTabKey, DocsSection> = isDe
    ? {
        chat: {
          headline: "Chat: Zusammenarbeit in Räumen",
          intro:
            "Im Chat koordinierst du Menschen und Agents direkt in einem Raum. Nachrichten, Reaktionen und Hinweise sind live.",
          groups: [
            {
              title: "Was du machen kannst",
              items: [
                "Räume öffnen und zwischen Team-Streams wechseln.",
                "User per Username in Räume einladen.",
                "Nachrichten schreiben, Antworten lesen und Reaktionen nutzen.",
                "Ungelesene Hinweise über Badges erkennen.",
              ],
            },
            {
              title: "Wichtige Hinweise",
              items: [
                "Private Räume sind nur für eingeladene Mitglieder sichtbar.",
                "Öffentliche Räume sind teamweit sichtbar.",
                "Onboarding-Raum eignet sich für schnelle Abstimmung in der Beta.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Zum Chat", to: "/room/onboarding" }],
        },
        admin: {
          headline: "Admin: Nutzer und Agents verwalten",
          intro:
            "Im Admin-Bereich steuerst du Nutzerzugänge und Agent-Verfügbarkeit für dein Team.",
          groups: [
            {
              title: "Was du machen kannst",
              items: [
                "Nutzerstatus prüfen und Berechtigungen verwalten.",
                "BYOA Agents ansehen, freischalten oder deaktivieren.",
                "Invite-Code-basierte Zugänge steuern.",
              ],
            },
            {
              title: "Empfohlene Beta-Nutzung",
              items: [
                "Nur benötigte Agents aktiv lassen.",
                "Neue Tester zuerst über Invite-Codes onboarden.",
                "Regelmäßig prüfen, ob Agent-Konfigurationen aktuell sind.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Zum Admin-Bereich", to: "/admin" }],
        },
        projects: {
          headline: "Projekte: Arbeit strukturieren und ausführen",
          intro:
            "Projekte sind der zentrale Arbeitsbereich für Aufgaben, Teamzuordnung, Kontext und projektbezogene Secrets.",
          groups: [
            {
              title: "Aufgaben (Tasks)",
              items: [
                "Tasks anlegen, priorisieren und Personen zuweisen.",
                "Attachments in Tasks verwalten (hinzufügen, ansehen, löschen).",
                "Status im Board pflegen und Fortschritt transparent machen.",
              ],
            },
            {
              title: "Team",
              items: [
                "Mitglieder per Username zum Projekt hinzufügen.",
                "Humans und Agents gemeinsam im Projekt führen.",
                "Projekt-Team und Raum synchron halten.",
              ],
              tone: "muted",
            },
            {
              title: "Secrets im Projekt",
              items: [
                "Projektgebundene Secrets verwalten (create/update/delete).",
                "Namen und Metadaten teamweit sichtbar machen, Wert bleibt verborgen.",
                "Für Runtime-Nutzung durch Agents: folgt im nächsten Ausbau.",
              ],
              tone: "accent",
            },
            {
              title: "Workflow & Kontext",
              items: [
                "Workflow definieren: optionale Spalten aktivieren/deaktivieren.",
                "Status-Anweisungen festlegen (wann wird in welchem Status gearbeitet).",
                "Projektkontext pflegen: Goal, Scope, DoD, Decision Log, Milestones.",
              ],
            },
          ],
          links: [
            { label: "Zu Projekten", to: "/projects" },
            { label: "Zu Secrets", to: "/secrets" },
          ],
        },
        secrets: {
          headline: "Secrets: sichere Verwaltung von Zugangsdaten",
          intro:
            "Secrets erlauben sichere Ablage von API-Keys und Tokens, inklusive Projektbezug und Rotation.",
          groups: [
            {
              title: "Was du machen kannst",
              items: [
                "Secrets anlegen, bearbeiten, rotieren und löschen.",
                "Secrets optional einem Projekt zuordnen.",
                "Nach Name/Projekt filtern und organisieren.",
              ],
            },
            {
              title: "Sicherheitsmodell (Beta)",
              items: [
                "Secret-Werte werden nach dem Speichern nicht mehr angezeigt.",
                "Listen zeigen nur Metadaten wie Name, erstellt am, zuletzt genutzt.",
                "Direkte Nutzung in Agent-Jobs ist als nächster Schritt geplant.",
              ],
              tone: "accent",
            },
          ],
          links: [{ label: "Zur Secrets-Übersicht", to: "/secrets" }],
        },
        settings: {
          headline: "Einstellungen: persönliches Setup",
          intro:
            "In den Einstellungen passt du dein persönliches Nutzungserlebnis an.",
          groups: [
            {
              title: "Was du konfigurieren kannst",
              items: [
                "Profilbezogene Einstellungen und Darstellung.",
                "Sichtbarkeitseinstellungen für deine eigenen Einträge.",
                "Grundlegende Kontooptionen für den täglichen Einsatz.",
              ],
            },
            {
              title: "Empfehlung für Beta",
              items: [
                "Einmalig Einstellungen prüfen und dann stabile Defaults nutzen.",
                "Nur ändern, wenn es den Team-Flow verbessert.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Zu Einstellungen", to: "/settings" }],
        },
      }
    : {
        chat: {
          headline: "Chat: collaborate in rooms",
          intro:
            "Use chat rooms to coordinate humans and agents in real time.",
          groups: [
            {
              title: "What you can do",
              items: [
                "Open rooms and switch between team streams.",
                "Invite users to rooms by username.",
                "Write messages, read replies, and use reactions.",
                "Track unread activity with badges.",
              ],
            },
            {
              title: "Key notes",
              items: [
                "Private rooms are visible to invited members only.",
                "Public rooms are visible to the whole team.",
                "The onboarding room is ideal for quick beta coordination.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Open chat", to: "/room/onboarding" }],
        },
        admin: {
          headline: "Admin: manage users and agents",
          intro:
            "The admin area controls user access and agent availability.",
          groups: [
            {
              title: "What you can do",
              items: [
                "Review users and manage permissions.",
                "Review BYOA agents, approve, or deactivate them.",
                "Control invite-code based onboarding.",
              ],
            },
            {
              title: "Recommended beta usage",
              items: [
                "Keep only required agents active.",
                "Onboard new testers with invite codes first.",
                "Regularly verify active agent configurations.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Open admin", to: "/admin" }],
        },
        projects: {
          headline: "Projects: structure and execute work",
          intro:
            "Projects are the core workspace for tasks, team setup, context, and project-linked secrets.",
          groups: [
            {
              title: "Tasks",
              items: [
                "Create tasks, set priority, and assign owners.",
                "Manage task attachments (add, view, delete).",
                "Update board status to keep progress visible.",
              ],
            },
            {
              title: "Team",
              items: [
                "Add project members by username.",
                "Work with humans and agents in one project team.",
                "Keep project team and room membership aligned.",
              ],
              tone: "muted",
            },
            {
              title: "Project secrets",
              items: [
                "Manage project-scoped secrets (create/update/delete).",
                "Share names and metadata while keeping values hidden.",
                "Agent runtime usage is planned next.",
              ],
              tone: "accent",
            },
            {
              title: "Workflow and context",
              items: [
                "Define workflow: enable/disable optional columns.",
                "Set status instructions for clear task handling.",
                "Maintain context: goal, scope, DoD, decision log, milestones.",
              ],
            },
          ],
          links: [
            { label: "Open projects", to: "/projects" },
            { label: "Open secrets", to: "/secrets" },
          ],
        },
        secrets: {
          headline: "Secrets: secure credential management",
          intro:
            "Secrets provide secure storage for API keys and tokens, including project linking and rotation.",
          groups: [
            {
              title: "What you can do",
              items: [
                "Create, edit, rotate, and delete secrets.",
                "Optionally link secrets to projects.",
                "Filter and organize by name/project.",
              ],
            },
            {
              title: "Security model (beta)",
              items: [
                "Secret values are not shown again after save.",
                "List views expose metadata only.",
                "Direct usage in agent runtime is the next step.",
              ],
              tone: "accent",
            },
          ],
          links: [{ label: "Open secrets", to: "/secrets" }],
        },
        settings: {
          headline: "Settings: personal setup",
          intro:
            "Use settings to tune your personal workspace experience.",
          groups: [
            {
              title: "What you can configure",
              items: [
                "Profile-related preferences and display settings.",
                "Visibility options for your own content.",
                "Basic account options for daily work.",
              ],
            },
            {
              title: "Beta recommendation",
              items: [
                "Set defaults once and keep them stable.",
                "Change only what improves team flow.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Open settings", to: "/settings" }],
        },
      };

  const section = content[activeTab];

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">📚 {copy.title}</span>}
      subtitle={copy.subtitle}
    >
      <Card tone="accent" className="mb-4 p-4 sm:p-5">
        <p className={`text-sm ${isDark ? "text-blue-200" : "text-blue-900"}`}>
          {copy.audience}
        </p>
      </Card>

      <Card className="mb-4 p-2 sm:p-3">
        <div role="tablist" aria-label={copy.title} className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                id={`docs-tab-${tab.key}`}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`docs-panel-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? isDark
                      ? "bg-blue-600 text-white"
                      : "bg-blue-500 text-white"
                    : isDark
                      ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                <span className="mr-1.5">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </Card>

      <section
        id={`docs-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`docs-tab-${activeTab}`}
        className="space-y-4"
      >
        <Card tone="accent" className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold mb-2">{section.headline}</h2>
          <p className={`text-sm ${isDark ? "text-blue-200" : "text-blue-900"}`}>{section.intro}</p>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {section.groups.map((group) => (
            <Card key={group.title} tone={group.tone || "default"} className="p-4 sm:p-5">
              <h3 className="text-base font-semibold mb-2">{group.title}</h3>
              <ul className={`list-disc pl-5 space-y-1 text-sm ${isDark ? "text-gray-200" : "text-gray-700"}`}>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <Card tone="muted" className="p-4 sm:p-5">
          <h3 className="text-base font-semibold mb-2">{copy.quickLinks}</h3>
          <div className="flex flex-wrap gap-2">
            {section.links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`inline-flex items-center rounded px-3 py-1.5 text-sm font-medium ${
                  isDark
                    ? "bg-gray-700 hover:bg-gray-600 text-gray-100"
                    : "bg-gray-200 hover:bg-gray-300 text-gray-800"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <Card tone="muted" className="mt-4 p-4 sm:p-5">
        <h2 className="text-lg font-semibold mb-3">{copy.inProgressTitle}</h2>
        <ul className={`list-disc pl-5 space-y-1 text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>
          {copy.inProgressItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>
    </PageShell>
  );
};
