import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getEnvironment, getRoutingConfigsForEnvironment } from '@/lib/api/dynamodb';
import { authOptions } from '@/lib/auth/options';

const eventBridge = new EventBridgeClient({
  region: process.env.AWS_REGION || 'eu-west-1',
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ envId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { envId } = await params;
    const [environment, routingConfigs] = await Promise.all([
      getEnvironment(envId),
      getRoutingConfigsForEnvironment(envId),
    ]);

    if (!environment) {
      return NextResponse.json(
        { error: 'Environment not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      environment,
      routingConfigs,
    });
  } catch (error) {
    console.error('Error fetching environment:', error);
    return NextResponse.json(
      { error: 'Failed to fetch environment' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ envId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { envId } = await params;
    const environment = await getEnvironment(envId);

    if (!environment) {
      return NextResponse.json(
        { error: 'Environment not found' },
        { status: 404 },
      );
    }

    // Send destroy event to EventBridge
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'virtual-env.dashboard',
            DetailType: 'Environment Destroy Requested',
            Detail: JSON.stringify({
              virtualEnvId: envId,
              requestedBy: session.user?.email || session.user?.name,
              requestedAt: new Date().toISOString(),
            }),
          },
        ],
      }),
    );

    return NextResponse.json({
      message: 'Environment destroy initiated',
      virtualEnvId: envId,
    });
  } catch (error) {
    console.error('Error deleting environment:', error);
    return NextResponse.json(
      { error: 'Failed to delete environment' },
      { status: 500 },
    );
  }
}
