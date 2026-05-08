// PMM Process Awareness — Shared Types
// =====================================

export interface Artifact {
  path: string;
  type: string;       // "spec", "plan", "project_doc", "readme", "architecture_doc"
  methodology: string; // which methodology matched this pattern
  extracted_at: string;
}

export interface PMMState {
  registered: boolean;
  project_id: number | null;
  project_name: string | null;
  milestone_count: number;
  feature_count: number;
  task_count: number;
  decision_count: number;
}

export interface ProcessGap {
  type: string;
  description: string;
  auto_fixable: boolean;
  source_artifact: string | null;
}

export interface ProcessScanResult {
  environment: {
    active_methodologies: string[];
    harness: string;
  };
  artifacts: Artifact[];
  pmm_state: PMMState;
  detected_phase: string;
  gaps: ProcessGap[];
  confidence: number;
  generated_at: string;
}

export interface ExtractableProject {
  name: string;
  description: string | null;
  tech_stack: string[];
  phase: string | null;
  priority: string | null;
}

export interface ExtractableDecision {
  question: string;
  decision: string;
  rationale: string | null;
}

export interface ExtractableMilestone {
  name: string;
  due: string | null;
  acceptance_criteria: string | null;
}

export interface ExtractableFeature {
  name: string;
  description: string | null;
  priority: string | null;
  milestone: string | null;
}

export interface ExtractableTask {
  name: string;
  milestone: string | null;
  feature: string | null;
}

export interface BridgeResult {
  artifact_path: string;
  artifact_type: string;
  methodology: string;
  project: ExtractableProject | null;
  milestones: ExtractableMilestone[];
  features: ExtractableFeature[];
  tasks: ExtractableTask[];
  decisions: ExtractableDecision[];
  dependencies: { from: string; to: string; description: string | null }[];
  extraction_confidence: number;
  warnings: string[];
}

export interface RegistrationResult {
  project_id: number;
  project_name: string;
  milestones_registered: number;
  features_registered: number;
  tasks_registered: number;
  decisions_registered: number;
  errors: string[];
}

export interface MethodologyRecord {
  id: number;
  name: string;
  description: string | null;
  detection_signals: {
    skills?: string[];
    directories?: string[];
  };
  artifact_mappings: Record<string, ArtifactMapping>;
  phase_rules: Record<string, string> | null;
  priority: number;
  enabled: number;
}

export interface ArtifactMapping {
  label: string;
  patterns: string[];
  maps_to: string;
  extracts: Record<string, string>;
}
