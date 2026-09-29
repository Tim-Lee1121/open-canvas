export type DesignSystemSourceKind = "skill" | "path" | "git" | "url";
export type DesignSystemStatus = "ready" | "needs-review" | "blocked";

export interface DesignSystemRef {
  id: string;
  name: string;
  version: string;
  source: {
    kind: DesignSystemSourceKind;
    entrypoint: string;
    digest: string;
  };
  theme: string;
  status: DesignSystemStatus;
}

export interface DesignSystemBinding {
  primary: DesignSystemRef;
  references?: DesignSystemRef[];
  patterns?: string[];
  components?: string[];
  tokens?: string[];
  pageIntent?: string;
  qaProfile?: string;
}

export interface DesignSystemTokenSummary {
  id: string;
  label: string;
  category: "foundation" | "theme" | "semantic";
  value?: string;
  source: string;
}

export interface DesignSystemComponentSummary {
  slug: string;
  name: string;
  category: string;
  readiness: "A" | "B" | "C" | "D";
  executionContract: "Complete" | "Needs hardening";
  source: string;
}

export interface DesignSystemPatternSummary {
  slug: string;
  name: string;
  source: string;
}

export interface DesignSystemReadiness {
  total: number;
  levelA: number;
  levelB: number;
  levelC: number;
  levelD: number;
  executionComplete: number;
}

export interface DesignSystemManifest extends DesignSystemRef {
  knowledgeRoot: string;
  themes: string[];
  tokens: DesignSystemTokenSummary[];
  components: DesignSystemComponentSummary[];
  patterns: DesignSystemPatternSummary[];
  hardStops: string[];
  qaChecks: string[];
  readiness: DesignSystemReadiness;
  provenance: string[];
  updatedAt: string;
}

export interface DesignContextBundle {
  system: DesignSystemRef;
  theme: string;
  pageIntent?: string;
  patterns: DesignSystemPatternSummary[];
  components: DesignSystemComponentSummary[];
  tokens: DesignSystemTokenSummary[];
  hardStops: string[];
  readiness: DesignSystemReadiness;
  provenance: string[];
  qaChecks: string[];
}

export interface DesignValidationIssue {
  severity: "pass" | "warning" | "block";
  code: string;
  message: string;
  source?: string;
}

export interface DesignValidationResult {
  status: "passed" | "passed-with-warning" | "blocked" | "unbound";
  system?: DesignSystemRef;
  theme?: string;
  issues: DesignValidationIssue[];
}

export type WorkspaceView = "canvas" | "design-system";
