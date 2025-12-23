import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { listEnvironments } from '@/lib/api/dynamodb';
import { authOptions } from '@/lib/auth/options';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const environments = await listEnvironments();

    // Sort by createdAt descending (newest first)
    environments.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({ environments });
  } catch (error) {
    console.error('Error fetching environments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch environments' },
      { status: 500 },
    );
  }
}
