import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { DEFAULT_CONFIG } from '../config/environment';

export interface RoutingStackProps extends cdk.StackProps {
  /**
   * The VPC to deploy the ALB into
   */
  vpc: ec2.IVpc;

  /**
   * Security group for the ALB
   */
  albSecurityGroup: ec2.ISecurityGroup;

  /**
   * The Route53 hosted zone for DNS validation and internal DNS
   */
  hostedZone: route53.IHostedZone;

  /**
   * The domain name (e.g., 'dev.example.com')
   */
  domainName?: string;

  /**
   * The internal domain name for service discovery (e.g., 'internal-dev.example.com')
   */
  internalDomainName?: string;
}

/**
 * Routing Stack
 *
 * Creates:
 * - Internal Application Load Balancer
 * - HTTPS listener with regional certificate
 * - Cloud Map private DNS namespace for service discovery
 * - Default target group for steady-state fallback
 */
export class RoutingStack extends cdk.Stack {
  /**
   * The internal Application Load Balancer
   */
  public readonly alb: elbv2.IApplicationLoadBalancer;

  /**
   * The HTTPS listener on the ALB
   */
  public readonly httpsListener: elbv2.IApplicationListener;

  /**
   * The Cloud Map namespace for service discovery
   */
  public readonly namespace: servicediscovery.IPrivateDnsNamespace;

  /**
   * The regional certificate for the ALB
   */
  public readonly regionalCertificate: acm.ICertificate;

  /**
   * Default target group for fallback (returns 503)
   */
  public readonly defaultTargetGroup: elbv2.IApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: RoutingStackProps) {
    super(scope, id, props);

    const domainName = props.domainName ?? DEFAULT_CONFIG.domainName;
    const internalDomainName = props.internalDomainName ?? DEFAULT_CONFIG.internalDomainName;

    // Create regional certificate for ALB (in the same region as the ALB)
    this.regionalCertificate = new acm.Certificate(this, 'RegionalCertificate', {
      domainName: `*.${domainName}`,
      subjectAlternativeNames: [domainName],
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
      certificateName: `${domainName}-regional`,
    });

    // Create internal Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'InternalAlb', {
      vpc: props.vpc,
      internetFacing: false, // Internal only - CloudFront is the edge
      securityGroup: props.albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      loadBalancerName: 'virtual-env-alb',
    });

    // Default target group that returns 503 when no services match
    // This ensures predictable behavior when a feature service doesn't exist
    this.defaultTargetGroup = new elbv2.ApplicationTargetGroup(this, 'DefaultTargetGroup', {
      vpc: props.vpc,
      targetType: elbv2.TargetType.IP,
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 80,
      healthCheck: {
        enabled: true,
        path: '/health',
        healthyHttpCodes: '200-499', // Accept any response for default
      },
      targetGroupName: 'virtual-env-default',
    });

    // Create HTTPS listener
    this.httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [this.regionalCertificate],
      defaultAction: elbv2.ListenerAction.fixedResponse(503, {
        contentType: 'application/json',
        messageBody: JSON.stringify({
          error: 'Service not found',
          message: 'No matching service for this request. Check x-virtual-env-id header.',
        }),
      }),
      sslPolicy: elbv2.SslPolicy.TLS12,
    });

    // Also add HTTP listener for health checks from within VPC
    this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(301, {
        contentType: 'text/plain',
        messageBody: 'Redirect to HTTPS',
      }),
    });

    // Create Cloud Map private DNS namespace for service discovery
    this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
      name: internalDomainName,
      vpc: props.vpc,
      description: 'Service discovery namespace for virtual environments',
    });

    // Outputs
    new cdk.CfnOutput(this, 'AlbArn', {
      value: this.alb.loadBalancerArn,
      description: 'ALB ARN',
      exportName: `${this.stackName}-AlbArn`,
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'ALB DNS Name (for CloudFront origin)',
      exportName: `${this.stackName}-AlbDnsName`,
    });

    new cdk.CfnOutput(this, 'HttpsListenerArn', {
      value: this.httpsListener.listenerArn,
      description: 'HTTPS Listener ARN',
      exportName: `${this.stackName}-HttpsListenerArn`,
    });

    new cdk.CfnOutput(this, 'NamespaceId', {
      value: this.namespace.namespaceId,
      description: 'Cloud Map Namespace ID',
      exportName: `${this.stackName}-NamespaceId`,
    });

    new cdk.CfnOutput(this, 'NamespaceArn', {
      value: this.namespace.namespaceArn,
      description: 'Cloud Map Namespace ARN',
      exportName: `${this.stackName}-NamespaceArn`,
    });

    new cdk.CfnOutput(this, 'RegionalCertificateArn', {
      value: this.regionalCertificate.certificateArn,
      description: 'Regional ACM Certificate ARN',
      exportName: `${this.stackName}-RegionalCertificateArn`,
    });
  }
}
