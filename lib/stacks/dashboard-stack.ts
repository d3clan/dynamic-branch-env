import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DashboardStackProps extends cdk.StackProps {
  /**
   * VPC for ECS service
   */
  vpc: ec2.IVpc;

  /**
   * ECS Cluster
   */
  cluster: ecs.ICluster;

  /**
   * Security group for ECS services
   */
  ecsSecurityGroup: ec2.ISecurityGroup;

  /**
   * ALB HTTPS Listener for routing
   */
  httpsListener: elbv2.IApplicationListener;

  /**
   * Virtual Environments DynamoDB table ARN
   */
  environmentsTableArn: string;

  /**
   * Routing Config DynamoDB table ARN
   */
  routingConfigTableArn: string;

  /**
   * Priorities DynamoDB table ARN
   */
  prioritiesTableArn: string;

  /**
   * CloudFront Distribution ID
   */
  distributionId: string;

  /**
   * CloudFront Function name
   */
  cloudfrontFunctionName: string;

  /**
   * ALB Listener ARN (for API access)
   */
  albListenerArn: string;

  /**
   * Domain name
   */
  domainName: string;

  /**
   * GitHub OAuth Client ID (from context)
   */
  githubOAuthClientId?: string;

  /**
   * GitHub Organization name for membership check
   */
  githubOrgName?: string;
}

/**
 * Dashboard Stack
 *
 * Creates:
 * - ECR repository for dashboard container image
 * - ECS Fargate service for Next.js dashboard
 * - Secrets Manager for OAuth credentials
 * - ALB listener rule for dashboard.{domain}
 * - IAM permissions for DynamoDB, ALB, CloudFront read/write
 */
export class DashboardStack extends cdk.Stack {
  /**
   * ECR Repository for dashboard image
   */
  public readonly repository: ecr.Repository;

  /**
   * ECS Service for the dashboard
   */
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: DashboardStackProps) {
    super(scope, id, props);

    // =========================================================================
    // ECR Repository
    // =========================================================================

    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'virtual-env-dashboard',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep only 10 images',
        },
      ],
    });

    // =========================================================================
    // Secrets
    // =========================================================================

    // Dashboard secrets (GitHub OAuth + NextAuth)
    const dashboardSecret = new secretsmanager.Secret(this, 'DashboardSecret', {
      secretName: 'virtual-env-dashboard-secrets',
      description: 'Secrets for Virtual Environment Dashboard',
      secretObjectValue: {
        GITHUB_CLIENT_ID: cdk.SecretValue.unsafePlainText(
          props.githubOAuthClientId || 'PLACEHOLDER_CLIENT_ID',
        ),
        GITHUB_CLIENT_SECRET: cdk.SecretValue.unsafePlainText('PLACEHOLDER_CLIENT_SECRET'),
        NEXTAUTH_SECRET: cdk.SecretValue.unsafePlainText(
          // Generate a random string for NextAuth
          cdk.Names.uniqueId(this).substring(0, 32),
        ),
      },
    });

    // =========================================================================
    // Log Group
    // =========================================================================

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/virtual-env-dashboard',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // Task Definition
    // =========================================================================

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: 'virtual-env-dashboard',
      cpu: 256,
      memoryLimitMiB: 512,
    });

    // Add container
    taskDefinition.addContainer('dashboard', {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'dashboard',
      }),
      environment: {
        NODE_ENV: 'production',
        NEXTAUTH_URL: `https://dashboard.${props.domainName}`,
        GITHUB_ORG_NAME: props.githubOrgName || '',
        AWS_REGION: this.region,
        ENVIRONMENTS_TABLE: 'virtual-environments',
        ROUTING_CONFIG_TABLE: 'routing-config',
        PRIORITIES_TABLE: 'alb-rule-priorities',
        ALB_LISTENER_ARN: props.albListenerArn,
        CLOUDFRONT_FUNCTION_NAME: props.cloudfrontFunctionName,
        CLOUDFRONT_DISTRIBUTION_ID: props.distributionId,
      },
      secrets: {
        GITHUB_CLIENT_ID: ecs.Secret.fromSecretsManager(dashboardSecret, 'GITHUB_CLIENT_ID'),
        GITHUB_CLIENT_SECRET: ecs.Secret.fromSecretsManager(dashboardSecret, 'GITHUB_CLIENT_SECRET'),
        NEXTAUTH_SECRET: ecs.Secret.fromSecretsManager(dashboardSecret, 'NEXTAUTH_SECRET'),
      },
      portMappings: [
        {
          containerPort: 3000,
          protocol: ecs.Protocol.TCP,
        },
      ],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // =========================================================================
    // IAM Permissions
    // =========================================================================

    // DynamoDB read permissions
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:UpdateItem',
        ],
        resources: [
          props.environmentsTableArn,
          `${props.environmentsTableArn}/index/*`,
          props.routingConfigTableArn,
          `${props.routingConfigTableArn}/index/*`,
          props.prioritiesTableArn,
        ],
      }),
    );

    // ALB read/write permissions (for rule modifications)
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'elasticloadbalancing:DescribeRules',
          'elasticloadbalancing:ModifyRule',
          'elasticloadbalancing:DescribeTargetHealth',
        ],
        resources: ['*'], // Scope down in production
      }),
    );

    // CloudFront function read/write permissions
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudfront:GetFunction',
          'cloudfront:DescribeFunction',
          'cloudfront:UpdateFunction',
          'cloudfront:PublishFunction',
        ],
        resources: [
          `arn:aws:cloudfront::${this.account}:function/${props.cloudfrontFunctionName}`,
        ],
      }),
    );

    // ECS read permissions (for service status)
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:DescribeServices',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
        ],
        resources: ['*'], // Scope down in production
      }),
    );

    // EventBridge permissions (for triggering destroy)
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:${this.region}:${this.account}:event-bus/virtual-env-events`,
        ],
      }),
    );

    // =========================================================================
    // ECS Service
    // =========================================================================

    this.service = new ecs.FargateService(this, 'Service', {
      serviceName: 'virtual-env-dashboard',
      cluster: props.cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [props.ecsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 2,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
      ],
    });

    // =========================================================================
    // ALB Target Group and Rule
    // =========================================================================

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      targetGroupName: 'virtual-env-dashboard',
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/api/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });

    this.service.attachToApplicationTargetGroup(targetGroup);

    // ALB listener rule for dashboard subdomain
    new elbv2.ApplicationListenerRule(this, 'ListenerRule', {
      listener: props.httpsListener,
      priority: 950, // High priority, before dynamic rules
      conditions: [
        elbv2.ListenerCondition.hostHeaders([`dashboard.${props.domainName}`]),
      ],
      targetGroups: [targetGroup],
    });

    // =========================================================================
    // Outputs
    // =========================================================================

    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'ECR Repository URI for dashboard image',
      exportName: `${this.stackName}-RepositoryUri`,
    });

    new cdk.CfnOutput(this, 'ServiceArn', {
      value: this.service.serviceArn,
      description: 'ECS Service ARN',
      exportName: `${this.stackName}-ServiceArn`,
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://dashboard.${props.domainName}`,
      description: 'Dashboard URL',
      exportName: `${this.stackName}-DashboardUrl`,
    });

    new cdk.CfnOutput(this, 'SecretArn', {
      value: dashboardSecret.secretArn,
      description: 'Dashboard secrets ARN (update with real OAuth credentials)',
      exportName: `${this.stackName}-SecretArn`,
    });
  }
}
