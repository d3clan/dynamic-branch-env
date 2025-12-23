/**
 * Mock data for local development testing
 */

export const mockEnvironments = [
  {
    virtualEnvId: 'pr-123-feature-auth',
    status: 'ACTIVE',
    repository: 'acme/web-app',
    branch: 'feature/auth-improvements',
    prNumber: 123,
    services: [
      {
        name: 'frontend',
        imageUri: '123456789.dkr.ecr.eu-west-1.amazonaws.com/web-app:pr-123',
        pathPattern: '/*',
        port: 3000,
        cpu: 256,
        memory: 512,
        healthCheckPath: '/health',
        status: 'RUNNING',
        taskArn: 'arn:aws:ecs:eu-west-1:123456789:task/cluster/abc123',
      },
      {
        name: 'api',
        imageUri: '123456789.dkr.ecr.eu-west-1.amazonaws.com/api:pr-123',
        pathPattern: '/api/*',
        port: 8080,
        cpu: 512,
        memory: 1024,
        healthCheckPath: '/api/health',
        status: 'RUNNING',
        taskArn: 'arn:aws:ecs:eu-west-1:123456789:task/cluster/def456',
      },
    ],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ttlTimestamp: Math.floor(Date.now() / 1000) + 48 * 60 * 60, // 48 hours from now
    previewUrl: 'https://pr-123-feature-auth.preview.example.com',
  },
  {
    virtualEnvId: 'pr-456-bugfix-login',
    status: 'ACTIVE',
    repository: 'acme/web-app',
    branch: 'bugfix/login-redirect',
    prNumber: 456,
    services: [
      {
        name: 'frontend',
        imageUri: '123456789.dkr.ecr.eu-west-1.amazonaws.com/web-app:pr-456',
        pathPattern: '/*',
        port: 3000,
        cpu: 256,
        memory: 512,
        healthCheckPath: '/health',
        status: 'RUNNING',
      },
    ],
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    ttlTimestamp: Math.floor(Date.now() / 1000) + 2 * 60 * 60, // 2 hours from now (expiring soon)
    previewUrl: 'https://pr-456-bugfix-login.preview.example.com',
  },
  {
    virtualEnvId: 'pr-789-refactor-db',
    status: 'PROVISIONING',
    repository: 'acme/backend-api',
    branch: 'refactor/database-layer',
    prNumber: 789,
    services: [
      {
        name: 'api',
        imageUri: '123456789.dkr.ecr.eu-west-1.amazonaws.com/backend:pr-789',
        pathPattern: '/api/*',
        port: 8080,
        cpu: 512,
        memory: 1024,
        healthCheckPath: '/api/health',
        status: 'PENDING',
      },
    ],
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ttlTimestamp: Math.floor(Date.now() / 1000) + 72 * 60 * 60,
  },
  {
    virtualEnvId: 'pr-101-failed-deploy',
    status: 'FAILED',
    repository: 'acme/web-app',
    branch: 'feature/broken-config',
    prNumber: 101,
    services: [
      {
        name: 'frontend',
        imageUri: '123456789.dkr.ecr.eu-west-1.amazonaws.com/web-app:pr-101',
        pathPattern: '/*',
        port: 3000,
        status: 'STOPPED',
      },
    ],
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    errorMessage: 'Health check failed: Service did not respond within timeout',
  },
];

export const mockRoutingConfigs = [
  {
    virtualEnvId: 'pr-123-feature-auth',
    serviceName: 'frontend',
    pathPattern: '/*',
    priority: 100,
    albRuleArn: 'arn:aws:elasticloadbalancing:eu-west-1:123456789:listener-rule/app/alb/abc/123/rule1',
  },
  {
    virtualEnvId: 'pr-123-feature-auth',
    serviceName: 'api',
    pathPattern: '/api/*',
    priority: 99,
    albRuleArn: 'arn:aws:elasticloadbalancing:eu-west-1:123456789:listener-rule/app/alb/abc/123/rule2',
  },
  {
    virtualEnvId: 'pr-456-bugfix-login',
    serviceName: 'frontend',
    pathPattern: '/*',
    priority: 98,
    albRuleArn: 'arn:aws:elasticloadbalancing:eu-west-1:123456789:listener-rule/app/alb/abc/123/rule3',
  },
];

export const mockCapacity = {
  albRules: {
    used: 45,
    limit: 100,
    percentage: 45,
  },
  environments: {
    active: 2,
    provisioning: 1,
    failed: 1,
    total: 4,
  },
  services: {
    running: 4,
    pending: 1,
    stopped: 1,
  },
};

export const mockCloudFrontFunction = {
  name: 'virtual-env-header-injection',
  status: 'DEPLOYED',
  stage: 'LIVE',
  etag: 'E2QWRUHEXAMPLE',
  lastModified: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  code: `function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;

  // Extract virtual environment ID from subdomain
  var match = host.match(/^([a-z0-9-]+)\\.preview\\./);
  if (match) {
    request.headers['x-virtual-env-id'] = { value: match[1] };
  }

  return request;
}`,
};

export function isMockMode(): boolean {
  return process.env.NODE_ENV === 'development' && !process.env.GITHUB_CLIENT_ID;
}
