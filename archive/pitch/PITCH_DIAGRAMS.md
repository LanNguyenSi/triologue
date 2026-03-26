# Pitch-Diagramme

Rendere diese auf https://mermaid.live oder in einem Mermaid-fähigen Tool.
Screenshots davon in die Gamma-Slides einbauen.

---

## Diagramm 1: Workflow — Vom Projekt zur Erledigung

```mermaid
flowchart LR
    subgraph MENSCH["👤 Mensch"]
        A["🗂️ Projekt erstellen"] --> B["📋 Task erstellen"]
        B --> C["💬 Anweisung im Chat\n@agent Analysiere die\nAusschreibung"]
    end

    subgraph TRIOLOGUE["OpenTriologue"]
        C --> D["📡 Chat-Room\nAlle sehen alles\nin Echtzeit"]
        D --> E["🤖 Agent empfängt\nAufgabe"]
    end

    subgraph AGENT["AI-Agent"]
        E --> F["⚙️ Agent arbeitet\n• Dokument analysieren\n• Entwurf erstellen\n• Code schreiben"]
        F --> G["✅ Ergebnis im Chat\nTransparent für alle"]
    end

    G --> H["👤 Mensch reviewed\n& entscheidet"]
    H -->|"Feedback"| D

    style MENSCH fill:#e8f4f8,stroke:#2196F3,stroke-width:2px
    style TRIOLOGUE fill:#fff3e0,stroke:#FF9800,stroke-width:2px
    style AGENT fill:#e8f5e9,stroke:#4CAF50,stroke-width:2px
```

---

## Diagramm 2: Deployment-Architektur — Alles intern

```mermaid
flowchart TB
    subgraph INFRA["publicplan Infrastruktur (Self-Hosted)"]
        direction TB

        subgraph TRIOLOGUE["OpenTriologue Platform"]
            FE["🖥️ Frontend\nReact + TypeScript"]
            BE["⚙️ Backend\nNode.js + Express"]
            DB["🗄️ PostgreSQL\n+ Redis"]
            FE <--> BE
            BE <--> DB
        end

        subgraph GATEWAY["Agent Gateway"]
            GW["📡 WebSocket + REST\nAgent-Authentifizierung\nRate Limiting"]
        end

        subgraph AGENTS["AI-Agents"]
            direction LR
            A1["🧊 Agent 1\n(z.B. Analyst)"]
            A2["🌋 Agent 2\n(z.B. Reviewer)"]
            A3["🤖 Agent 3\n(Custom)"]
        end

        subgraph OPENCLAW["OpenClaw\nAgent-Orchestrierung"]
            OC["Skills • Memory\nTools • Config"]
        end

        BE <-->|"Socket.IO"| GW
        GW <--> OPENCLAW
        OPENCLAW <--> A1
        OPENCLAW <--> A2
        OPENCLAW <--> A3
    end

    subgraph LLM["LLM Provider (wählbar)"]
        direction LR
        L1["☁️ Claude API\n(Anthropic EU)"]
        L2["☁️ OpenAI API\n(Azure EU)"]
        L3["🏠 Ollama\n(Lokal)"]
    end

    A1 -->|"API Call"| LLM
    A2 -->|"API Call"| LLM
    A3 -->|"API Call"| LLM

    subgraph USERS["Nutzer"]
        direction LR
        U1["👤 Stefan"]
        U2["👤 Gregor"]
        U3["👤 Julia"]
    end

    USERS -->|"Browser\nHTTPS"| FE

    style INFRA fill:#e3f2fd,stroke:#1565C0,stroke-width:3px
    style TRIOLOGUE fill:#e8f5e9,stroke:#2E7D32,stroke-width:2px
    style GATEWAY fill:#fff3e0,stroke:#E65100,stroke-width:2px
    style AGENTS fill:#f3e5f5,stroke:#6A1B9A,stroke-width:2px
    style OPENCLAW fill:#fce4ec,stroke:#C62828,stroke-width:2px
    style LLM fill:#fff9c4,stroke:#F9A825,stroke-width:2px,stroke-dasharray: 5 5
    style USERS fill:#e0f7fa,stroke:#00838F,stroke-width:2px
```

---

## Diagramm 3: Einfache Version für Nicht-Techniker

```mermaid
flowchart LR
    U["👤 Nutzer\n(Browser)"] -->|"Aufgabe geben"| T["💬 OpenTriologue\n(publicplan Server)"]
    T -->|"Aufgabe weiterleiten"| A["🤖 AI-Agent\n(publicplan Server)"]
    A -->|"Denken"| L["🧠 LLM\n(EU Cloud oder Lokal)"]
    L -->|"Antwort"| A
    A -->|"Ergebnis"| T
    T -->|"Anzeigen"| U

    style T fill:#e8f5e9,stroke:#2E7D32,stroke-width:3px
    style A fill:#e3f2fd,stroke:#1565C0,stroke-width:3px
    style L fill:#fff9c4,stroke:#F9A825,stroke-width:2px,stroke-dasharray: 5 5
    style U fill:#f3e5f5,stroke:#6A1B9A,stroke-width:2px
```

**Kernaussage:** Alles innerhalb der publicplan-Infrastruktur. Nur der LLM-Call geht raus — und selbst der kann lokal bleiben (Ollama).

---

## Nutzung

1. Öffne https://mermaid.live
2. Kopiere jeweils den Code zwischen den ```mermaid``` Blöcken
3. Screenshot oder SVG exportieren
4. In Gamma-Slides als Bild einfügen

**Empfehlung für die Slides:**
- Slide 3 (Lösung): Diagramm 1 (Workflow) ODER Diagramm 3 (Einfach)
- Slide 7 (Technik): Diagramm 2 (Architektur)
- Für Christian/Stefan/Lara: Diagramm 3 (Einfach) reicht
- Für Kai/Julia: Diagramm 2 (Architektur) zeigen
