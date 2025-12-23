import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAuth } from 'next-auth/middleware';

// Check if we're in mock mode (development without GitHub OAuth configured)
const isMockMode = process.env.NODE_ENV === 'development' && !process.env.GITHUB_CLIENT_ID;

// Custom middleware that bypasses auth in mock mode
export default function middleware(request: NextRequest) {
  if (isMockMode) {
    // Allow all requests in mock mode
    return NextResponse.next();
  }

  // Use NextAuth middleware for production
  return (withAuth({
    pages: {
      signIn: '/login',
    },
  }) as (req: NextRequest) => Promise<NextResponse>)(request);
}

export const config = {
  matcher: [
    '/(authenticated)/:path*',
    '/api/((?!auth|health).)*',
  ],
};
