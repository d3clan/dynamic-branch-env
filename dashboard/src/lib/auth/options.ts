import { NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';

const GITHUB_ORG_NAME = process.env.GITHUB_ORG_NAME;

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'read:org read:user',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account }) {
      if (!GITHUB_ORG_NAME) {
        // No org restriction configured
        return true;
      }

      if (account?.access_token) {
        try {
          // Check if user is a member of the required org
          const response = await fetch(
            `https://api.github.com/user/memberships/orgs/${GITHUB_ORG_NAME}`,
            {
              headers: {
                Authorization: `Bearer ${account.access_token}`,
                Accept: 'application/vnd.github+json',
              },
            },
          );

          if (response.ok) {
            const membership = await response.json();
            return membership.state === 'active';
          }
          return false;
        } catch {
          return false;
        }
      }
      return false;
    },
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        accessToken: token.accessToken,
      };
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
};
