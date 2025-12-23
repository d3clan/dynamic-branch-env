import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getFunctionCode, getFunctionInfo } from '@/lib/api/cloudfront';
import { authOptions } from '@/lib/auth/options';
import { isMockMode, mockCloudFrontFunction } from '@/lib/mock-data';

export async function GET() {
  // Return mock data in development mode without auth
  if (isMockMode()) {
    return NextResponse.json(mockCloudFrontFunction);
  }

  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [functionInfo, functionCode] = await Promise.all([
      getFunctionInfo(),
      getFunctionCode(),
    ]);

    return NextResponse.json({
      ...functionInfo,
      code: functionCode.code,
      etag: functionCode.etag,
    });
  } catch (error) {
    console.error('Error fetching CloudFront function:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CloudFront function' },
      { status: 500 },
    );
  }
}
