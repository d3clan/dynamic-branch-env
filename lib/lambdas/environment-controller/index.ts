import {
    DeleteItemCommand,
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    QueryCommand,
    UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
    CreateServiceCommand,
    DeleteServiceCommand,
    ECSClient,
    RegisterTaskDefinitionCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {
    CreateRuleCommand,
    CreateTargetGroupCommand,
    DeleteRuleCommand,
    DeleteTargetGroupCommand,
    ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
    CreateServiceCommand as CreateCloudMapServiceCommand,
    DeleteServiceCommand as DeleteCloudMapServiceCommand,
    ServiceDiscoveryClient,
} from '@aws-sdk/client-servicediscovery';
import {marshall, unmarshall} from '@aws-sdk/util-dynamodb';
import {EventBridgeEvent} from 'aws-lambda';

const dynamodb = new DynamoDBClient({});
const ecs = new ECSClient({});
const elbv2 = new ElasticLoadBalancingV2Client({});
const servicediscovery = new ServiceDiscoveryClient({});

interface VirtualEnvAction {
  action: 'CREATE' | 'UPDATE' | 'DESTROY';
  virtualEnvId: string;
  repository: string;
  branch: string;
  commitSha: string;
  prNumber: number;
  prUrl: string;
  baseBranch?: string;
  merged?: boolean;
}

interface ServiceState {
  serviceId: string;
  ecsServiceArn?: string;
  taskDefinitionArn?: string;
  targetGroupArn?: string;
  albRuleArn?: string;
  cloudMapServiceId?: string;
  status: string;
}

interface VirtualEnvironment {
  virtualEnvId: string;
  status: string;
  repository: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  commitSha: string;
  services: Record<string, ServiceState>;
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
  ttl: number;
}

interface RoutingConfig {
  serviceId: string;
  virtualEnvId: string;
  targetGroupArn: string;
  albRuleArn: string;
  priority: number;
  ttl: number;
}

// Service configuration - in production, this would come from a config file or parameter store
interface PreviewableService {
  serviceId: string;
  pathPattern: string;
  port: number;
  healthCheckPath: string;
  cpu: number;
  memory: number;
  imageUri: string;
}

// Example services configuration - replace with your actual services
const PREVIEWABLE_SERVICES: PreviewableService[] = [
  {
    serviceId: 'api-gateway',
    pathPattern: '/api/*',
    port: 3000,
    healthCheckPath: '/health',
    cpu: 256,
    memory: 512,
    imageUri: 'amazon/amazon-ecs-sample:latest', // Replace with your ECR image
  },
  {
    serviceId: 'web-app',
    pathPattern: '/*',
    port: 3000,
    healthCheckPath: '/health',
    cpu: 256,
    memory: 512,
    imageUri: 'amazon/amazon-ecs-sample:latest', // Replace with your ECR image
  },
];

// Environment variables
const ENVIRONMENTS_TABLE = process.env.ENVIRONMENTS_TABLE_NAME!;
const ROUTING_CONFIG_TABLE = process.env.ROUTING_CONFIG_TABLE_NAME!;
const PRIORITIES_TABLE = process.env.PRIORITIES_TABLE_NAME!;
const ALB_LISTENER_ARN = process.env.ALB_LISTENER_ARN!;
const VPC_ID = process.env.VPC_ID!;
const VPC_SUBNET_IDS = process.env.VPC_SUBNET_IDS!.split(',');
const ECS_SECURITY_GROUP_ID = process.env.ECS_SECURITY_GROUP_ID!;
const NAMESPACE_ID = process.env.NAMESPACE_ID!;
const ECS_CLUSTER_ARN = process.env.ECS_CLUSTER_ARN!;
const TASK_EXECUTION_ROLE_ARN = process.env.TASK_EXECUTION_ROLE_ARN!;
const TASK_ROLE_ARN = process.env.TASK_ROLE_ARN!;
const ECS_LOG_GROUP_NAME = process.env.ECS_LOG_GROUP_NAME!;
const DOMAIN_NAME = process.env.DOMAIN_NAME!;
const DEFAULT_TTL_HOURS = parseInt(process.env.DEFAULT_TTL_HOURS || '24', 10);

// Header name for virtual environment routing
const VIRTUAL_ENV_HEADER = 'x-virtual-env-id';

export async function handler(
  event: EventBridgeEvent<'PullRequestEvent', VirtualEnvAction>,
): Promise<void> {
  console.log('Received event:', JSON.stringify(event));

  const { action, virtualEnvId } = event.detail;

  console.log(`Processing ${action} for ${virtualEnvId}`);

  try {
    switch (action) {
      case 'CREATE':
        await handleCreate(event.detail);
        break;
      case 'UPDATE':
        await handleUpdate(event.detail);
        break;
      case 'DESTROY':
        await handleDestroy(event.detail);
        break;
      default:
        console.log(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error(`Error processing ${action} for ${virtualEnvId}:`, error);

    // Update environment status to FAILED
    await updateEnvironmentStatus(virtualEnvId, 'FAILED', error instanceof Error ? error.message : 'Unknown error');

    throw error;
  }
}

async function handleCreate(action: VirtualEnvAction): Promise<void> {
  const { virtualEnvId, repository, branch, commitSha, prNumber, prUrl } = action;

  console.log(`Creating virtual environment: ${virtualEnvId}`);

  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + (DEFAULT_TTL_HOURS * 60 * 60);
  const previewUrl = `https://${virtualEnvId}.${DOMAIN_NAME}`;

  // Check if environment already exists
  const existing = await getEnvironment(virtualEnvId);
  if (existing && existing.status !== 'DESTROYED' && existing.status !== 'FAILED') {
    console.log(`Environment ${virtualEnvId} already exists with status ${existing.status}, updating instead`);
    await handleUpdate(action);
    return;
  }

  // Create environment record
  const environment: VirtualEnvironment = {
    virtualEnvId,
    status: 'CREATING',
    repository,
    branch,
    prNumber,
    prUrl,
    commitSha,
    services: {},
    previewUrl,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    ttl: expiresAt,
  };

  await dynamodb.send(new PutItemCommand({
    TableName: ENVIRONMENTS_TABLE,
    Item: marshall(environment),
  }));

  console.log(`Created environment record for ${virtualEnvId}`);

  // Deploy each previewable service
  const serviceStates: Record<string, ServiceState> = {};

  for (const service of PREVIEWABLE_SERVICES) {
    try {
      console.log(`Deploying service ${service.serviceId} for ${virtualEnvId}`);

      serviceStates[service.serviceId] = await deployService(virtualEnvId, service, expiresAt);

      // Update environment with service state
      await updateEnvironmentServices(virtualEnvId, serviceStates);

      console.log(`Service ${service.serviceId} deployed successfully`);
    } catch (error) {
      console.error(`Failed to deploy service ${service.serviceId}:`, error);
      serviceStates[service.serviceId] = {
        serviceId: service.serviceId,
        status: 'FAILED',
      };
      await updateEnvironmentServices(virtualEnvId, serviceStates);
    }
  }

  // Update status to ACTIVE
  await updateEnvironmentStatus(virtualEnvId, 'ACTIVE');

  console.log(`Virtual environment ${virtualEnvId} is now ACTIVE at ${previewUrl}`);
}

async function handleUpdate(action: VirtualEnvAction): Promise<void> {
  const { virtualEnvId, commitSha } = action;

  console.log(`Updating virtual environment: ${virtualEnvId}`);

  const existing = await getEnvironment(virtualEnvId);
  if (!existing) {
    console.log(`Environment ${virtualEnvId} not found, creating instead`);
    await handleCreate(action);
    return;
  }

  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + (DEFAULT_TTL_HOURS * 60 * 60);

  // Update environment record with new TTL
  await dynamodb.send(new UpdateItemCommand({
    TableName: ENVIRONMENTS_TABLE,
    Key: marshall({ virtualEnvId }),
    UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #expiresAt = :expiresAt, #ttl = :ttl, #commitSha = :commitSha',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      '#expiresAt': 'expiresAt',
      '#ttl': 'ttl',
      '#commitSha': 'commitSha',
    },
    ExpressionAttributeValues: marshall({
      ':status': 'UPDATING',
      ':updatedAt': now,
      ':expiresAt': expiresAt,
      ':ttl': expiresAt,
      ':commitSha': commitSha,
    }),
  }));

  // Force new deployment for each service
  for (const service of PREVIEWABLE_SERVICES) {
    const serviceState = existing.services[service.serviceId];
    if (serviceState?.ecsServiceArn) {
      try {
        console.log(`Forcing new deployment for ${service.serviceId}`);
        await ecs.send(new UpdateServiceCommand({
          cluster: ECS_CLUSTER_ARN,
          service: serviceState.ecsServiceArn,
          forceNewDeployment: true,
        }));
      } catch (error) {
        console.error(`Failed to update service ${service.serviceId}:`, error);
      }
    }
  }

  // Update routing config TTLs
  await updateRoutingConfigTtls(virtualEnvId, expiresAt);

  // Update status to ACTIVE
  await updateEnvironmentStatus(virtualEnvId, 'ACTIVE');

  console.log(`Virtual environment ${virtualEnvId} updated`);
}

async function handleDestroy(action: VirtualEnvAction): Promise<void> {
  const { virtualEnvId } = action;

  console.log(`Destroying virtual environment: ${virtualEnvId}`);

  const existing = await getEnvironment(virtualEnvId);
  if (!existing) {
    console.log(`Environment ${virtualEnvId} not found, nothing to destroy`);
    return;
  }

  // Update status to DESTROYING
  await updateEnvironmentStatus(virtualEnvId, 'DESTROYING');

  // Cleanup each service
  for (const serviceId of Object.keys(existing.services)) {
    try {
      console.log(`Cleaning up service ${serviceId}`);
      await cleanupService(virtualEnvId, serviceId, existing.services[serviceId]);
    } catch (error) {
      console.error(`Failed to cleanup service ${serviceId}:`, error);
    }
  }

  // Clean up routing config
  await cleanupRoutingConfig(virtualEnvId);

  // Update status to DESTROYED
  await updateEnvironmentStatus(virtualEnvId, 'DESTROYED');

  console.log(`Virtual environment ${virtualEnvId} destroyed`);
}

async function deployService(
  virtualEnvId: string,
  service: PreviewableService,
  expiresAt: number,
): Promise<ServiceState> {
  const serviceName = `${virtualEnvId}-${service.serviceId}`;
  const region = process.env.AWS_REGION || 'us-west-2';

  // 1. Register task definition
  console.log(`Registering task definition for ${serviceName}`);
  const taskDefResponse = await ecs.send(new RegisterTaskDefinitionCommand({
    family: serviceName,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: service.cpu.toString(),
    memory: service.memory.toString(),
    executionRoleArn: TASK_EXECUTION_ROLE_ARN,
    taskRoleArn: TASK_ROLE_ARN,
    containerDefinitions: [
      {
        name: service.serviceId,
        image: service.imageUri,
        essential: true,
        portMappings: [
          {
            containerPort: service.port,
            protocol: 'tcp',
          },
        ],
        environment: [
          { name: 'VIRTUAL_ENV_ID', value: virtualEnvId },
          { name: 'SERVICE_ID', value: service.serviceId },
          { name: 'NODE_ENV', value: 'development' },
        ],
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': ECS_LOG_GROUP_NAME,
            'awslogs-region': region,
            'awslogs-stream-prefix': serviceName,
          },
        },
        healthCheck: {
          command: ['CMD-SHELL', `curl -f http://localhost:${service.port}${service.healthCheckPath} || exit 1`],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 60,
        },
      },
    ],
    tags: [
      { key: 'virtual-env-id', value: virtualEnvId },
      { key: 'service-id', value: service.serviceId },
    ],
  }));

  const taskDefinitionArn = taskDefResponse.taskDefinition?.taskDefinitionArn;
  if (!taskDefinitionArn) {
    throw new Error('Failed to register task definition');
  }

  // 2. Create target group
  console.log(`Creating target group for ${serviceName}`);
  const targetGroupName = `${virtualEnvId.substring(0, 20)}-${service.serviceId.substring(0, 10)}`.substring(0, 32);
  const targetGroupResponse = await elbv2.send(new CreateTargetGroupCommand({
    Name: targetGroupName,
    Protocol: 'HTTP',
    Port: service.port,
    VpcId: VPC_ID,
    TargetType: 'ip',
    HealthCheckPath: service.healthCheckPath,
    HealthCheckProtocol: 'HTTP',
    HealthCheckIntervalSeconds: 30,
    HealthCheckTimeoutSeconds: 5,
    HealthyThresholdCount: 2,
    UnhealthyThresholdCount: 3,
    Tags: [
      { Key: 'virtual-env-id', Value: virtualEnvId },
      { Key: 'service-id', Value: service.serviceId },
    ],
  }));

  const targetGroupArn = targetGroupResponse.TargetGroups?.[0]?.TargetGroupArn;
  if (!targetGroupArn) {
    throw new Error('Failed to create target group');
  }

  // 3. Allocate priority and create ALB rule
  console.log(`Creating ALB rule for ${serviceName}`);
  const priority = await allocatePriority(virtualEnvId, service.serviceId, expiresAt);

  const ruleResponse = await elbv2.send(new CreateRuleCommand({
    ListenerArn: ALB_LISTENER_ARN,
    Priority: priority,
    Conditions: [
      {
        Field: 'http-header',
        HttpHeaderConfig: {
          HttpHeaderName: VIRTUAL_ENV_HEADER,
          Values: [virtualEnvId],
        },
      },
      {
        Field: 'path-pattern',
        PathPatternConfig: {
          Values: [service.pathPattern],
        },
      },
    ],
    Actions: [
      {
        Type: 'forward',
        TargetGroupArn: targetGroupArn,
      },
    ],
    Tags: [
      { Key: 'virtual-env-id', Value: virtualEnvId },
      { Key: 'service-id', Value: service.serviceId },
    ],
  }));

  const albRuleArn = ruleResponse.Rules?.[0]?.RuleArn;
  if (!albRuleArn) {
    throw new Error('Failed to create ALB rule');
  }

  // 4. Create Cloud Map service
  console.log(`Creating Cloud Map service for ${serviceName}`);
  let cloudMapServiceId: string | undefined;
  try {
    const cloudMapResponse = await servicediscovery.send(new CreateCloudMapServiceCommand({
      Name: serviceName,
      NamespaceId: NAMESPACE_ID,
      DnsConfig: {
        DnsRecords: [
          {
            Type: 'A',
            TTL: 60,
          },
        ],
        RoutingPolicy: 'MULTIVALUE',
      },
      HealthCheckCustomConfig: {
        FailureThreshold: 1,
      },
      Tags: [
        { Key: 'virtual-env-id', Value: virtualEnvId },
        { Key: 'service-id', Value: service.serviceId },
      ],
    }));
    cloudMapServiceId = cloudMapResponse.Service?.Id;
  } catch (error) {
    console.warn('Failed to create Cloud Map service (non-fatal):', error);
  }

  // 5. Create ECS service
  console.log(`Creating ECS service for ${serviceName}`);
  const ecsServiceResponse = await ecs.send(new CreateServiceCommand({
    cluster: ECS_CLUSTER_ARN,
    serviceName: serviceName,
    taskDefinition: taskDefinitionArn,
    desiredCount: 1,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: VPC_SUBNET_IDS,
        securityGroups: [ECS_SECURITY_GROUP_ID],
        assignPublicIp: 'DISABLED',
      },
    },
    loadBalancers: [
      {
        targetGroupArn: targetGroupArn,
        containerName: service.serviceId,
        containerPort: service.port,
      },
    ],
    serviceRegistries: cloudMapServiceId ? [
      {
        registryArn: `arn:aws:servicediscovery:${region}:${process.env.AWS_ACCOUNT_ID || '*'}:service/${cloudMapServiceId}`,
      },
    ] : undefined,
    enableExecuteCommand: true,
    propagateTags: 'SERVICE',
    tags: [
      { key: 'virtual-env-id', value: virtualEnvId },
      { key: 'service-id', value: service.serviceId },
    ],
  }));

  const ecsServiceArn = ecsServiceResponse.service?.serviceArn;
  if (!ecsServiceArn) {
    throw new Error('Failed to create ECS service');
  }

  // 6. Store routing config
  console.log(`Storing routing config for ${serviceName}`);
  const routingConfig: RoutingConfig = {
    serviceId: service.serviceId,
    virtualEnvId,
    targetGroupArn,
    albRuleArn,
    priority,
    ttl: expiresAt,
  };

  await dynamodb.send(new PutItemCommand({
    TableName: ROUTING_CONFIG_TABLE,
    Item: marshall(routingConfig),
  }));

  return {
    serviceId: service.serviceId,
    ecsServiceArn,
    taskDefinitionArn,
    targetGroupArn,
    albRuleArn,
    cloudMapServiceId,
    status: 'ACTIVE',
  };
}

async function cleanupService(
  virtualEnvId: string,
  serviceId: string,
  serviceState: ServiceState,
): Promise<void> {
  const serviceName = `${virtualEnvId}-${serviceId}`;

  // 1. Delete ALB rule
  if (serviceState.albRuleArn) {
    try {
      console.log(`Deleting ALB rule for ${serviceName}`);
      await elbv2.send(new DeleteRuleCommand({
        RuleArn: serviceState.albRuleArn,
      }));
    } catch (error) {
      console.warn('Failed to delete ALB rule:', error);
    }
  }

  // 2. Scale ECS service to 0 and delete
  if (serviceState.ecsServiceArn) {
    try {
      console.log(`Scaling down ECS service ${serviceName}`);
      await ecs.send(new UpdateServiceCommand({
        cluster: ECS_CLUSTER_ARN,
        service: serviceName,
        desiredCount: 0,
      }));

      // Wait a bit for tasks to drain
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log(`Deleting ECS service ${serviceName}`);
      await ecs.send(new DeleteServiceCommand({
        cluster: ECS_CLUSTER_ARN,
        service: serviceName,
        force: true,
      }));
    } catch (error) {
      console.warn('Failed to delete ECS service:', error);
    }
  }

  // 3. Delete target group (must wait for ECS service to be deleted)
  if (serviceState.targetGroupArn) {
    try {
      // Wait for targets to deregister
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log(`Deleting target group for ${serviceName}`);
      await elbv2.send(new DeleteTargetGroupCommand({
        TargetGroupArn: serviceState.targetGroupArn,
      }));
    } catch (error) {
      console.warn('Failed to delete target group:', error);
    }
  }

  // 4. Delete Cloud Map service
  if (serviceState.cloudMapServiceId) {
    try {
      console.log(`Deleting Cloud Map service for ${serviceName}`);
      await servicediscovery.send(new DeleteCloudMapServiceCommand({
        Id: serviceState.cloudMapServiceId,
      }));
    } catch (error) {
      console.warn('Failed to delete Cloud Map service:', error);
    }
  }

  // 5. Release priority
  const routingConfig = await getRoutingConfig(serviceId, virtualEnvId);
  if (routingConfig) {
    await releasePriority(routingConfig.priority);
  }
}

async function getEnvironment(virtualEnvId: string): Promise<VirtualEnvironment | null> {
  const result = await dynamodb.send(new GetItemCommand({
    TableName: ENVIRONMENTS_TABLE,
    Key: marshall({ virtualEnvId }),
  }));

  if (!result.Item) {
    return null;
  }

  return unmarshall(result.Item) as VirtualEnvironment;
}

async function updateEnvironmentStatus(
  virtualEnvId: string,
  status: string,
  error?: string,
): Promise<void> {
  const now = new Date().toISOString();

  const updateExpression = error
    ? 'SET #status = :status, #updatedAt = :updatedAt, #lastError = :error'
    : 'SET #status = :status, #updatedAt = :updatedAt';

  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };

  const expressionAttributeValues: Record<string, string> = {
    ':status': status,
    ':updatedAt': now,
  };

  if (error) {
    expressionAttributeNames['#lastError'] = 'lastError';
    expressionAttributeValues[':error'] = error;
  }

  await dynamodb.send(new UpdateItemCommand({
    TableName: ENVIRONMENTS_TABLE,
    Key: marshall({ virtualEnvId }),
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: marshall(expressionAttributeValues),
  }));
}

async function updateEnvironmentServices(
  virtualEnvId: string,
  services: Record<string, ServiceState>,
): Promise<void> {
  await dynamodb.send(new UpdateItemCommand({
    TableName: ENVIRONMENTS_TABLE,
    Key: marshall({ virtualEnvId }),
    UpdateExpression: 'SET #services = :services, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#services': 'services',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: marshall({
      ':services': services,
      ':updatedAt': new Date().toISOString(),
    }),
  }));
}

async function updateRoutingConfigTtls(virtualEnvId: string, expiresAt: number): Promise<void> {
  // Query all routing config entries for this virtual environment
  const result = await dynamodb.send(new QueryCommand({
    TableName: ROUTING_CONFIG_TABLE,
    IndexName: 'virtualEnvId-serviceId-index',
    KeyConditionExpression: 'virtualEnvId = :virtualEnvId',
    ExpressionAttributeValues: marshall({ ':virtualEnvId': virtualEnvId }),
  }));

  if (!result.Items) {
    return;
  }

  // Update TTL for each routing config
  for (const item of result.Items) {
    const config = unmarshall(item) as RoutingConfig;
    await dynamodb.send(new UpdateItemCommand({
      TableName: ROUTING_CONFIG_TABLE,
      Key: marshall({
        serviceId: config.serviceId,
        virtualEnvId: config.virtualEnvId,
      }),
      UpdateExpression: 'SET #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: marshall({ ':ttl': expiresAt }),
    }));
  }
}

async function cleanupRoutingConfig(virtualEnvId: string): Promise<void> {
  // Query all routing config entries for this virtual environment
  const result = await dynamodb.send(new QueryCommand({
    TableName: ROUTING_CONFIG_TABLE,
    IndexName: 'virtualEnvId-serviceId-index',
    KeyConditionExpression: 'virtualEnvId = :virtualEnvId',
    ExpressionAttributeValues: marshall({ ':virtualEnvId': virtualEnvId }),
  }));

  if (!result.Items || result.Items.length === 0) {
    console.log(`No routing config found for ${virtualEnvId}`);
    return;
  }

  // Delete each routing config entry
  for (const item of result.Items) {
    const config = unmarshall(item);
    await dynamodb.send(new DeleteItemCommand({
      TableName: ROUTING_CONFIG_TABLE,
      Key: marshall({
        serviceId: config.serviceId,
        virtualEnvId: config.virtualEnvId,
      }),
    }));
    console.log(`Deleted routing config for ${config.serviceId}/${virtualEnvId}`);
  }
}

async function getRoutingConfig(serviceId: string, virtualEnvId: string): Promise<RoutingConfig | null> {
  const result = await dynamodb.send(new GetItemCommand({
    TableName: ROUTING_CONFIG_TABLE,
    Key: marshall({ serviceId, virtualEnvId }),
  }));

  if (!result.Item) {
    return null;
  }

  return unmarshall(result.Item) as RoutingConfig;
}

async function allocatePriority(virtualEnvId: string, serviceId: string, expiresAt: number): Promise<number> {
  // Query existing priorities
  const result = await dynamodb.send(new QueryCommand({
    TableName: PRIORITIES_TABLE,
    KeyConditionExpression: 'listenerArn = :listenerArn',
    ExpressionAttributeValues: marshall({ ':listenerArn': ALB_LISTENER_ARN }),
    ScanIndexForward: true,
  }));

  const usedPriorities = new Set(
    result.Items?.map(item => unmarshall(item).priority as number) || [],
  );

  // Find first available priority in range 1-100 (reserved for previews)
  for (let priority = 1; priority <= 100; priority++) {
    if (!usedPriorities.has(priority)) {
      // Reserve this priority
      try {
        await dynamodb.send(new PutItemCommand({
          TableName: PRIORITIES_TABLE,
          Item: marshall({
            listenerArn: ALB_LISTENER_ARN,
            priority,
            virtualEnvId,
            serviceId,
            allocatedAt: new Date().toISOString(),
            ttl: expiresAt,
          }),
          ConditionExpression: 'attribute_not_exists(listenerArn) AND attribute_not_exists(priority)',
        }));
        return priority;
      } catch {
        // Priority was taken by another process, try next one
      }
    }
  }

  throw new Error('No available ALB rule priorities - maximum concurrent environments reached');
}

async function releasePriority(priority: number): Promise<void> {
  try {
    await dynamodb.send(new DeleteItemCommand({
      TableName: PRIORITIES_TABLE,
      Key: marshall({
        listenerArn: ALB_LISTENER_ARN,
        priority,
      }),
    }));
  } catch (error) {
    console.warn(`Failed to release priority ${priority}:`, error);
  }
}
