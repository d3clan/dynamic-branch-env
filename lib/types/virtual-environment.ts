/**
 * Virtual Environment type definitions
 */

export type VirtualEnvironmentStatus =
  | 'CREATING'
  | 'ACTIVE'
  | 'UPDATING'
  | 'DESTROYING'
  | 'DESTROYED'
  | 'FAILED';

export interface ServiceState {
  serviceId: string;
  imageTag: string;
  ecsServiceArn?: string;
  taskDefinitionArn?: string;
  targetGroupArn?: string;
  albRuleArn?: string;
  cloudMapServiceId?: string;
  status: 'PENDING' | 'DEPLOYING' | 'ACTIVE' | 'FAILED' | 'DESTROYING';
  lastError?: string;
}

export interface VirtualEnvironment {
  virtualEnvId: string;
  status: VirtualEnvironmentStatus;
  repository: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  commitSha: string;
  services: Record<string, ServiceState>;
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: number; // Unix timestamp for TTL
}

export interface VirtualEnvironmentAction {
  action: 'CREATE' | 'UPDATE' | 'DESTROY';
  virtualEnvId: string;
  repository: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  commitSha: string;
  services?: string[]; // Service IDs to deploy (if not specified, use all configured)
}

export interface EnvironmentControllerEvent {
  source: string;
  detailType: string;
  detail: VirtualEnvironmentAction;
}
