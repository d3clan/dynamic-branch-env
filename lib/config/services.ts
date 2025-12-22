/**
 * Previewable services configuration
 * Define all services that can be deployed as preview environments
 */

export interface PreviewableService {
  /**
   * Unique identifier for the service (e.g., 'api-gateway')
   */
  serviceId: string;

  /**
   * GitHub repository (e.g., 'org/repo-name')
   * Used to match PR events to services
   */
  repository: string;

  /**
   * ALB path pattern for routing (e.g., '/api/*')
   */
  pathPattern: string;

  /**
   * Container port
   */
  port: number;

  /**
   * Health check path
   */
  healthCheckPath: string;

  /**
   * Fargate CPU units (256, 512, 1024, 2048, 4096)
   */
  cpu: number;

  /**
   * Fargate memory in MB
   */
  memory: number;

  /**
   * ECR repository name (defaults to serviceId if not specified)
   */
  ecrRepositoryName?: string;

  /**
   * Default image tag to use (defaults to 'latest')
   */
  defaultImageTag?: string;

  /**
   * Additional environment variables for the container
   */
  environment?: Record<string, string>;

  /**
   * Secrets to inject (key: secret ARN or SSM parameter path)
   */
  secrets?: Record<string, string>;

  /**
   * Whether this service is enabled for preview environments
   */
  enabled?: boolean;

  /**
   * Health check configuration
   */
  healthCheck?: {
    interval?: number; // seconds
    timeout?: number; // seconds
    healthyThreshold?: number;
    unhealthyThreshold?: number;
  };
}

/**
 * Example previewable services configuration
 * Replace with your actual services
 */
export const PREVIEWABLE_SERVICES: PreviewableService[] = [
  {
    serviceId: 'api-gateway',
    repository: 'org/api-gateway',
    pathPattern: '/api/*',
    port: 3000,
    healthCheckPath: '/health',
    cpu: 256,
    memory: 512,
    environment: {
      NODE_ENV: 'development',
    },
    enabled: true,
  },
  {
    serviceId: 'web-app',
    repository: 'org/web-app',
    pathPattern: '/*',
    port: 3000,
    healthCheckPath: '/health',
    cpu: 256,
    memory: 512,
    environment: {
      NODE_ENV: 'development',
    },
    enabled: true,
  },
  // Add more services as needed
  // {
  //   serviceId: 'orders-service',
  //   repository: 'org/orders-service',
  //   pathPattern: '/orders/*',
  //   port: 3000,
  //   healthCheckPath: '/health',
  //   cpu: 512,
  //   memory: 1024,
  //   enabled: true,
  // },
];

/**
 * Get services for a specific repository
 */
export function getServicesForRepository(repository: string): PreviewableService[] {
  return PREVIEWABLE_SERVICES.filter(
    (service) => service.enabled !== false && service.repository === repository,
  );
}

/**
 * Get a service by ID
 */
export function getServiceById(serviceId: string): PreviewableService | undefined {
  return PREVIEWABLE_SERVICES.find(
    (service) => service.enabled !== false && service.serviceId === serviceId,
  );
}

/**
 * Get all enabled services
 */
export function getAllEnabledServices(): PreviewableService[] {
  return PREVIEWABLE_SERVICES.filter((service) => service.enabled !== false);
}
