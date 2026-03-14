export interface ConnectorActionInput {
  type: string;
  required?: string[];
  properties: Record<
    string,
    {
      type: string;
      required?: boolean;
      description?: string;
      default?: unknown;
    }
  >;
}

export interface ConnectorActionDef {
  id: string;
  name: string;
  description: string;
  method: string;
  urlTemplate: string;
  input?: ConnectorActionInput;
  responseType?: "json" | "binary" | "text";
}

export interface ConnectorAuthDef {
  type: "oauth2";
  provider: string;
  scope: string;
  requiredScopes?: string[];
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  provider: string;
  icon?: string;
  category: string;
  auth: ConnectorAuthDef;
  actions: ConnectorActionDef[];
}

export interface ConnectorResponse {
  success: boolean;
  status: number;
  data: unknown;
  error?: string;
}
