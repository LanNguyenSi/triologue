import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  BellIcon,
  ChatBubbleLeftRightIcon,
  WrenchIcon,
  ClipboardDocumentListIcon,
  CubeTransparentIcon,
  KeyIcon,
  Cog6ToothIcon,
  FolderIcon,
} from "@heroicons/react/24/outline";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { PageShell } from "../components/ui/PageShell";
import { Card } from "../components/ui/primitives";

type DocsTabKey =
  | "inbox"
  | "chat"
  | "admin"
  | "projects"
  | "files"
  | "memory"
  | "secrets"
  | "settings";

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
  const [activeTab, setActiveTab] = useState<DocsTabKey>("inbox");

  const copy = isDe
    ? {
        title: "Beta Docs",
        subtitle: "Was du in der Beta konkret machen und einstellen kannst.",
        audience: "Diese Seite richtet sich an Beta-User (nicht an Entwickler-Dokumentation).",
        devDocsTitle: "Entwickler-Dokumentation",
        devDocsHint: "Für Integrationen und Agenten-Entwicklung:",
        devDocsByoa: "BYOA Docs",
        devDocsPlugins: "Plugin Dev Docs",
        devDocsSwagger: "Swagger API Docs",
        tabs: {
          inbox: "Inbox",
          chat: "Chat",
          admin: "Admin",
          projects: "Projekte",
          files: "Dateien",
          memory: "Agent Memory",
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
        devDocsTitle: "Developer Documentation",
        devDocsHint: "For integrations and agent/plugin development:",
        devDocsByoa: "BYOA Docs",
        devDocsPlugins: "Plugin Dev Docs",
        devDocsSwagger: "Swagger API Docs",
        tabs: {
          inbox: "Inbox",
          chat: "Chat",
          admin: "Admin",
          projects: "Projects",
          files: "Files",
          memory: "Agent Memory",
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

  const tabs: Array<{ key: DocsTabKey; icon: React.ReactNode; label: string }> = [
    { key: "inbox", icon: <BellIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.inbox },
    { key: "chat", icon: <ChatBubbleLeftRightIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.chat },
    { key: "admin", icon: <WrenchIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.admin },
    { key: "projects", icon: <ClipboardDocumentListIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.projects },
    { key: "files", icon: <FolderIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.files },
    { key: "memory", icon: <CubeTransparentIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.memory },
    { key: "secrets", icon: <KeyIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.secrets },
    { key: "settings", icon: <Cog6ToothIcon className="w-4 h-4 inline -mt-0.5" />, label: copy.tabs.settings },
  ];

  const content: Record<DocsTabKey, DocsSection> = isDe
    ? {
        inbox: {
          headline: "Inbox: zentrale Nachrichten",
          intro:
            "Die Inbox bündelt alle wichtigen Team-Ereignisse aus Projekten und Chat in einer zentralen Ansicht.",
          groups: [
            {
              title: "Was in der Inbox landet",
              items: [
                "Mentions aus dem Chat (inkl. Verlinkung zum Raum).",
                "Task-Updates wie Zuweisung, Statuswechsel und Fälligkeit.",
                "Einladungen und wichtige Projekt-Änderungen.",
              ],
            },
            {
              title: "Wie du damit arbeitest",
              items: [
                "Badge zeigt dir sofort ungelesene Einträge.",
                "Einträge direkt öffnen, als gelesen markieren oder entfernen.",
                "Filter auf ungelesen nutzen, um Fokus zu halten.",
              ],
              tone: "accent",
            },
          ],
          links: [{ label: "Zur Inbox", to: "/inbox" }],
        },
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
        files: {
          headline: "Dateien: persönliche Quellen und Datei-Workflows",
          intro:
            "Im Dateien-Modul arbeitest du mit usergebundenen externen Quellen wie SharePoint, ohne in Admin- oder Connector-Technik einzusteigen.",
          groups: [
            {
              title: "Was du machen kannst",
              items: [
                "Gespeicherte Dateiquellen auswählen und durchsuchen.",
                "Ordner öffnen, Dateien hochladen und herunterladen.",
                "SharePoint-Dateien direkt im Ursprungsdienst öffnen.",
              ],
            },
            {
              title: "Wie Verbindungen funktionieren",
              items: [
                "Die eigentliche OAuth-Verbindung verwaltest du in Einstellungen → Connectoren.",
                "Im Dateien-Modul nutzt du darauf aufbauend persönliche Quellen pro User.",
                "Angezeigt werden nur Connectoren, die Triologue freigegeben hat.",
              ],
              tone: "accent",
            },
          ],
          links: [
            { label: "Zu Dateien", to: "/files" },
            { label: "Zu Verbindungen", to: "/settings/connections" },
          ],
        },
        memory: {
          headline: "Agent Memory: geteiltes Wissen für Agents",
          intro:
            "Agent Memory ist die zusätzliche Wissensquelle für laufende Tasks: global oder projektbezogen, inkl. Bearbeitung und Archivierung.",
          groups: [
            {
              title: "Was du machen kannst",
              items: [
                "Memory-Einträge erstellen, bearbeiten, archivieren und wiederherstellen.",
                "Scope wählen: global (Admin) oder projektbezogen.",
                "Mit Titel, Notiz, Tags, Typ und Confidence strukturieren.",
              ],
            },
            {
              title: "Wie Agents Memory nutzen",
              items: [
                "Agents erhalten aktives Memory im Laufzeitkontext.",
                "Projekt-Tasks nutzen projektbezogene Einträge plus globale Leitplanken.",
                "Archivierte/abgelaufene Einträge werden standardmäßig ausgeschlossen.",
              ],
              tone: "accent",
            },
            {
              title: "Arbeiten mit vielen Einträgen",
              items: [
                "Nach Typ, Titel oder Tags suchen.",
                "Über Scope und Projekt filtern.",
                "Pagination nutzen, um große Mengen sauber zu durchlaufen.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Zu Agent Memory", to: "/memory" }],
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
            "In den Einstellungen steuerst du dein persönliches Setup für Profil, Agenten, Plugins und Connectoren.",
          groups: [
            {
              title: "Was du konfigurieren kannst",
              items: [
                "Profil, Sprache, Design und persönliche UI-Voreinstellungen.",
                "Eigene BYOA-Agenten anlegen und verwalten.",
                "Installierte Plugins pro User aktivieren oder deaktivieren.",
                "Persönliche Connectoren verbinden und für Module wie Dateien nutzen.",
              ],
            },
            {
              title: "Empfehlung für Beta",
              items: [
                "Connectoren einmal sauber verbinden und danach stabil lassen.",
                "Plugins nur aktivieren, wenn du sie wirklich im Alltag brauchst.",
              ],
              tone: "muted",
            },
          ],
          links: [
            { label: "Zu Einstellungen", to: "/settings" },
            { label: "Zu Verbindungen", to: "/settings/connections" },
          ],
        },
      }
    : {
        inbox: {
          headline: "Inbox: central messages",
          intro:
            "Inbox centralizes key team events from projects and chat in one place.",
          groups: [
            {
              title: "What appears in Inbox",
              items: [
                "Mentions from chat (including room deep links).",
                "Task updates like assignment, status changes, and due dates.",
                "Invitations and important project updates.",
              ],
            },
            {
              title: "How to use it",
              items: [
                "Navigation badge shows unread items immediately.",
                "Open entries directly, mark as read, or remove them.",
                "Use unread filter to stay focused.",
              ],
              tone: "accent",
            },
          ],
          links: [{ label: "Open inbox", to: "/inbox" }],
        },
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
        files: {
          headline: "Files: personal sources and file workflows",
          intro:
            "Use the files module to work with user-linked external sources such as SharePoint without dealing with admin-only connector mechanics.",
          groups: [
            {
              title: "What you can do",
              items: [
                "Select and browse saved file sources.",
                "Open folders, upload files, and download files.",
                "Open SharePoint items directly in the source system.",
              ],
            },
            {
              title: "How connections work",
              items: [
                "Manage the actual OAuth connection in Settings → Connectors.",
                "The files module then uses personal per-user sources on top of that.",
                "Only connectors enabled by Triologue are shown.",
              ],
              tone: "accent",
            },
          ],
          links: [
            { label: "Open files", to: "/files" },
            { label: "Open connections", to: "/settings/connections" },
          ],
        },
        memory: {
          headline: "Agent Memory: shared context for agents",
          intro:
            "Agent Memory is the additional source of truth for active tasks: global or project-linked entries with edit/archive flow.",
          groups: [
            {
              title: "What you can do",
              items: [
                "Create, edit, archive, and restore memory entries.",
                "Choose scope: global (admin) or project-linked.",
                "Structure entries with title, note, tags, type, and confidence.",
              ],
            },
            {
              title: "How agents use memory",
              items: [
                "Agents receive active memory in runtime context.",
                "Project tasks use project-linked memory plus global guardrails.",
                "Archived/expired entries are excluded by default.",
              ],
              tone: "accent",
            },
            {
              title: "Working with larger datasets",
              items: [
                "Search by type, title, or tags.",
                "Filter by scope and project.",
                "Use pagination to navigate larger memory sets cleanly.",
              ],
              tone: "muted",
            },
          ],
          links: [{ label: "Open agent memory", to: "/memory" }],
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
            "Use settings to manage your personal setup across profile, agents, plugins, and connectors.",
          groups: [
            {
              title: "What you can configure",
              items: [
                "Profile, language, theme, and personal UI preferences.",
                "Create and manage your own BYOA agents.",
                "Enable or disable installed plugins per user.",
                "Connect personal connectors and use them in modules such as Files.",
              ],
            },
            {
              title: "Beta recommendation",
              items: [
                "Connect your required services once and keep them stable.",
                "Enable plugins only when they are useful in your daily workflow.",
              ],
              tone: "muted",
            },
          ],
          links: [
            { label: "Open settings", to: "/settings" },
            { label: "Open connections", to: "/settings/connections" },
          ],
        },
      };

  const section = content[activeTab];

  return (
    <PageShell
      maxWidth="6xl"
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <div className="space-y-4 sm:space-y-5">
        <Card className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold mb-1">{copy.devDocsTitle}</h2>
          <p className={`text-sm mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
            {copy.devDocsHint}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Link
              to="/byoa"
              className={`inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium ${
                isDark
                  ? "bg-blue-700 hover:bg-blue-600 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {copy.devDocsByoa}
            </Link>
            <Link
              to="/plugin-dev"
              className={`inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium ${
                isDark
                  ? "bg-blue-700 hover:bg-blue-600 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {copy.devDocsPlugins}
            </Link>
            <a
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium ${
                isDark
                  ? "bg-blue-700 hover:bg-blue-600 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {copy.devDocsSwagger}
            </a>
          </div>
        </Card>

        <Card tone="accent" className="p-4 sm:p-5">
          <p className={`text-sm ${isDark ? "text-blue-200" : "text-blue-900"}`}>
            {copy.audience}
          </p>
        </Card>

        <Card tone="muted" className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold mb-3">{copy.inProgressTitle}</h2>
          <ul className={`list-disc pl-5 space-y-1 text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>
            {copy.inProgressItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>

        <Card className="p-1.5 sm:p-2">
          <div
            role="tablist"
            aria-label={copy.title}
            className={`flex flex-wrap gap-1 border-b px-1 ${isDark ? "border-gray-700/50" : "border-gray-200/60"}`}
          >
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
                  className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                    active
                      ? isDark
                        ? "border-blue-400 text-blue-300 bg-gray-800"
                        : "border-blue-600 text-blue-700 bg-white"
                      : isDark
                        ? "border-transparent text-gray-300 hover:text-white hover:bg-gray-800/70"
                        : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100"
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
          className="space-y-4 sm:space-y-5"
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
      </div>
    </PageShell>
  );
};
