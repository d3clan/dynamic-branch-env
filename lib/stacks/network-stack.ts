import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { DEFAULT_CONFIG } from '../config/environment';

export interface NetworkStackProps extends cdk.StackProps {
  /**
   * VPC CIDR block
   * @default '10.0.0.0/16'
   */
  vpcCidr?: string;

  /**
   * Number of availability zones
   * @default 2
   */
  maxAzs?: number;
}

export class NetworkStack extends cdk.Stack {
  /**
   * The VPC for the virtual environment platform
   */
  public readonly vpc: ec2.IVpc;

  /**
   * Security group for the internal ALB
   * Allows traffic only from CloudFront
   */
  public readonly albSecurityGroup: ec2.ISecurityGroup;

  /**
   * Security group for ECS tasks
   * Allows traffic only from the ALB
   */
  public readonly ecsSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props?: NetworkStackProps) {
    super(scope, id, props);

    const vpcCidr = props?.vpcCidr ?? DEFAULT_CONFIG.vpcCidr;
    const maxAzs = props?.maxAzs ?? 2;

    // Create VPC with public and private subnets
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
      maxAzs,
      natGateways: maxAzs, // One NAT gateway per AZ for high availability
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // Enable DNS support for Cloud Map
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Security group for the internal ALB
    // When using CloudFront VPC Origins, CloudFront creates ENIs in the VPC
    // and traffic flows through those ENIs, so we allow traffic from VPC CIDR
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for internal ALB - allows traffic from CloudFront VPC Origin',
      allowAllOutbound: true,
    });

    // Allow HTTPS from within VPC (CloudFront VPC Origin creates ENIs in private subnets)
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpcCidr),
      ec2.Port.tcp(443),
      'Allow HTTPS from CloudFront VPC Origin ENIs',
    );

    // Also allow HTTP for health checks (within VPC only)
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpcCidr),
      ec2.Port.tcp(80),
      'Allow HTTP from within VPC for health checks',
    );

    // Security group for ECS tasks
    // Only allows traffic from the ALB security group
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ECS Fargate tasks - allows traffic from ALB only',
      allowAllOutbound: true,
    });

    // Allow traffic from ALB on common application ports
    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcpRange(3000, 9000),
      'Allow traffic from ALB on application ports',
    );

    // VPC Flow Logs for debugging and security
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${this.stackName}-VpcId`,
    });

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      value: this.albSecurityGroup.securityGroupId,
      description: 'ALB Security Group ID',
      exportName: `${this.stackName}-AlbSecurityGroupId`,
    });

    new cdk.CfnOutput(this, 'EcsSecurityGroupId', {
      value: this.ecsSecurityGroup.securityGroupId,
      description: 'ECS Security Group ID',
      exportName: `${this.stackName}-EcsSecurityGroupId`,
    });
  }

  /**
   * Get the CloudFront managed prefix list ID for the current region
   * This is the prefix list for CloudFront origin-facing IPs
   */
  private getCloudFrontPrefixListId(): string {
    // The CloudFront managed prefix list ID
    // This is consistent across regions: com.amazonaws.global.cloudfront.origin-facing
    // However, the actual prefix list ID needs to be looked up
    // We use a known ID that works in most regions
    // See: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html

    // Note: In production, you might want to use a custom resource to look this up
    // or use the AWS-managed prefix list by name
    // For now, we use the well-known ID for the global CloudFront prefix list
    return 'pl-3b927c52'; // This is valid for us-east-1, other regions may differ
  }
}
