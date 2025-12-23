import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { countALBRules } from '@/lib/api/alb';
import { listEnvironments, countUsedPriorities } from '@/lib/api/dynamodb';
import { authOptions } from '@/lib/auth/options';

const MAX_ALB_RULES = 100; // AWS limit is 100 rules per listener (excluding default)

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [environments, usedPriorities, albRuleCount] = await Promise.all([
      listEnvironments(),
      countUsedPriorities(),
      countALBRules().catch(() => 0), // Gracefully handle if ALB not configured
    ]);

    const statusCounts = environments.reduce(
      (acc, env) => {
        acc[env.status] = (acc[env.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const albUsage = {
      used: albRuleCount,
      max: MAX_ALB_RULES,
      percentage: Math.round((albRuleCount / MAX_ALB_RULES) * 100),
      isWarning: albRuleCount >= MAX_ALB_RULES * 0.7,
      isCritical: albRuleCount >= MAX_ALB_RULES * 0.9,
    };

    return NextResponse.json({
      environments: {
        total: environments.length,
        byStatus: statusCounts,
      },
      alb: albUsage,
      priorities: {
        used: usedPriorities,
      },
    });
  } catch (error) {
    console.error('Error fetching capacity:', error);
    return NextResponse.json(
      { error: 'Failed to fetch capacity info' },
      { status: 500 },
    );
  }
}
