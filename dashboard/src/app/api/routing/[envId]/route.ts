import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { updateRulePathPattern } from '@/lib/api/alb';
import {
  getRoutingConfigsForEnvironment,
  updateRoutingConfig,
} from '@/lib/api/dynamodb';
import { authOptions } from '@/lib/auth/options';

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
    const routingConfigs = await getRoutingConfigsForEnvironment(envId);

    return NextResponse.json({ routingConfigs });
  } catch (error) {
    console.error('Error fetching routing configs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routing configs' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ envId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { envId } = await params;
    const body = await request.json();
    const { serviceName, pathPattern } = body;

    if (!serviceName || !pathPattern) {
      return NextResponse.json(
        { error: 'serviceName and pathPattern are required' },
        { status: 400 },
      );
    }

    // Get current routing config
    const configs = await getRoutingConfigsForEnvironment(envId);
    const config = configs.find((c) => c.serviceName === serviceName);

    if (!config) {
      return NextResponse.json(
        { error: 'Routing config not found' },
        { status: 404 },
      );
    }

    // Update ALB rule if ARN exists
    if (config.albRuleArn) {
      await updateRulePathPattern(
        config.albRuleArn,
        pathPattern,
        envId,
      );
    }

    // Update DynamoDB
    await updateRoutingConfig(envId, serviceName, pathPattern);

    return NextResponse.json({
      message: 'Routing config updated',
      virtualEnvId: envId,
      serviceName,
      pathPattern,
    });
  } catch (error) {
    console.error('Error updating routing config:', error);
    return NextResponse.json(
      { error: 'Failed to update routing config' },
      { status: 500 },
    );
  }
}
