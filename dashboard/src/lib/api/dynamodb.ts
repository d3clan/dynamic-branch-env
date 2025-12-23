import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'eu-west-1',
});

export const docClient = DynamoDBDocumentClient.from(client);

const ENVIRONMENTS_TABLE = process.env.ENVIRONMENTS_TABLE || 'virtual-environments';
const ROUTING_CONFIG_TABLE = process.env.ROUTING_CONFIG_TABLE || 'routing-config';
const PRIORITIES_TABLE = process.env.PRIORITIES_TABLE || 'alb-rule-priorities';

export interface VirtualEnvironment {
  virtualEnvId: string;
  status: 'CREATING' | 'ACTIVE' | 'UPDATING' | 'DESTROYING' | 'FAILED';
  repository: string;
  branch: string;
  prNumber?: number;
  services: ServiceConfig[];
  createdAt: string;
  updatedAt: string;
  ttlTimestamp?: number;
  previewUrl?: string;
  errorMessage?: string;
}

export interface ServiceConfig {
  name: string;
  imageUri: string;
  pathPattern: string;
  port: number;
  cpu?: number;
  memory?: number;
  healthCheckPath?: string;
  status?: string;
  taskArn?: string;
  targetGroupArn?: string;
}

export interface RoutingConfig {
  virtualEnvId: string;
  serviceName: string;
  pathPattern: string;
  priority: number;
  albRuleArn?: string;
  targetGroupArn?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listEnvironments(): Promise<VirtualEnvironment[]> {
  const response = await docClient.send(
    new ScanCommand({
      TableName: ENVIRONMENTS_TABLE,
    }),
  );

  return (response.Items || []) as VirtualEnvironment[];
}

export async function getEnvironment(
  virtualEnvId: string,
): Promise<VirtualEnvironment | null> {
  const response = await docClient.send(
    new GetCommand({
      TableName: ENVIRONMENTS_TABLE,
      Key: { virtualEnvId },
    }),
  );

  return (response.Item as VirtualEnvironment) || null;
}

export async function updateEnvironmentTTL(
  virtualEnvId: string,
  ttlTimestamp: number,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: ENVIRONMENTS_TABLE,
      Key: { virtualEnvId },
      UpdateExpression: 'SET ttlTimestamp = :ttl, updatedAt = :now',
      ExpressionAttributeValues: {
        ':ttl': ttlTimestamp,
        ':now': new Date().toISOString(),
      },
    }),
  );
}

export async function listRoutingConfigs(): Promise<RoutingConfig[]> {
  const response = await docClient.send(
    new ScanCommand({
      TableName: ROUTING_CONFIG_TABLE,
    }),
  );

  return (response.Items || []) as RoutingConfig[];
}

export async function getRoutingConfigsForEnvironment(
  virtualEnvId: string,
): Promise<RoutingConfig[]> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: ROUTING_CONFIG_TABLE,
      KeyConditionExpression: 'virtualEnvId = :envId',
      ExpressionAttributeValues: {
        ':envId': virtualEnvId,
      },
    }),
  );

  return (response.Items || []) as RoutingConfig[];
}

export async function updateRoutingConfig(
  virtualEnvId: string,
  serviceName: string,
  pathPattern: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: ROUTING_CONFIG_TABLE,
      Key: { virtualEnvId, serviceName },
      UpdateExpression: 'SET pathPattern = :pattern, updatedAt = :now',
      ExpressionAttributeValues: {
        ':pattern': pathPattern,
        ':now': new Date().toISOString(),
      },
    }),
  );
}

export async function countUsedPriorities(): Promise<number> {
  const response = await docClient.send(
    new ScanCommand({
      TableName: PRIORITIES_TABLE,
      Select: 'COUNT',
    }),
  );

  return response.Count || 0;
}
