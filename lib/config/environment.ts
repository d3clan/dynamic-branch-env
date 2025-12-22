/**
 * Environment configuration
 * All values can be overridden via CDK context
 */

export interface EnvironmentConfig {
  /**
   * The public domain for preview URLs (e.g., 'dev.example.com')
   * Preview URLs will be: pr-{number}.{domainName}
   */
  domainName: string;

  /**
   * The internal domain for service discovery (e.g., 'internal-dev.example.com')
   * Services will be: {service}.{internalDomainName} or {service}--{virtualEnvId}.{internalDomainName}
   */
  internalDomainName: string;

  /**
   * VPC CIDR block
   */
  vpcCidr: string;

  /**
   * Maximum number of concurrent virtual environments
   * Limited by ALB rule capacity (100 rules max, budget ~80 for previews)
   */
  maxConcurrentEnvironments: number;

  /**
   * Default TTL in hours for virtual environments
   * Environments are cleaned up after this time from last update
   */
  defaultTtlHours: number;

  /**
   * Maximum TTL in hours regardless of activity
   */
  maxTtlHours: number;

  /**
   * Grace period in minutes after PR close before cleanup
   */
  gracePeriodMinutes: number;

  /**
   * AWS region for main infrastructure
   */
  primaryRegion: string;

  /**
   * AWS region for edge resources (CloudFront, WAF)
   * Must be us-east-1 for CloudFront
   */
  edgeRegion: string;
}

/**
 * Default configuration values
 * Override via CDK context: cdk deploy -c domainName=my.domain.com
 */
export const DEFAULT_CONFIG: EnvironmentConfig = {
  domainName: 'dev.example.com',
  internalDomainName: 'internal-dev.example.com',
  vpcCidr: '10.0.0.0/16',
  maxConcurrentEnvironments: 8,
  defaultTtlHours: 24,
  maxTtlHours: 72,
  gracePeriodMinutes: 30,
  primaryRegion: 'eu-west-1',
  edgeRegion: 'us-east-1',
};

/**
 * ALB rule priority allocation ranges
 */
export const ALB_PRIORITY_CONFIG = {
  /** Start of preview environment priority range */
  previewStart: 1,
  /** End of preview environment priority range */
  previewEnd: 100,
  /** Start of steady-state service priority range */
  steadyStateStart: 101,
  /** End of steady-state service priority range */
  steadyStateEnd: 900,
  /** Start of platform/admin priority range */
  platformStart: 901,
  /** End of platform priority range */
  platformEnd: 1000,
};

/**
 * DynamoDB table names
 */
export const TABLE_NAMES = {
  virtualEnvironments: 'virtual-environments',
  routingConfig: 'routing-config',
  albRulePriorities: 'alb-rule-priorities',
};

/**
 * EventBridge configuration
 */
export const EVENTBRIDGE_CONFIG = {
  eventBusName: 'virtual-env-events',
  eventSource: 'virtual-env.platform',
  githubEventSource: 'virtual-env.github',
};

/**
 * Header names
 */
export const HEADERS = {
  virtualEnvId: 'x-virtual-env-id',
  cloudFrontSecret: 'x-cf-secret',
  routedTo: 'x-routed-to',
};
