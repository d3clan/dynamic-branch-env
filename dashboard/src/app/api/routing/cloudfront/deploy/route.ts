import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { updateAndPublishFunction } from '@/lib/api/cloudfront';
import { authOptions } from '@/lib/auth/options';
import { isMockMode } from '@/lib/mock-data';

export async function POST(request: Request) {
  // Mock deploy in development mode
  if (isMockMode()) {
    const body = await request.json();
    const { code, etag } = body;
    if (!code || !etag) {
      return NextResponse.json({ error: 'code and etag are required' }, { status: 400 });
    }
    return NextResponse.json({
      message: 'CloudFront function deployed successfully (mock)',
      etag: 'MOCK_ETAG_' + Date.now(),
      stage: 'LIVE',
      deployedBy: 'Mock User',
      deployedAt: new Date().toISOString(),
    });
  }

  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { code, etag, comment } = body;

    if (!code || !etag) {
      return NextResponse.json(
        { error: 'code and etag are required' },
        { status: 400 },
      );
    }

    const deployComment = comment || `Deployed by ${session.user?.name || session.user?.email}`;

    const result = await updateAndPublishFunction(code, etag, deployComment);

    return NextResponse.json({
      message: 'CloudFront function deployed successfully',
      etag: result.etag,
      stage: result.stage,
      deployedBy: session.user?.name || session.user?.email,
      deployedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error deploying CloudFront function:', error);

    // Handle specific CloudFront errors
    const errorName = error instanceof Error ? error.name : '';
    if (errorName === 'PreconditionFailed') {
      return NextResponse.json(
        { error: 'The function has been modified. Please refresh and try again.' },
        { status: 409 },
      );
    }

    if (errorName === 'InvalidIfMatchVersion') {
      return NextResponse.json(
        { error: 'Version mismatch. Please refresh and try again.' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to deploy CloudFront function' },
      { status: 500 },
    );
  }
}
