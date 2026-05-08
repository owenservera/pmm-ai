// PMM Process Awareness — Public API
export { processScan } from "./scan";
export { bridgeArtifact, bridgeToPMM } from "./bridge";
export type {
  ProcessScanResult, Artifact, PMMState, ProcessGap,
  BridgeResult, ExtractableProject, ExtractableMilestone,
  ExtractableFeature, ExtractableTask, ExtractableDecision,
  RegistrationResult, MethodologyRecord, ArtifactMapping,
} from "./types";
