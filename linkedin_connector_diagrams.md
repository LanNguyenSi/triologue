# LinkedIn Connector Post — Diagrams

## Diagram 1: MCP Approach (The Problem)

```mermaid
graph LR
    subgraph "MCP Approach"
        A[🤖 AI Agent] -->|"tools/list"| M[MCP Server 1<br/>SharePoint]
        A -->|"tools/list"| N[MCP Server 2<br/>Jira]
        A -->|"tools/list"| O[MCP Server 3<br/>Slack]
        A -->|"tools/call"| M
        A -->|"tools/call"| N
        A -->|"tools/call"| O
        M -->|"Direct API"| SP[SharePoint API]
        N -->|"Direct API"| JI[Jira API]
        O -->|"Direct API"| SL[Slack API]
    end

    style A fill:#ff6b6b,stroke:#c0392b,color:#fff
    style M fill:#ffd93d,stroke:#f39c12,color:#333
    style N fill:#ffd93d,stroke:#f39c12,color:#333
    style O fill:#ffd93d,stroke:#f39c12,color:#333
    style SP fill:#ddd,stroke:#999,color:#333
    style JI fill:#ddd,stroke:#999,color:#333
    style SL fill:#ddd,stroke:#999,color:#333
```

**Problems:**
- ❌ Agent sees all tools, all the time
- ❌ Each MCP server manages its own auth
- ❌ No central audit trail
- ❌ No permission boundaries
- ❌ N servers to maintain

---

## Diagram 2: Task Runtime Context (Our Approach)

```mermaid
graph TB
    subgraph "Task Assignment"
        T[📋 Task] -->|"assigned to"| CTX[Task Runtime Context]
        CTX -->|contains| DOC[📄 Documents<br/>parsed]
        CTX -->|contains| MEM[🧠 Memories<br/>project context]
        CTX -->|contains| ACT[⚡ Actions<br/>permitted only]
    end

    subgraph "Action Execution"
        AG[🤖 Agent] -->|"POST /actions/sharepoint.list"| PX[🔒 Proxy Layer]
        PX -->|"+ OAuth Token"| API[SharePoint API]
        PX -->|"log"| AUD[📊 Audit Trail]
    end

    ACT -->|"surfaces"| AG

    style T fill:#4ecdc4,stroke:#1a535c,color:#fff
    style CTX fill:#45b7d1,stroke:#2980b9,color:#fff
    style AG fill:#4ecdc4,stroke:#1a535c,color:#fff
    style PX fill:#2ecc71,stroke:#27ae60,color:#fff
    style AUD fill:#9b59b6,stroke:#8e44ad,color:#fff
    style DOC fill:#f8f9fa,stroke:#dee2e6,color:#333
    style MEM fill:#f8f9fa,stroke:#dee2e6,color:#333
    style ACT fill:#f8f9fa,stroke:#dee2e6,color:#333
    style API fill:#ddd,stroke:#999,color:#333
```

**Benefits:**
- ✅ Agent sees only permitted actions for this task
- ✅ Central token management (AES-256-GCM)
- ✅ Every call audited (who, what, when, duration)
- ✅ Permission boundaries per agent
- ✅ 15 lines YAML per connector

---

## Diagram 3: Connector Definition (The Simplicity)

```mermaid
graph LR
    subgraph "Definition: 15 Lines YAML"
        Y[📄 sharepoint.yaml] -->|"defines"| ID[id: sharepoint<br/>provider: microsoft]
        Y -->|"defines"| AU[auth: oauth2<br/>scope: graph]
        Y -->|"defines"| A1[action: list<br/>GET /drives/.../children]
        Y -->|"defines"| A2[action: read<br/>GET .../content]
        Y -->|"defines"| A3[action: upload<br/>PUT .../content]
    end

    subgraph "Runtime"
        A1 --> PX[Proxy]
        PX -->|"1. Resolve token"| TM[Token Manager]
        PX -->|"2. Inject Bearer"| EX[External API]
        PX -->|"3. Log action"| AL[Audit Log]
    end

    style Y fill:#f1c40f,stroke:#f39c12,color:#333
    style PX fill:#2ecc71,stroke:#27ae60,color:#fff
    style TM fill:#3498db,stroke:#2980b9,color:#fff
    style AL fill:#9b59b6,stroke:#8e44ad,color:#fff
    style EX fill:#ddd,stroke:#999,color:#333
    style ID fill:#fff3cd,stroke:#ffc107,color:#333
    style AU fill:#fff3cd,stroke:#ffc107,color:#333
    style A1 fill:#fff3cd,stroke:#ffc107,color:#333
    style A2 fill:#fff3cd,stroke:#ffc107,color:#333
    style A3 fill:#fff3cd,stroke:#ffc107,color:#333
```
