import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import {
  DEFAULT_CONFIG,
  TABLE_NAMES,
  EVENTBRIDGE_CONFIG,
} from '../config/environment';

export interface ControlPlaneStackProps extends cdk.StackProps {
  /**
   * VPC for Lambda functions that need VPC access
   */
  vpc: ec2.IVpc;

  /**
   * Security group for Lambda functions
   */
  lambdaSecurityGroup: ec2.ISecurityGroup;

  /**
   * Security group for ECS services
   */
  ecsSecurityGroup: ec2.ISecurityGroup;

  /**
   * ALB HTTPS Listener ARN for rule management
   */
  albListenerArn: string;

  /**
   * ALB ARN for target group association
   */
  albArn: string;

  /**
   * VPC ID for target group creation
   */
  vpcId: string;

  /**
   * Cloud Map Namespace ID for service discovery
   */
  namespaceId: string;

  /**
   * Cloud Map Namespace ARN
   */
  namespaceArn: string;

  /**
   * ECS Cluster ARN
   */
  ecsClusterArn: string;

  /**
   * ECS Task Execution Role ARN
   */
  taskExecutionRoleArn: string;

  /**
   * ECS Task Role ARN
   */
  taskRoleArn: string;

  /**
   * CloudWatch Log Group name for ECS tasks
   */
  ecsLogGroupName: string;

  /**
   * CloudFront secret ARN for trust verification
   */
  cfSecretArn: string;

  /**
   * Domain name for preview URLs
   */
  domainName?: string;
}

/**
 * Control Plane Stack
 *
 * Creates:
 * - DynamoDB tables for state management
 * - Lambda functions for webhook handling and environment lifecycle
 * - EventBridge event bus and rules
 * - API Gateway for GitHub webhook endpoint
 * - Secrets for GitHub App credentials
 */
export class ControlPlaneStack extends cdk.Stack {
  /**
   * Virtual environments DynamoDB table
   */
  public readonly environmentsTable: dynamodb.Table;

  /**
   * Routing configuration DynamoDB table
   */
  public readonly routingConfigTable: dynamodb.Table;

  /**
   * ALB rule priorities DynamoDB table
   */
  public readonly prioritiesTable: dynamodb.Table;

  /**
   * EventBridge event bus
   */
  public readonly eventBus: events.IEventBus;

  /**
   * GitHub webhook handler Lambda
   */
  public readonly webhookHandler: lambda.IFunction;

  /**
   * Environment controller Lambda
   */
  public readonly environmentController: lambda.IFunction;

  /**
   * Cleanup handler Lambda
   */
  public readonly cleanupHandler: lambda.IFunction;

  /**
   * API Gateway for webhooks
   */
  public readonly webhookApi: apigateway.HttpApi;

  /**
   * GitHub App secrets
   */
  public readonly githubAppSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);

    const domainName = props.domainName ?? DEFAULT_CONFIG.domainName;

    // =========================================================================
    // DynamoDB Tables
    // =========================================================================

    // Virtual Environments Table
    this.environmentsTable = new dynamodb.Table(this, 'EnvironmentsTable', {
      tableName: TABLE_NAMES.virtualEnvironments,
      partitionKey: { name: 'virtualEnvId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev - change for production
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      stream: dynamodb.StreamViewType.OLD_IMAGE, // For TTL cleanup handling
    });

    // GSI for querying by status
    this.environmentsTable.addGlobalSecondaryIndex({
      indexName: 'status-expiresAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'expiresAt', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by repository
    this.environmentsTable.addGlobalSecondaryIndex({
      indexName: 'repository-virtualEnvId-index',
      partitionKey: { name: 'repository', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'virtualEnvId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Routing Configuration Table
    this.routingConfigTable = new dynamodb.Table(this, 'RoutingConfigTable', {
      tableName: TABLE_NAMES.routingConfig,
      partitionKey: { name: 'serviceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'virtualEnvId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI for querying by virtualEnvId
    this.routingConfigTable.addGlobalSecondaryIndex({
      indexName: 'virtualEnvId-serviceId-index',
      partitionKey: { name: 'virtualEnvId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'serviceId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ALB Rule Priorities Table
    this.prioritiesTable = new dynamodb.Table(this, 'PrioritiesTable', {
      tableName: TABLE_NAMES.albRulePriorities,
      partitionKey: { name: 'listenerArn', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'priority', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // Secrets
    // =========================================================================

    // GitHub App credentials secret
    this.githubAppSecret = new secretsmanager.Secret(this, 'GitHubAppSecret', {
      description: 'GitHub App credentials for virtual environment platform',
      secretObjectValue: {
        appId: cdk.SecretValue.unsafePlainText('PLACEHOLDER_APP_ID'),
        privateKey: cdk.SecretValue.unsafePlainText('PLACEHOLDER_PRIVATE_KEY'),
        webhookSecret: cdk.SecretValue.unsafePlainText('PLACEHOLDER_WEBHOOK_SECRET'),
      },
    });

    // =========================================================================
    // EventBridge
    // =========================================================================

    // Custom event bus for virtual environment events
    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: EVENTBRIDGE_CONFIG.eventBusName,
    });

    // =========================================================================
    // Lambda Functions
    // =========================================================================

    // Get private subnet IDs for ECS service deployment
    const privateSubnetIds = props.vpc.privateSubnets.map(subnet => subnet.subnetId).join(',');

    // Common Lambda configuration
    const lambdaEnvironment = {
      ENVIRONMENTS_TABLE_NAME: this.environmentsTable.tableName,
      ROUTING_CONFIG_TABLE_NAME: this.routingConfigTable.tableName,
      PRIORITIES_TABLE_NAME: this.prioritiesTable.tableName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      ALB_LISTENER_ARN: props.albListenerArn,
      ALB_ARN: props.albArn,
      VPC_ID: props.vpcId,
      VPC_SUBNET_IDS: privateSubnetIds,
      ECS_SECURITY_GROUP_ID: props.ecsSecurityGroup.securityGroupId,
      NAMESPACE_ID: props.namespaceId,
      ECS_CLUSTER_ARN: props.ecsClusterArn,
      TASK_EXECUTION_ROLE_ARN: props.taskExecutionRoleArn,
      TASK_ROLE_ARN: props.taskRoleArn,
      ECS_LOG_GROUP_NAME: props.ecsLogGroupName,
      CF_SECRET_ARN: props.cfSecretArn,
      GITHUB_APP_SECRET_ARN: this.githubAppSecret.secretArn,
      DOMAIN_NAME: domainName,
      DEFAULT_TTL_HOURS: DEFAULT_CONFIG.defaultTtlHours.toString(),
      MAX_TTL_HOURS: DEFAULT_CONFIG.maxTtlHours.toString(),
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Webhook Handler Lambda
    this.webhookHandler = new lambdaNodejs.NodejsFunction(this, 'WebhookHandler', {
      functionName: 'virtual-env-webhook-handler',
      description: 'Handles GitHub App webhooks for virtual environment lifecycle',
      entry: path.join(__dirname, '../lambdas/webhook-handler/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: lambdaEnvironment,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Environment Controller Lambda (VPC-enabled for ECS/ALB access)
    this.environmentController = new lambdaNodejs.NodejsFunction(this, 'EnvironmentController', {
      functionName: 'virtual-env-controller',
      description: 'Manages virtual environment lifecycle (create/update/destroy)',
      entry: path.join(__dirname, '../lambdas/environment-controller/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: lambdaEnvironment,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Cleanup Handler Lambda
    this.cleanupHandler = new lambdaNodejs.NodejsFunction(this, 'CleanupHandler', {
      functionName: 'virtual-env-cleanup-handler',
      description: 'Scheduled cleanup of expired virtual environments',
      entry: path.join(__dirname, '../lambdas/cleanup-handler/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: lambdaEnvironment,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // =========================================================================
    // IAM Permissions
    // =========================================================================

    // Webhook Handler permissions
    this.githubAppSecret.grantRead(this.webhookHandler);
    this.eventBus.grantPutEventsTo(this.webhookHandler);

    // Environment Controller permissions
    this.environmentsTable.grantReadWriteData(this.environmentController);
    this.routingConfigTable.grantReadWriteData(this.environmentController);
    this.prioritiesTable.grantReadWriteData(this.environmentController);
    this.githubAppSecret.grantRead(this.environmentController);

    // ECS permissions for environment controller
    this.environmentController.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:CreateService',
          'ecs:UpdateService',
          'ecs:DeleteService',
          'ecs:DescribeServices',
          'ecs:RegisterTaskDefinition',
          'ecs:DeregisterTaskDefinition',
          'ecs:DescribeTaskDefinition',
          'ecs:ListTasks',
          'ecs:DescribeTasks',
        ],
        resources: ['*'], // Scope down in production
      }),
    );

    // ALB permissions for environment controller
    this.environmentController.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'elasticloadbalancing:CreateRule',
          'elasticloadbalancing:DeleteRule',
          'elasticloadbalancing:ModifyRule',
          'elasticloadbalancing:DescribeRules',
          'elasticloadbalancing:CreateTargetGroup',
          'elasticloadbalancing:DeleteTargetGroup',
          'elasticloadbalancing:ModifyTargetGroup',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:RegisterTargets',
          'elasticloadbalancing:DeregisterTargets',
          'elasticloadbalancing:DescribeTargetHealth',
        ],
        resources: ['*'], // Scope down in production
      }),
    );

    // Cloud Map permissions for environment controller
    this.environmentController.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'servicediscovery:CreateService',
          'servicediscovery:DeleteService',
          'servicediscovery:GetService',
          'servicediscovery:RegisterInstance',
          'servicediscovery:DeregisterInstance',
          'servicediscovery:ListInstances',
        ],
        resources: ['*'], // Scope down in production
      }),
    );

    // IAM pass role for ECS task execution
    this.environmentController.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: ['*'], // Scope to specific task roles in production
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
          },
        },
      }),
    );

    // Cleanup Handler permissions
    this.environmentsTable.grantReadWriteData(this.cleanupHandler);
    this.routingConfigTable.grantReadData(this.cleanupHandler);
    this.eventBus.grantPutEventsTo(this.cleanupHandler);

    // =========================================================================
    // EventBridge Rules
    // =========================================================================

    // Rule for PR opened/reopened - triggers CREATE
    new events.Rule(this, 'PrOpenedRule', {
      ruleName: 'virtual-env-pr-opened',
      description: 'Trigger environment creation when PR is opened',
      eventBus: this.eventBus,
      eventPattern: {
        source: [EVENTBRIDGE_CONFIG.githubEventSource],
        detailType: ['PullRequestEvent'],
        detail: {
          action: ['CREATE'],
        },
      },
      targets: [new eventsTargets.LambdaFunction(this.environmentController)],
    });

    // Rule for PR synchronized - triggers UPDATE
    new events.Rule(this, 'PrSyncRule', {
      ruleName: 'virtual-env-pr-sync',
      description: 'Trigger environment update when PR is synchronized',
      eventBus: this.eventBus,
      eventPattern: {
        source: [EVENTBRIDGE_CONFIG.githubEventSource],
        detailType: ['PullRequestEvent'],
        detail: {
          action: ['UPDATE'],
        },
      },
      targets: [new eventsTargets.LambdaFunction(this.environmentController)],
    });

    // Rule for PR closed - triggers DESTROY
    new events.Rule(this, 'PrClosedRule', {
      ruleName: 'virtual-env-pr-closed',
      description: 'Trigger environment cleanup when PR is closed',
      eventBus: this.eventBus,
      eventPattern: {
        source: [EVENTBRIDGE_CONFIG.githubEventSource],
        detailType: ['PullRequestEvent'],
        detail: {
          action: ['DESTROY'],
        },
      },
      targets: [new eventsTargets.LambdaFunction(this.environmentController)],
    });

    // Scheduled cleanup rule (every 15 minutes)
    new events.Rule(this, 'ScheduledCleanupRule', {
      ruleName: 'virtual-env-scheduled-cleanup',
      description: 'Scheduled cleanup of expired virtual environments',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new eventsTargets.LambdaFunction(this.cleanupHandler)],
    });

    // =========================================================================
    // API Gateway
    // =========================================================================

    // HTTP API for GitHub webhooks
    this.webhookApi = new apigateway.HttpApi(this, 'WebhookApi', {
      apiName: 'virtual-env-webhook-api',
      description: 'API Gateway for GitHub webhook events',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigateway.CorsHttpMethod.POST],
        allowHeaders: ['content-type', 'x-github-event', 'x-hub-signature-256'],
      },
    });

    // Add webhook route
    this.webhookApi.addRoutes({
      path: '/webhook',
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'WebhookIntegration',
        this.webhookHandler,
      ),
    });

    // =========================================================================
    // Outputs
    // =========================================================================

    new cdk.CfnOutput(this, 'WebhookApiUrl', {
      value: `${this.webhookApi.apiEndpoint}/webhook`,
      description: 'GitHub Webhook URL',
      exportName: `${this.stackName}-WebhookApiUrl`,
    });

    new cdk.CfnOutput(this, 'EnvironmentsTableName', {
      value: this.environmentsTable.tableName,
      description: 'Virtual Environments DynamoDB Table Name',
      exportName: `${this.stackName}-EnvironmentsTableName`,
    });

    new cdk.CfnOutput(this, 'RoutingConfigTableName', {
      value: this.routingConfigTable.tableName,
      description: 'Routing Config DynamoDB Table Name',
      exportName: `${this.stackName}-RoutingConfigTableName`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge Event Bus Name',
      exportName: `${this.stackName}-EventBusName`,
    });

    new cdk.CfnOutput(this, 'GitHubAppSecretArn', {
      value: this.githubAppSecret.secretArn,
      description: 'GitHub App Secret ARN (update with real credentials)',
      exportName: `${this.stackName}-GitHubAppSecretArn`,
    });
  }
}
