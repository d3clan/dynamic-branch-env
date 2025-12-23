import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { countALBRules } from '@/lib/api/alb';
import { listEnvironments, countUsedPriorities } from '@/lib/api/dynamodb';
import { authOptions } from '@/lib/auth/options';
import { isMockMode, mockCapacity } from '@/lib/mock-data';

const MAX_ALB_RULES = 100; // AWS limit is 100 rules per listener (excluding default)

export async function GET() {
  // Return mock data in development mode without auth
  if (isMockMode()) {
    return NextResponse.json({
      environments: {
        total: mockCapacity.environments.total,
        byStatus: {
          ACTIVE: mockCapacity.environments.active,
          PROVISIONING: mockCapacity.environments.provisioning,
          FAILED: mockCapacity.environments.failed,
        },
      },
      alb: {
        used: mockCapacity.albRules.used,
        max: MAX_ALB_RULES,
        percentage: mockCapacity.albRules.percentage,
        isWarning: mockCapacity.albRules.percentage >= 70,
        isCritical: mockCapacity.albRules.percentage >= 90,
      },
      priorities: {
        used: mockCapacity.albRules.used,
      },
    });
  }

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
