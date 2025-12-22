import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface EcsClusterStackProps extends cdk.StackProps {
  /**
   * The VPC to deploy the ECS cluster into
   */
  vpc: ec2.IVpc;
}

/**
 * ECS Cluster Stack
 *
 * Creates:
 * - Shared ECS Fargate cluster for steady-state and preview services
 * - Task execution role with necessary permissions
 * - Task role for application permissions
 * - CloudWatch log group for container logs
 */
export class EcsClusterStack extends cdk.Stack {
  /**
   * The ECS Fargate cluster
   */
  public readonly cluster: ecs.ICluster;

  /**
   * Task execution role for ECS tasks
   */
  public readonly taskExecutionRole: iam.Role;

  /**
   * Task role for application permissions
   */
  public readonly taskRole: iam.Role;

  /**
   * CloudWatch log group for container logs
   */
  public readonly logGroup: logs.ILogGroup;

  constructor(scope: Construct, id: string, props: EcsClusterStackProps) {
    super(scope, id, props);

    // Create CloudWatch log group for container logs
    this.logGroup = new logs.LogGroup(this, 'ContainerLogs', {
      logGroupName: '/ecs/virtual-environments',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create ECS cluster with Container Insights enabled
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      clusterName: 'virtual-env-cluster',
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      enableFargateCapacityProviders: true,
    });

    // Task execution role - used by ECS to pull images and write logs
    this.taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: 'virtual-env-task-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Additional permissions for task execution role
    this.taskExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [this.logGroup.logGroupArn, `${this.logGroup.logGroupArn}:*`],
      }),
    );

    // Permission to read secrets for environment variables
    this.taskExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'secretsmanager:GetSecretValue',
        ],
        resources: ['*'], // Scope down in production
        conditions: {
          StringEquals: {
            'aws:ResourceTag/virtual-env': 'true',
          },
        },
      }),
    );

    // Permission to read SSM parameters
    this.taskExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameters',
          'ssm:GetParameter',
        ],
        resources: ['*'], // Scope down in production
      }),
    );

    // Task role - used by the application running in the container
    this.taskRole = new iam.Role(this, 'TaskRole', {
      roleName: 'virtual-env-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Add common permissions for applications
    // Applications can use X-Ray for tracing
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
        ],
        resources: ['*'],
      }),
    );

    // Applications can write metrics to CloudWatch
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'VirtualEnvironments',
          },
        },
      }),
    );

    // Applications can discover services via Cloud Map
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'servicediscovery:DiscoverInstances',
        ],
        resources: ['*'],
      }),
    );

    // Outputs
    new cdk.CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'ECS Cluster ARN',
      exportName: `${this.stackName}-ClusterArn`,
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS Cluster Name',
      exportName: `${this.stackName}-ClusterName`,
    });

    new cdk.CfnOutput(this, 'TaskExecutionRoleArn', {
      value: this.taskExecutionRole.roleArn,
      description: 'Task Execution Role ARN',
      exportName: `${this.stackName}-TaskExecutionRoleArn`,
    });

    new cdk.CfnOutput(this, 'TaskRoleArn', {
      value: this.taskRole.roleArn,
      description: 'Task Role ARN',
      exportName: `${this.stackName}-TaskRoleArn`,
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: this.logGroup.logGroupName,
      description: 'CloudWatch Log Group Name',
      exportName: `${this.stackName}-LogGroupName`,
    });
  }
}
