/**
 * Single source of truth for Express Request augmentation.
 *
 * Being a .d.ts file it is excluded from ESLint (see .eslintrc.json
 * ignorePatterns: ["**\/*.d.ts"]) while remaining visible to the TypeScript
 * compiler (matched by tsconfig "include": ["src/**\/*"]).
 *
 * Both previous augmentations (auth.ts `user` and byoaAuth.ts `agentToken`)
 * are consolidated here to avoid duplicate namespace declarations.
 */
import type { ByoaAgentTokenPayload } from "../middleware/byoaAuth";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        userType: string;
        displayName: string;
        isAdmin?: boolean;
        canTriggerAI?: boolean;
      };
      agentToken?: ByoaAgentTokenPayload;
    }
  }
}

export {};
