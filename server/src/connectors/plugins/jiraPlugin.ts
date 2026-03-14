import { getToken } from "../../services/tokenManager";
import { logger } from "../../utils/logger";

const JIRA_API_BASE = "https://api.atlassian.com/ex/jira";

async function getJiraToken(): Promise<string> {
  const token = await getToken("atlassian", "jira");
  if (!token) throw new Error("Jira token not available. Connect Jira first.");
  return token;
}

export interface JiraIssueInput {
  cloudId: string;
  projectKey: string;
  summary: string;
  description?: string;
  issueType?: string;
  priority?: string;
  labels?: string[];
  assignee?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  status: string;
  issueType: string;
  priority: string;
  assignee: string | null;
  created: string;
  updated: string;
  url: string;
}

const STATUS_MAP: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
};

export function mapTrilogueStatusToJira(status: string): string {
  return STATUS_MAP[status] || status;
}

export function mapJiraStatusToTrilogue(status: string): string {
  const lower = status.toLowerCase().replace(/\s+/g, "_");
  const reverseMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    reverseMap[v.toLowerCase().replace(/\s+/g, "_")] = k;
  }
  return reverseMap[lower] || "todo";
}

export async function createIssue(input: JiraIssueInput): Promise<JiraIssue> {
  const token = await getJiraToken();
  const url = `${JIRA_API_BASE}/${input.cloudId}/rest/api/3/issue`;

  const body: any = {
    fields: {
      project: { key: input.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType || "Task" },
    },
  };

  if (input.description) {
    body.fields.description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: input.description }],
        },
      ],
    };
  }
  if (input.priority) body.fields.priority = { name: input.priority };
  if (input.labels) body.fields.labels = input.labels;
  if (input.assignee) body.fields.assignee = { accountId: input.assignee };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jira create issue failed (${res.status}): ${err}`);
  }

  const created = (await res.json()) as any;
  return fetchIssue(input.cloudId, created.key);
}

export async function fetchIssue(
  cloudId: string,
  issueKey: string,
): Promise<JiraIssue> {
  const token = await getJiraToken();
  const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/issue/${issueKey}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Jira fetch issue failed (${res.status})`);

  const data = (await res.json()) as any;
  return {
    id: data.id,
    key: data.key,
    summary: data.fields.summary,
    status: data.fields.status?.name || "Unknown",
    issueType: data.fields.issuetype?.name || "Task",
    priority: data.fields.priority?.name || "Medium",
    assignee: data.fields.assignee?.accountId || null,
    created: data.fields.created,
    updated: data.fields.updated,
    url: `https://${cloudId}.atlassian.net/browse/${data.key}`,
  };
}

export async function transitionIssue(
  cloudId: string,
  issueKey: string,
  targetStatus: string,
): Promise<void> {
  const token = await getJiraToken();
  const transitionsUrl = `${JIRA_API_BASE}/${cloudId}/rest/api/3/issue/${issueKey}/transitions`;

  const transRes = await fetch(transitionsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!transRes.ok)
    throw new Error(`Failed to get transitions for ${issueKey}`);

  const transitions = (await transRes.json()) as any;
  const target = transitions.transitions?.find(
    (t: any) => t.name.toLowerCase() === targetStatus.toLowerCase(),
  );

  if (!target) {
    logger.warn(
      `[jira] No transition found for status "${targetStatus}" on ${issueKey}`,
    );
    return;
  }

  const res = await fetch(transitionsUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transition: { id: target.id } }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jira transition failed (${res.status}): ${err}`);
  }
}
