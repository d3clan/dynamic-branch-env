import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    '/(authenticated)/:path*',
    '/api/((?!auth|health).)*',
  ],
};
