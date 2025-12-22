import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ScheduledEvent } from 'aws-lambda';

const dynamodb = new DynamoDBClient({});
const eventBridge = new EventBridgeClient({});

interface VirtualEnvironment {
  virtualEnvId: string;
  status: string;
  repository: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  expiresAt: number;
}

// Environment variables
const ENVIRONMENTS_TABLE = process.env.ENVIRONMENTS_TABLE_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const GRACE_PERIOD_MINUTES = parseInt(process.env.GRACE_PERIOD_MINUTES || '30', 10);

export async function handler(_event: ScheduledEvent): Promise<void> {
  console.log('Running scheduled cleanup');

  try {
    // Find expired environments
    const expiredEnvironments = await findExpiredEnvironments();
    console.log(`Found ${expiredEnvironments.length} expired environments`);

    // Find environments with active status but past TTL
    const overdueEnvironments = await findOverdueEnvironments();
    console.log(`Found ${overdueEnvironments.length} overdue environments`);

    // Combine and deduplicate
    const environmentsToCleanup = [
      ...expiredEnvironments,
      ...overdueEnvironments.filter(
        (env) => !expiredEnvironments.some((e) => e.virtualEnvId === env.virtualEnvId),
      ),
    ];

    console.log(`Total environments to clean up: ${environmentsToCleanup.length}`);

    // Emit DESTROY events for each environment
    for (const env of environmentsToCleanup) {
      await emitDestroyEvent(env);
    }

    // Log metrics
    console.log('Cleanup summary:', {
      expiredCount: expiredEnvironments.length,
      overdueCount: overdueEnvironments.length,
      totalCleanedUp: environmentsToCleanup.length,
    });
  } catch (error) {
    console.error('Error during scheduled cleanup:', error);
    throw error;
  }
}

async function findExpiredEnvironments(): Promise<VirtualEnvironment[]> {
  const now = Math.floor(Date.now() / 1000);

  // Query for environments that are past their TTL
  // Using the status-expiresAt GSI
  const result = await dynamodb.send(new QueryCommand({
    TableName: ENVIRONMENTS_TABLE,
    IndexName: 'status-expiresAt-index',
    KeyConditionExpression: '#status = :status AND expiresAt < :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: marshall({
      ':status': 'ACTIVE',
      ':now': now,
    }),
  }));

  return (result.Items || []).map((item) => unmarshall(item) as VirtualEnvironment);
}

async function findOverdueEnvironments(): Promise<VirtualEnvironment[]> {
  const now = Math.floor(Date.now() / 1000);
  const gracePeriodSeconds = GRACE_PERIOD_MINUTES * 60;

  // Scan for environments in CREATING or UPDATING status that are stuck
  const result = await dynamodb.send(new ScanCommand({
    TableName: ENVIRONMENTS_TABLE,
    FilterExpression: '(#status = :creating OR #status = :updating) AND expiresAt < :cutoff',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: marshall({
      ':creating': 'CREATING',
      ':updating': 'UPDATING',
      ':cutoff': now - gracePeriodSeconds,
    }),
  }));

  return (result.Items || []).map((item) => unmarshall(item) as VirtualEnvironment);
}

async function emitDestroyEvent(env: VirtualEnvironment): Promise<void> {
  console.log(`Emitting DESTROY event for ${env.virtualEnvId}`);

  const eventDetail = {
    action: 'DESTROY',
    virtualEnvId: env.virtualEnvId,
    repository: env.repository,
    branch: env.branch,
    prNumber: env.prNumber,
    prUrl: env.prUrl,
    commitSha: '', // Not needed for destroy
    reason: 'TTL_EXPIRED',
  };

  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: 'virtual-env.cleanup',
          DetailType: 'PullRequestEvent',
          Detail: JSON.stringify(eventDetail),
        },
      ],
    }),
  );

  console.log(`DESTROY event emitted for ${env.virtualEnvId}`);
}

// Export for testing
export { findExpiredEnvironments, findOverdueEnvironments, emitDestroyEvent };
