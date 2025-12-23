#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DEFAULT_CONFIG } from '../lib/config/environment';
import { ControlPlaneStack } from '../lib/stacks/control-plane-stack';
import { DashboardStack } from '../lib/stacks/dashboard-stack';
import { DnsCertificateStack } from '../lib/stacks/dns-certificate-stack';
import { EcsClusterStack } from '../lib/stacks/ecs-cluster-stack';
import { EdgeStack } from '../lib/stacks/edge-stack';
import { NetworkStack } from '../lib/stacks/network-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';
import { RoutingStack } from '../lib/stacks/routing-stack';

const app = new cdk.App();

// Get configuration from context or use defaults
const domainName = app.node.tryGetContext('domainName') || DEFAULT_CONFIG.domainName;
const primaryRegion = app.node.tryGetContext('primaryRegion') || DEFAULT_CONFIG.primaryRegion;
const edgeRegion = app.node.tryGetContext('edgeRegion') || DEFAULT_CONFIG.edgeRegion;

// Environment configurations
const primaryEnv: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: primaryRegion,
};

const edgeEnv: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: edgeRegion,
};

// =============================================================================
// Stack Deployment Order:
// 1. Network Stack (VPC, security groups) - Primary Region
// 2. DNS/Certificate Stack (Route53, ACM) - Edge Region (us-east-1)
// 3. Routing Stack (ALB, Cloud Map) - Primary Region (depends on Network, DNS)
// 4. ECS Cluster Stack - Primary Region (depends on Network)
// 5. Edge Stack (CloudFront, WAF) - Edge Region (depends on Routing, DNS)
// 6. Control Plane Stack (Lambda, DynamoDB) - Primary Region (depends on Routing, ECS)
// 7. Observability Stack - Primary Region (depends on Control Plane)
// =============================================================================

// 1. Network Stack
const networkStack = new NetworkStack(app, 'VirtualEnv-Network', {
  env: primaryEnv,
  description: 'Virtual Environment Platform - Network Infrastructure (VPC, Security Groups)',
});

// 2. DNS/Certificate Stack (must be in us-east-1 for CloudFront)
const dnsCertStack = new DnsCertificateStack(app, 'VirtualEnv-DnsCert', {
  env: edgeEnv,
  domainName,
  createHostedZone: true,
  crossRegionReferences: true,
  description: 'Virtual Environment Platform - DNS and Certificates (Route53, ACM)',
});

// 3. Routing Stack
const routingStack = new RoutingStack(app, 'VirtualEnv-Routing', {
  env: primaryEnv,
  vpc: networkStack.vpc,
  albSecurityGroup: networkStack.albSecurityGroup,
  hostedZone: dnsCertStack.hostedZone,
  domainName,
  crossRegionReferences: true,
  description: 'Virtual Environment Platform - Routing (ALB, Cloud Map)',
});
routingStack.addDependency(networkStack);
routingStack.addDependency(dnsCertStack);

// 4. ECS Cluster Stack
const ecsClusterStack = new EcsClusterStack(app, 'VirtualEnv-EcsCluster', {
  env: primaryEnv,
  vpc: networkStack.vpc,
  description: 'Virtual Environment Platform - ECS Cluster',
});
ecsClusterStack.addDependency(networkStack);

// 5. Edge Stack (must be in us-east-1)
// Uses VPC Origin to connect to internal ALB without public internet exposure
const edgeStack = new EdgeStack(app, 'VirtualEnv-Edge', {
  env: edgeEnv,
  alb: routingStack.alb,
  certificateArn: dnsCertStack.certificate.certificateArn,
  hostedZone: dnsCertStack.hostedZone,
  domainName,
  crossRegionReferences: true,
  description: 'Virtual Environment Platform - Edge (CloudFront with VPC Origin, WAF)',
});
edgeStack.addDependency(routingStack);
edgeStack.addDependency(dnsCertStack);

// 6. Control Plane Stack
const controlPlaneStack = new ControlPlaneStack(app, 'VirtualEnv-ControlPlane', {
  env: primaryEnv,
  vpc: networkStack.vpc,
  lambdaSecurityGroup: networkStack.ecsSecurityGroup,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  albListenerArn: routingStack.httpsListener.listenerArn,
  albArn: routingStack.alb.loadBalancerArn,
  vpcId: networkStack.vpc.vpcId,
  namespaceId: routingStack.namespace.namespaceId,
  namespaceArn: routingStack.namespace.namespaceArn,
  ecsClusterArn: ecsClusterStack.cluster.clusterArn,
  taskExecutionRoleArn: ecsClusterStack.taskExecutionRole.roleArn,
  taskRoleArn: ecsClusterStack.taskRole.roleArn,
  ecsLogGroupName: ecsClusterStack.logGroup.logGroupName,
  cfSecretArn: edgeStack.cfSecret.secretArn,
  domainName,
  crossRegionReferences: true,
  description: 'Virtual Environment Platform - Control Plane (Lambda, DynamoDB, EventBridge)',
});
controlPlaneStack.addDependency(routingStack);
controlPlaneStack.addDependency(ecsClusterStack);
controlPlaneStack.addDependency(edgeStack);

// 7. Dashboard Stack
const dashboardStack = new DashboardStack(app, 'VirtualEnv-Dashboard', {
  env: primaryEnv,
  vpc: networkStack.vpc,
  cluster: ecsClusterStack.cluster,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  httpsListener: routingStack.httpsListener,
  environmentsTableArn: controlPlaneStack.environmentsTable.tableArn,
  routingConfigTableArn: controlPlaneStack.routingConfigTable.tableArn,
  prioritiesTableArn: controlPlaneStack.prioritiesTable.tableArn,
  distributionId: edgeStack.distribution.distributionId,
  cloudfrontFunctionName: 'virtual-env-header-injection',
  albListenerArn: routingStack.httpsListener.listenerArn,
  domainName,
  githubOAuthClientId: app.node.tryGetContext('githubOAuthClientId'),
  githubOrgName: app.node.tryGetContext('githubOrgName'),
  crossRegionReferences: true,
  description: 'Virtual Environment Platform - Management Dashboard',
});
dashboardStack.addDependency(controlPlaneStack);
dashboardStack.addDependency(edgeStack);

// 8. Observability Stack
const observabilityStack = new ObservabilityStack(app, 'VirtualEnv-Observability', {
  env: primaryEnv,
  webhookHandler: controlPlaneStack.webhookHandler,
  environmentController: controlPlaneStack.environmentController,
  cleanupHandler: controlPlaneStack.cleanupHandler,
  environmentsTable: controlPlaneStack.environmentsTable,
  albListenerArn: routingStack.httpsListener.listenerArn,
  distributionId: edgeStack.distribution.distributionId,
  crossRegionReferences: true,
  description: 'Virtual Environment Platform - Observability (Dashboards, Alarms)',
});
observabilityStack.addDependency(controlPlaneStack);
observabilityStack.addDependency(edgeStack);

// Add tags to all stacks
const tags = cdk.Tags.of(app);
tags.add('Project', 'VirtualEnvironmentPlatform');
tags.add('ManagedBy', 'CDK');

app.synth();
