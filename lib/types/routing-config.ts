/**
 * Routing configuration type definitions
 */

export interface RoutingConfigEntry {
  serviceId: string;
  virtualEnvId: string;
  targetGroupArn: string;
  albRuleArn: string;
  cloudMapServiceId: string;
  cloudMapInstanceId?: string;
  priority: number;
  createdAt: string;
  ttl: number; // Unix timestamp for DynamoDB TTL
}

export interface AlbRulePriority {
  listenerArn: string;
  priority: number;
  virtualEnvId: string;
  serviceId: string;
  allocatedAt: string;
  ttl: number;
}

export interface RoutingDecision {
  virtualEnvId: string | null;
  serviceId: string;
  routedTo: 'preview' | 'steady-state';
  targetGroupArn: string;
}
