import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  /**
   * Webhook handler Lambda function
   */
  webhookHandler: lambda.IFunction;

  /**
   * Environment controller Lambda function
   */
  environmentController: lambda.IFunction;

  /**
   * Cleanup handler Lambda function
   */
  cleanupHandler: lambda.IFunction;

  /**
   * Virtual environments DynamoDB table
   */
  environmentsTable: dynamodb.ITable;

  /**
   * ALB Listener ARN for rule count monitoring
   */
  albListenerArn: string;

  /**
   * CloudFront distribution ID
   */
  distributionId: string;
}

/**
 * Observability Stack
 *
 * Creates:
 * - CloudWatch dashboard for virtual environment metrics
 * - Alarms for critical thresholds (ALB rules, errors, etc.)
 * - SNS topic for alerts
 */
export class ObservabilityStack extends cdk.Stack {
  /**
   * CloudWatch dashboard
   */
  public readonly dashboard: cloudwatch.Dashboard;

  /**
   * SNS topic for alerts
   */
  public readonly alertTopic: sns.ITopic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // Create SNS topic for alerts
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'virtual-env-alerts',
      displayName: 'Virtual Environment Platform Alerts',
    });

    // Create CloudWatch dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'VirtualEnvironments',
    });

    // =========================================================================
    // Lambda Metrics
    // =========================================================================

    const webhookInvocations = props.webhookHandler.metricInvocations({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const webhookErrors = props.webhookHandler.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const webhookDuration = props.webhookHandler.metricDuration({
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
    });

    const controllerInvocations = props.environmentController.metricInvocations({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const controllerErrors = props.environmentController.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const controllerDuration = props.environmentController.metricDuration({
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
    });

    const cleanupInvocations = props.cleanupHandler.metricInvocations({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const cleanupErrors = props.cleanupHandler.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    // =========================================================================
    // DynamoDB Metrics
    // =========================================================================

    const dynamoReadCapacity = props.environmentsTable.metricConsumedReadCapacityUnits({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const dynamoWriteCapacity = props.environmentsTable.metricConsumedWriteCapacityUnits({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    // =========================================================================
    // Custom Metrics (to be emitted by Lambda functions)
    // =========================================================================

    const activeEnvironments = new cloudwatch.Metric({
      namespace: 'VirtualEnvironments',
      metricName: 'ActiveEnvironments',
      period: cdk.Duration.minutes(5),
      statistic: 'Maximum',
    });

    const albRuleCount = new cloudwatch.Metric({
      namespace: 'VirtualEnvironments',
      metricName: 'AlbRuleCount',
      period: cdk.Duration.minutes(5),
      statistic: 'Maximum',
    });

    const environmentCreationDuration = new cloudwatch.Metric({
      namespace: 'VirtualEnvironments',
      metricName: 'EnvironmentCreationDuration',
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
      unit: cloudwatch.Unit.SECONDS,
    });

    const environmentDestructionDuration = new cloudwatch.Metric({
      namespace: 'VirtualEnvironments',
      metricName: 'EnvironmentDestructionDuration',
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
      unit: cloudwatch.Unit.SECONDS,
    });

    // =========================================================================
    // Dashboard Widgets
    // =========================================================================

    // Row 1: Overview
    this.dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Active Environments',
        metrics: [activeEnvironments],
        width: 6,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'ALB Rule Usage',
        metrics: [albRuleCount],
        width: 6,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [webhookErrors, controllerErrors, cleanupErrors],
        width: 12,
        height: 4,
      }),
    );

    // Row 2: Lambda Performance
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Webhook Handler',
        left: [webhookInvocations],
        right: [webhookDuration],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Environment Controller',
        left: [controllerInvocations],
        right: [controllerDuration],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Cleanup Handler',
        left: [cleanupInvocations],
        right: [cleanupErrors],
        width: 8,
        height: 6,
      }),
    );

    // Row 3: Environment Lifecycle
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Environment Creation Time',
        left: [environmentCreationDuration],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Environment Destruction Time',
        left: [environmentDestructionDuration],
        width: 12,
        height: 6,
      }),
    );

    // Row 4: DynamoDB
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Capacity',
        left: [dynamoReadCapacity],
        right: [dynamoWriteCapacity],
        width: 24,
        height: 6,
      }),
    );

    // =========================================================================
    // Alarms
    // =========================================================================

    // Alarm: High error rate on webhook handler
    const webhookErrorAlarm = new cloudwatch.Alarm(this, 'WebhookErrorAlarm', {
      alarmName: 'VirtualEnv-WebhookErrors',
      alarmDescription: 'High error rate on webhook handler',
      metric: webhookErrors,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    webhookErrorAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // Alarm: High error rate on environment controller
    const controllerErrorAlarm = new cloudwatch.Alarm(this, 'ControllerErrorAlarm', {
      alarmName: 'VirtualEnv-ControllerErrors',
      alarmDescription: 'High error rate on environment controller',
      metric: controllerErrors,
      threshold: 3,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    controllerErrorAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // Alarm: ALB rule count approaching limit
    const albRuleAlarm = new cloudwatch.Alarm(this, 'AlbRuleCountAlarm', {
      alarmName: 'VirtualEnv-AlbRuleCount',
      alarmDescription: 'ALB rule count approaching limit (70%)',
      metric: albRuleCount,
      threshold: 70, // 70% of 100 rule limit
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    albRuleAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // Alarm: Long environment creation time
    const creationTimeAlarm = new cloudwatch.Alarm(this, 'CreationTimeAlarm', {
      alarmName: 'VirtualEnv-CreationTime',
      alarmDescription: 'Environment creation taking too long (>5 minutes)',
      metric: environmentCreationDuration,
      threshold: 300, // 5 minutes in seconds
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    creationTimeAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // =========================================================================
    // Outputs
    // =========================================================================

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      description: 'SNS Alert Topic ARN',
      exportName: `${this.stackName}-AlertTopicArn`,
    });
  }
}
