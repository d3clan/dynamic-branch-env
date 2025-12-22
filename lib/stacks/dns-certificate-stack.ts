import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { DEFAULT_CONFIG } from '../config/environment';

export interface DnsCertificateStackProps extends cdk.StackProps {
  /**
   * The domain name for preview environments (e.g., 'dev.example.com')
   * Preview URLs will be: pr-{number}.{domainName}
   */
  domainName?: string;

  /**
   * Whether to create a new hosted zone or look up an existing one
   * @default true (create new)
   */
  createHostedZone?: boolean;

  /**
   * If using an existing hosted zone, provide its ID
   */
  existingHostedZoneId?: string;
}

/**
 * DNS and Certificate Stack
 *
 * This stack should be deployed to us-east-1 because CloudFront
 * requires certificates to be in that region.
 *
 * Creates:
 * - Route53 public hosted zone (or uses existing)
 * - Wildcard ACM certificate for CloudFront (validated via DNS)
 */
export class DnsCertificateStack extends cdk.Stack {
  /**
   * The Route53 hosted zone for the domain
   */
  public readonly hostedZone: route53.IHostedZone;

  /**
   * The wildcard certificate for CloudFront (*.{domainName})
   * This certificate is in us-east-1 as required by CloudFront
   */
  public readonly certificate: acm.ICertificate;

  /**
   * The domain name being used
   */
  public readonly domainName: string;

  constructor(scope: Construct, id: string, props?: DnsCertificateStackProps) {
    super(scope, id, props);

    this.domainName = props?.domainName ?? DEFAULT_CONFIG.domainName;
    const createHostedZone = props?.createHostedZone ?? true;

    // Create or lookup the hosted zone
    if (createHostedZone) {
      this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
        zoneName: this.domainName,
        comment: 'Hosted zone for virtual environment preview URLs',
      });
    } else {
      if (!props?.existingHostedZoneId) {
        throw new Error('existingHostedZoneId is required when createHostedZone is false');
      }
      this.hostedZone = route53.PublicHostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.existingHostedZoneId,
        zoneName: this.domainName,
      });
    }

    // Create wildcard certificate for CloudFront
    // This must be in us-east-1 for CloudFront to use it
    this.certificate = new acm.Certificate(this, 'WildcardCertificate', {
      domainName: `*.${this.domainName}`,
      subjectAlternativeNames: [this.domainName], // Also include the apex domain
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
      certificateName: `${this.domainName}-wildcard`,
    });

    // Outputs
    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.hostedZone.hostedZoneId,
      description: 'Route53 Hosted Zone ID',
      exportName: `${this.stackName}-HostedZoneId`,
    });

    new cdk.CfnOutput(this, 'HostedZoneName', {
      value: this.hostedZone.zoneName,
      description: 'Route53 Hosted Zone Name',
      exportName: `${this.stackName}-HostedZoneName`,
    });

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      description: 'ACM Certificate ARN (for CloudFront)',
      exportName: `${this.stackName}-CertificateArn`,
    });

    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(', ', this.hostedZone.hostedZoneNameServers || []),
      description: 'Name servers for the hosted zone (configure these at your registrar)',
    });
  }
}
