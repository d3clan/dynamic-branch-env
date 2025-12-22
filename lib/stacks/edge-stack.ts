import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { DEFAULT_CONFIG, HEADERS } from '../config/environment';

export interface EdgeStackProps extends cdk.StackProps {
  /**
   * The internal ALB to use as the origin
   * CloudFront will connect via VPC Origin
   */
  alb: elbv2.IApplicationLoadBalancer;

  /**
   * The ACM certificate ARN for CloudFront (must be in us-east-1)
   */
  certificateArn: string;

  /**
   * The Route53 hosted zone for creating the wildcard DNS record
   */
  hostedZone: route53.IHostedZone;

  /**
   * The domain name (e.g., 'dev.example.com')
   */
  domainName?: string;
}

/**
 * Edge Stack
 *
 * This stack MUST be deployed to us-east-1 because:
 * - CloudFront requires certificates in us-east-1
 * - WAF for CloudFront must be in us-east-1
 *
 * Creates:
 * - CloudFront distribution with VPC Origin (connects to internal ALB)
 * - CloudFront Function for header injection (x-virtual-env-id)
 * - WAF WebACL with rate limiting and managed rules
 * - Secret for CloudFront-to-origin trust (x-cf-secret)
 * - Wildcard DNS record pointing to CloudFront
 */
export class EdgeStack extends cdk.Stack {
  /**
   * The CloudFront distribution
   */
  public readonly distribution: cloudfront.IDistribution;

  /**
   * The WAF WebACL
   */
  public readonly webAcl: wafv2.CfnWebACL;

  /**
   * Secret for CloudFront-to-origin trust
   */
  public readonly cfSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const domainName = props.domainName ?? DEFAULT_CONFIG.domainName;

    // Create secret for CloudFront-to-origin trust
    this.cfSecret = new secretsmanager.Secret(this, 'CloudFrontSecret', {
      description: 'Secret header value to verify requests came through CloudFront',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'value',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // Import the certificate (must be in us-east-1)
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      props.certificateArn,
    );

    // Create CloudFront Function for header injection
    const headerInjectionFunction = new cloudfront.Function(this, 'HeaderInjectionFunction', {
      functionName: 'virtual-env-header-injection',
      comment: 'Extracts virtual environment ID from subdomain and injects as header',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value : '';

  // Pattern: pr-{number}.{domain}
  // Extracts 'pr-1234' from 'pr-1234.dev.example.com'
  var match = host.match(/^(pr-\\d+)\\./);

  if (match) {
    var virtualEnvId = match[1];
    request.headers['${HEADERS.virtualEnvId}'] = { value: virtualEnvId };
  }

  return request;
}
      `),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // Create WAF WebACL
    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'virtual-env-waf',
      description: 'WAF for virtual environment CloudFront distribution',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'VirtualEnvWaf',
      },
      rules: [
        // Rate limiting rule
        {
          name: 'RateLimitRule',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000, // requests per 5 minutes per IP
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
          },
        },
        // AWS Managed Rules - Common Rule Set
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
          },
        },
        // AWS Managed Rules - Known Bad Inputs
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
          },
        },
      ],
    });

    // Create VPC Origin for the internal ALB
    // This allows CloudFront to connect to the ALB without public internet exposure
    const vpcOrigin = origins.VpcOrigin.withApplicationLoadBalancer(props.alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      connectionAttempts: 3,
      connectionTimeout: cdk.Duration.seconds(10),
      readTimeout: cdk.Duration.seconds(30),
      customHeaders: {
        // Inject the secret header to verify requests came through CloudFront
        [HEADERS.cloudFrontSecret]: this.cfSecret.secretValueFromJson('value').unsafeUnwrap(),
      },
    });

    // Create CloudFront distribution with VPC Origin
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Virtual Environment Preview Distribution',
      domainNames: [`*.${domainName}`],
      certificate,
      defaultBehavior: {
        origin: vpcOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: new cloudfront.OriginRequestPolicy(this, 'OriginRequestPolicy', {
          originRequestPolicyName: 'VirtualEnvOriginRequestPolicy',
          comment: 'Forward all headers except host, plus add custom headers',
          headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
          queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
          cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
        }),
        functionAssociations: [
          {
            function: headerInjectionFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      webAclId: this.webAcl.attrArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only NA and EU edge locations
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Create wildcard DNS record pointing to CloudFront
    new route53.ARecord(this, 'WildcardDnsRecord', {
      zone: props.hostedZone,
      recordName: '*',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      ),
      comment: 'Wildcard record for virtual environment preview URLs',
    });

    // Outputs
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `${this.stackName}-DistributionId`,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
      exportName: `${this.stackName}-DistributionDomainName`,
    });

    new cdk.CfnOutput(this, 'CfSecretArn', {
      value: this.cfSecret.secretArn,
      description: 'CloudFront Secret ARN',
      exportName: `${this.stackName}-CfSecretArn`,
    });

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAcl.attrArn,
      description: 'WAF WebACL ARN',
      exportName: `${this.stackName}-WebAclArn`,
    });

    new cdk.CfnOutput(this, 'PreviewUrlPattern', {
      value: `https://pr-{number}.${domainName}`,
      description: 'Preview URL pattern',
    });
  }
}
