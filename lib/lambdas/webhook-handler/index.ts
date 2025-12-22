import { createHmac, timingSafeEqual } from 'crypto';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const secretsManager = new SecretsManagerClient({});
const eventBridge = new EventBridgeClient({});

interface GitHubPullRequestEvent {
  action: 'opened' | 'synchronize' | 'closed' | 'reopened';
  number: number;
  pull_request: {
    number: number;
    html_url: string;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
    };
    merged?: boolean;
  };
  repository: {
    full_name: string;
    clone_url: string;
  };
}

interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

let cachedCredentials: GitHubAppCredentials | null = null;

async function getGitHubCredentials(): Promise<GitHubAppCredentials> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const secretArn = process.env.GITHUB_APP_SECRET_ARN;
  if (!secretArn) {
    throw new Error('GITHUB_APP_SECRET_ARN environment variable is not set');
  }

  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  if (!response.SecretString) {
    throw new Error('Failed to retrieve GitHub App credentials');
  }

  cachedCredentials = JSON.parse(response.SecretString) as GitHubAppCredentials;
  return cachedCredentials;
}

function verifySignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    console.error('No signature provided');
    return false;
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  } catch {
    return false;
  }
}

function mapGitHubActionToVirtualEnvAction(
  action: string,
): 'CREATE' | 'UPDATE' | 'DESTROY' | null {
  switch (action) {
    case 'opened':
    case 'reopened':
      return 'CREATE';
    case 'synchronize':
      return 'UPDATE';
    case 'closed':
      return 'DESTROY';
    default:
      return null;
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  console.log('Received webhook event:', JSON.stringify({
    headers: event.headers,
    bodyLength: event.body?.length,
  }));

  try {
    // Validate required headers
    const githubEvent = event.headers['x-github-event'];
    const signature = event.headers['x-hub-signature-256'];
    const deliveryId = event.headers['x-github-delivery'];

    if (!githubEvent || !signature || !deliveryId) {
      console.error('Missing required GitHub headers');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required GitHub headers' }),
      };
    }

    // Only process pull_request events
    if (githubEvent !== 'pull_request') {
      console.log(`Ignoring non-pull_request event: ${githubEvent}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Event type not handled' }),
      };
    }

    // Verify webhook signature
    const credentials = await getGitHubCredentials();
    const body = event.body || '';

    if (!verifySignature(body, signature, credentials.webhookSecret)) {
      console.error('Invalid webhook signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    // Parse the payload
    const payload: GitHubPullRequestEvent = JSON.parse(body);
    console.log('Parsed payload:', JSON.stringify({
      action: payload.action,
      prNumber: payload.number,
      repository: payload.repository.full_name,
      branch: payload.pull_request.head.ref,
    }));

    // Map GitHub action to our action
    const virtualEnvAction = mapGitHubActionToVirtualEnvAction(payload.action);
    if (!virtualEnvAction) {
      console.log(`Ignoring pull_request action: ${payload.action}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Action not handled' }),
      };
    }

    // Create virtual environment ID
    const virtualEnvId = `pr-${payload.number}`;

    // Emit EventBridge event
    const eventBusName = process.env.EVENT_BUS_NAME;
    if (!eventBusName) {
      throw new Error('EVENT_BUS_NAME environment variable is not set');
    }

    const eventDetail = {
      action: virtualEnvAction,
      virtualEnvId,
      repository: payload.repository.full_name,
      branch: payload.pull_request.head.ref,
      commitSha: payload.pull_request.head.sha,
      prNumber: payload.number,
      prUrl: payload.pull_request.html_url,
      baseBranch: payload.pull_request.base.ref,
      merged: payload.pull_request.merged ?? false,
    };

    console.log('Emitting EventBridge event:', JSON.stringify(eventDetail));

    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: eventBusName,
            Source: 'virtual-env.github',
            DetailType: 'PullRequestEvent',
            Detail: JSON.stringify(eventDetail),
          },
        ],
      }),
    );

    console.log(`Successfully processed ${virtualEnvAction} event for ${virtualEnvId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Webhook processed successfully',
        virtualEnvId,
        action: virtualEnvAction,
      }),
    };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
