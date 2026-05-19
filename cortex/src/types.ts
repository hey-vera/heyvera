export interface ProviderInfo {
  score: number;
  cooldownUntil?: number;
  lastError?: string;
  degraded?: boolean;
  dispatchCount: number;
}

export interface ProvidersState {
  timestamp: string;
  providers: Record<string, ProviderInfo>;
}

export interface RoutingCell {
  ema: number;
  observations: number;
}

export interface TopPerformer {
  cell: string;
  model: string;
  ema: number;
  observations: number;
}

export interface RoutingState {
  timestamp: string;
  totalObservations: number;
  cells: Record<string, Record<string, RoutingCell>>;
  topPerformers: TopPerformer[];
  worstPerformers: TopPerformer[];
}

export interface Room {
  id: string;
  project: string;
  status: 'active' | 'closed';
  createdAt: string;
  workerCount: number;
}

export interface RoomsState {
  timestamp: string;
  rooms: Room[];
}

export interface Decision {
  timestamp: string;
  promptSummary: string;
  provider: string;
  model: string;
  tier: string;
  reason: string;
  explored: boolean;
}

export interface Outcome {
  timestamp: string;
  roomId: string;
  success: boolean;
  score: number;
  durationMs: number;
  provider: string;
  model: string;
}

export interface CostsState {
  timestamp: string;
  session: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  byProvider: Record<
    string,
    {
      tokens: number;
      estimatedCostUsd: number;
    }
  >;
}

export interface CortexState {
  providers: ProvidersState | null;
  routing: RoutingState | null;
  rooms: RoomsState | null;
  decisions: Decision[];
  outcomes: Outcome[];
  costs: CostsState | null;
  lastUpdated: string | null;
}

export type ChatRole = 'user' | 'assistant';
export type ApprovalState = 'pending' | 'reviewed' | 'approved' | 'rejected';
export type EnvironmentState = 'connected' | 'degraded' | 'offline';

export interface ChatProject {
  id: string;
  name: string;
  environment: string;
  connectionStatus: string;
  environmentState: EnvironmentState;
}

export interface ProviderStatus {
  id: string;
  label: string;
  status: 'active' | 'standby';
}

export interface AgentStatus {
  name: string;
  detail: string;
}

export interface ApprovalRequest {
  messageId: string;
  title: string;
  summary: string;
  commitMessage: string;
  diffSummary: string;
  filesChanged: number;
  state: ApprovalState;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  provider?: string;
  model?: string;
  providerLabel?: string;
  statusLabel?: string;
  isStreaming?: boolean;
  approvalRequest?: ApprovalRequest;
}

export type SessionSpeed = 'steady' | 'balanced' | 'rapid';
export type SessionIntelligence = 'focused' | 'balanced' | 'deep';
export type SessionAutonomy =
  | 'manual'
  | 'guided'
  | 'smart_auto'
  | 'full_auto'
  | 'custom';

export interface ChatSessionControls {
  speed: SessionSpeed;
  intelligence: SessionIntelligence;
  autonomy: SessionAutonomy;
}

export type WorkEventState = 'active' | 'done' | 'waiting' | 'failed';

export interface WorkEventItem {
  id: string;
  taskId?: string;
  title: string;
  detail: string;
  timestamp: string;
  state: WorkEventState;
  provider?: string;
  model?: string;
}
