import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { listRoutingConfigs } from '@/lib/api/dynamodb';
import { authOptions } from '@/lib/auth/options';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const routingConfigs = await listRoutingConfigs();

    // Sort by priority
    routingConfigs.sort((a, b) => a.priority - b.priority);

    return NextResponse.json({ routingConfigs });
  } catch (error) {
    console.error('Error fetching routing configs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routing configs' },
      { status: 500 },
    );
  }
}
