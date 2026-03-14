import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { ConnectorDefinition } from "./types";
import { getToken } from "../services/tokenManager";
import { logger } from "../utils/logger";

const connectors = new Map<string, ConnectorDefinition>();

export function loadDefinitions(dir: string): void {
  if (!fs.existsSync(dir)) {
    logger.warn(`[connectors] Definitions directory not found: ${dir}`);
    return;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      const def = yaml.load(content) as ConnectorDefinition;
      if (def && def.id) {
        connectors.set(def.id, def);
        logger.info(
          `[connectors] Loaded connector: ${def.id} (${def.actions.length} actions)`,
        );
      }
    } catch (err) {
      logger.error(`[connectors] Failed to load ${file}:`, err);
    }
  }
}

export function getConnector(id: string): ConnectorDefinition | null {
  return connectors.get(id) || null;
}

export function listConnectors(): ConnectorDefinition[] {
  return Array.from(connectors.values());
}

export async function listActiveConnectors(): Promise<ConnectorDefinition[]> {
  const active: ConnectorDefinition[] = [];
  for (const def of connectors.values()) {
    const token = await getToken(def.auth.provider, def.auth.scope);
    if (token) active.push(def);
  }
  return active;
}

export function initConnectors(): void {
    // YAML files aren't compiled by tsc, so resolve from src/ not dist/
  const definitionsDir = path.resolve(__dirname, "../../src/connectors/definitions");
  loadDefinitions(definitionsDir);
}
