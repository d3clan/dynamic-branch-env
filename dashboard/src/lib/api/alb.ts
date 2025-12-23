import {
  ElasticLoadBalancingV2Client,
  DescribeRulesCommand,
  ModifyRuleCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';

const client = new ElasticLoadBalancingV2Client({
  region: process.env.AWS_REGION || 'eu-west-1',
});

const LISTENER_ARN = process.env.ALB_LISTENER_ARN;

export interface ALBRule {
  ruleArn: string;
  priority: string;
  conditions: {
    field: string;
    values: string[];
  }[];
  actions: {
    type: string;
    targetGroupArn?: string;
  }[];
  isDefault: boolean;
}

export interface TargetHealth {
  targetId: string;
  port: number;
  health: 'healthy' | 'unhealthy' | 'unused' | 'draining' | 'unavailable';
  description?: string;
}

export async function listALBRules(): Promise<ALBRule[]> {
  if (!LISTENER_ARN) {
    throw new Error('ALB_LISTENER_ARN environment variable is not set');
  }

  const response = await client.send(
    new DescribeRulesCommand({
      ListenerArn: LISTENER_ARN,
    }),
  );

  return (response.Rules || []).map((rule) => ({
    ruleArn: rule.RuleArn || '',
    priority: rule.Priority || 'default',
    conditions: (rule.Conditions || []).map((c) => ({
      field: c.Field || '',
      values: c.Values || [],
    })),
    actions: (rule.Actions || []).map((a) => ({
      type: a.Type || '',
      targetGroupArn: a.TargetGroupArn,
    })),
    isDefault: rule.IsDefault || false,
  }));
}

export async function countALBRules(): Promise<number> {
  if (!LISTENER_ARN) {
    return 0;
  }

  const rules = await listALBRules();
  // Exclude default rule
  return rules.filter((r) => !r.isDefault).length;
}

export async function updateRulePathPattern(
  ruleArn: string,
  pathPattern: string,
  headerValue?: string,
): Promise<void> {
  const conditions = [
    {
      Field: 'path-pattern',
      Values: [pathPattern],
    },
  ];

  if (headerValue) {
    conditions.push({
      Field: 'http-header',
      HttpHeaderConfig: {
        HttpHeaderName: 'x-virtual-env-id',
        Values: [headerValue],
      },
    } as any);
  }

  await client.send(
    new ModifyRuleCommand({
      RuleArn: ruleArn,
      Conditions: conditions,
    }),
  );
}

export async function getTargetHealth(
  targetGroupArn: string,
): Promise<TargetHealth[]> {
  const response = await client.send(
    new DescribeTargetHealthCommand({
      TargetGroupArn: targetGroupArn,
    }),
  );

  return (response.TargetHealthDescriptions || []).map((desc) => ({
    targetId: desc.Target?.Id || '',
    port: desc.Target?.Port || 0,
    health: (desc.TargetHealth?.State?.toLowerCase() || 'unknown') as TargetHealth['health'],
    description: desc.TargetHealth?.Description,
  }));
}
