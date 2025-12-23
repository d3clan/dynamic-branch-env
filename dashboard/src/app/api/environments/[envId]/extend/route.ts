import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getEnvironment, updateEnvironmentTTL } from '@/lib/api/dynamodb';
import { authOptions } from '@/lib/auth/options';

const DEFAULT_EXTENSION_HOURS = 24;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ envId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { envId } = await params;
    const body = await request.json().catch(() => ({}));
    const extensionHours = body.hours || DEFAULT_EXTENSION_HOURS;

    const environment = await getEnvironment(envId);

    if (!environment) {
      return NextResponse.json(
        { error: 'Environment not found' },
        { status: 404 },
      );
    }

    // Calculate new TTL
    const currentTtl = environment.ttlTimestamp || Math.floor(Date.now() / 1000);
    const newTtl = currentTtl + extensionHours * 60 * 60;

    await updateEnvironmentTTL(envId, newTtl);

    return NextResponse.json({
      message: 'TTL extended successfully',
      virtualEnvId: envId,
      newTtlTimestamp: newTtl,
      newExpiresAt: new Date(newTtl * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Error extending TTL:', error);
    return NextResponse.json(
      { error: 'Failed to extend TTL' },
      { status: 500 },
    );
  }
}
