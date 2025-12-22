# Virtual Environment Platform

[![CI](https://github.com/YOUR_ORG/dynamic-branch-env/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/dynamic-branch-env/actions/workflows/ci.yml)

> **Note:** Replace `YOUR_ORG` in the badge URL with your GitHub organization/username.

A serverless AWS CDK infrastructure for PR-scoped ephemeral preview environments. This platform enables true continuous delivery by automatically provisioning isolated environments for each pull request, allowing developers and stakeholders to preview changes before merging to trunk.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Development Workflow](#development-workflow)
- [Infrastructure Components](#infrastructure-components)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Security](#security)
- [Operational Considerations](#operational-considerations)

---

## Overview

The Virtual Environment Platform solves the challenge of previewing feature branches in isolation without disrupting shared development environments. Each pull request gets its own dedicated preview URL (`pr-1234.dev.example.com`) that routes to isolated service instances running the feature branch code.

### Key Features

- **Automatic Provisioning**: Environments spin up automatically when PRs are opened
- **Deterministic Routing**: Header-based routing ensures requests reach the correct feature services
- **Zero Infrastructure Overhead**: Serverless control plane with pay-per-use pricing
- **Automatic Cleanup**: TTL-based expiration ensures resources don't accumulate
- **Security-First Design**: Internal ALB with VPC Origins, WAF protection, and secret-based trust

---

## Architecture

### High-Level Architecture

```mermaid
flowchart TB
    subgraph Internet
        Developer[Developer Browser]
        GitHub[GitHub]
    end

    subgraph AWS["AWS Cloud"]
        subgraph Edge["Edge Layer (us-east-1)"]
            CF[CloudFront Distribution]
            WAF[WAF WebACL]
            CFF[CloudFront Function<br/>Header Injection]
        end

        subgraph Primary["Primary Region"]
            subgraph VPC["VPC"]
                subgraph Private["Private Subnets"]
                    ALB[Internal ALB]

                    subgraph ECS["ECS Fargate Cluster"]
                        SS1[Steady-State<br/>Service A]
                        SS2[Steady-State<br/>Service B]
                        PR1[PR-1234<br/>Service A]
                        PR2[PR-1234<br/>Service B]
                    end
                end
            end

            subgraph ControlPlane["Control Plane"]
                APIGW[API Gateway]
                WH[Webhook Handler<br/>Lambda]
                EC[Environment Controller<br/>Lambda]
                CH[Cleanup Handler<br/>Lambda]
                EB[EventBridge]
                DDB[(DynamoDB)]
            end

            CM[Cloud Map<br/>Service Discovery]
            CW[CloudWatch<br/>Observability]
        end
    end

    Developer -->|HTTPS| CF
    GitHub -->|Webhook| APIGW

    CF --> WAF
    WAF --> CFF
    CFF -->|VPC Origin| ALB

    ALB -->|Header: x-virtual-env-id| SS1
    ALB -->|Header: x-virtual-env-id| SS2
    ALB -->|Header: x-virtual-env-id| PR1
    ALB -->|Header: x-virtual-env-id| PR2

    APIGW --> WH
    WH --> EB
    EB --> EC
    EC --> DDB
    EC --> ALB
    EC --> ECS
    EC --> CM

    CH --> DDB
    CH --> EC
```

### Request Flow

```mermaid
sequenceDiagram
    participant Browser
    participant CloudFront
    participant CFF as CloudFront Function
    participant WAF
    participant ALB
    participant ECS as ECS Service

    Browser->>CloudFront: GET https://pr-1234.dev.example.com/api/users
    CloudFront->>WAF: Apply security rules
    WAF->>CFF: Pass request

    Note over CFF: Extract "pr-1234" from hostname<br/>Inject x-virtual-env-id header

    CFF->>CloudFront: Modified request with header
    CloudFront->>ALB: Forward via VPC Origin<br/>Headers: x-virtual-env-id: pr-1234<br/>x-cf-secret: [secret]

    Note over ALB: Match listener rule:<br/>Header x-virtual-env-id = pr-1234<br/>Path /api/*

    ALB->>ECS: Route to PR-1234 target group
    ECS->>ALB: Response
    ALB->>CloudFront: Response
    CloudFront->>Browser: Response
```

### Environment Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PROpened: Developer opens PR

    PROpened --> Creating: Webhook received
    Creating --> Active: Services deployed<br/>ALB rules created

    Active --> Updating: PR synchronized<br/>(new commits)
    Updating --> Active: Services updated

    Active --> Destroying: PR closed/merged<br/>or TTL expired
    Destroying --> [*]: Resources cleaned up

    note right of Creating
        - Create DynamoDB record
        - Deploy ECS services
        - Create target groups
        - Create ALB rules
        - Register Cloud Map
        - Post GitHub comment
    end note

    note right of Destroying
        - Remove ALB rules
        - Deregister Cloud Map
        - Scale ECS to 0
        - Delete resources
        - Update GitHub PR
    end note
```

### Control Plane Event Flow

```mermaid
flowchart LR
    subgraph GitHub
        PR[Pull Request]
    end

    subgraph API_Gateway[API Gateway]
        EP["POST /webhook"]
    end

    subgraph Webhook_Handler[Webhook Handler]
        WH["Validate Signature & Parse Event"]
    end

    subgraph EventBridge
        BUS[virtual-env-events]
        R1[Rule: PR Opened]
        R2[Rule: PR Sync]
        R3[Rule: PR Closed]
    end

    subgraph Environment_Controller[Environment Controller]
        CREATE[CREATE Action]
        UPDATE[UPDATE Action]
        DESTROY[DESTROY Action]
    end

    subgraph DynamoDB
        ENV[(virtual-environments)]
        ROUTE[(routing-config)]
        PRIO[(alb-rule-priorities)]
    end

    PR -->|Webhook| EP
    EP --> WH
    WH -->|PutEvents| BUS

    BUS --> R1 --> CREATE
    BUS --> R2 --> UPDATE
    BUS --> R3 --> DESTROY

    CREATE --> ENV
    CREATE --> ROUTE
    CREATE --> PRIO

    UPDATE --> ENV
    UPDATE --> ROUTE

    DESTROY --> ENV
    DESTROY --> ROUTE
    DESTROY --> PRIO
```

---

## How It Works

### 1. Header-Based Routing

The platform uses a header-based routing strategy to direct traffic to the appropriate service instances:

1. **CloudFront Function** extracts the virtual environment ID from the subdomain
   - `pr-1234.dev.example.com` → `x-virtual-env-id: pr-1234`

2. **ALB Listener Rules** match requests based on the header value
   - Rule: `x-virtual-env-id == pr-1234 AND path == /api/*` → PR-1234 API target group

3. **Fallback to Steady-State**: Requests without a matching header route to trunk services

### 2. VPC Origin Security

CloudFront connects to the internal ALB using **VPC Origins**, which:
- Creates ENIs in your VPC's private subnets
- Routes traffic over AWS's private backbone
- Eliminates the need for a public-facing ALB
- Provides an additional layer of network isolation

### 3. Trust Verification

Requests are verified using a secret header (`x-cf-secret`):
- CloudFront injects the secret on every request
- ALB/services validate the secret before processing
- Prevents direct access attempts bypassing CloudFront

---

## Development Workflow

### Continuous Delivery with Preview Environments

```mermaid
gitGraph
    commit id: "main"
    branch feature/user-auth
    commit id: "Add login form"
    commit id: "Add validation" tag: "PR #42 opened"

    checkout main
    branch feature/dashboard
    commit id: "New dashboard" tag: "PR #43 opened"

    checkout feature/user-auth
    commit id: "Fix tests" tag: "PR #42 sync"

    checkout main
    merge feature/user-auth tag: "PR #42 merged"

    checkout feature/dashboard
    commit id: "Add charts"

    checkout main
    merge feature/dashboard tag: "PR #43 merged"
```

### Developer Experience

#### 1. Open a Pull Request

```bash
git checkout -b feature/amazing-feature
# Make changes...
git push origin feature/amazing-feature
# Open PR on GitHub
```

Within minutes, a comment appears on the PR:

> **Preview Environment Ready**
>
> Your changes are available at: `https://pr-42.dev.example.com`
>
> | Service | Status | URL |
> |---------|--------|-----|
> | api-gateway | Running | [/api](https://pr-42.dev.example.com/api) |
> | web-app | Running | [/](https://pr-42.dev.example.com/) |
>
> This environment will expire in 24 hours or when the PR is closed.

#### 2. Iterate on Changes

Push new commits to your branch:

```bash
git add .
git commit -m "Address review feedback"
git push
```

The environment automatically updates with your latest changes.

#### 3. Review and Collaborate

- **Developers**: Test your changes in isolation
- **Reviewers**: Verify functionality before approving
- **QA**: Run manual tests against the preview URL
- **Stakeholders**: Preview features before they reach production

#### 4. Merge and Cleanup

When the PR is merged or closed:
- Environment is automatically destroyed
- ALB rules are removed
- ECS services are scaled down and deleted
- Resources are cleaned up within minutes

### Integration with CI/CD

```mermaid
flowchart LR
    subgraph "GitHub Actions"
        TEST[Run Tests]
        BUILD[Build Image]
        PUSH[Push to ECR]
    end

    subgraph "Virtual Env Platform"
        WEBHOOK[Webhook Handler]
        DEPLOY[Deploy Preview]
    end

    subgraph "Manual Gates"
        REVIEW[Code Review]
        QA[QA Validation]
        APPROVE[Approval]
    end

    subgraph "Production"
        PROD[Deploy to Prod]
    end

    TEST --> BUILD --> PUSH
    PUSH -->|Webhook| WEBHOOK
    WEBHOOK --> DEPLOY

    DEPLOY --> REVIEW
    REVIEW --> QA
    QA --> APPROVE
    APPROVE --> PROD
```

### Best Practices for Continuous Delivery

1. **Trunk-Based Development**: Keep feature branches short-lived (< 1-2 days)
2. **Feature Flags**: Use flags for long-running features that span multiple PRs
3. **Automated Testing**: Run tests before preview deployment
4. **Preview for All**: Enable non-technical stakeholders to preview changes
5. **Fast Feedback**: Configure alerts for preview environment failures

---

## Infrastructure Components

### Stacks Overview

| Stack | Region | Purpose |
|-------|--------|---------|
| `VirtualEnv-Network` | Primary | VPC, subnets, security groups |
| `VirtualEnv-DnsCert` | us-east-1 | Route53 hosted zone, ACM certificates |
| `VirtualEnv-Routing` | Primary | Internal ALB, Cloud Map namespace |
| `VirtualEnv-EcsCluster` | Primary | Shared ECS Fargate cluster |
| `VirtualEnv-Edge` | us-east-1 | CloudFront, WAF, CloudFront Function |
| `VirtualEnv-ControlPlane` | Primary | Lambda functions, DynamoDB, EventBridge |
| `VirtualEnv-Observability` | Primary | CloudWatch dashboards, alarms |

### DynamoDB Tables

#### virtual-environments
Tracks the state of each preview environment.

| Attribute | Type | Description |
|-----------|------|-------------|
| `virtualEnvId` (PK) | String | e.g., "pr-1234" |
| `status` | String | CREATING, ACTIVE, DESTROYING |
| `repository` | String | "org/repo" |
| `branch` | String | Feature branch name |
| `services` | Map | Service states and metadata |
| `expiresAt` | Number | TTL timestamp |

#### routing-config
Fast lookup for routing decisions.

| Attribute | Type | Description |
|-----------|------|-------------|
| `serviceId` (PK) | String | e.g., "api-gateway" |
| `virtualEnvId` (SK) | String | e.g., "pr-1234" |
| `targetGroupArn` | String | ALB target group ARN |
| `albRuleArn` | String | Listener rule ARN |
| `priority` | Number | Rule priority (1-100) |

#### alb-rule-priorities
Tracks ALB rule priority allocation.

| Attribute | Type | Description |
|-----------|------|-------------|
| `priority` (PK) | Number | Priority number |
| `virtualEnvId` | String | Assigned environment |
| `serviceId` | String | Assigned service |

---

## Deployment

### Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+ and npm
- AWS CDK CLI (`npm install -g aws-cdk`)
- A registered domain in Route53 (or delegate a subdomain)

### Configuration

Set your domain in `cdk.json` or via context:

```json
{
  "context": {
    "domainName": "dev.yourcompany.com",
    "primaryRegion": "us-west-2",
    "edgeRegion": "us-east-1"
  }
}
```

### Deploy

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Bootstrap CDK (if not already done)
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
npx cdk bootstrap aws://ACCOUNT_ID/us-west-2

# Deploy all stacks
npx cdk deploy --all

# Or deploy individually in order
npx cdk deploy VirtualEnv-Network
npx cdk deploy VirtualEnv-DnsCert
npx cdk deploy VirtualEnv-Routing
npx cdk deploy VirtualEnv-EcsCluster
npx cdk deploy VirtualEnv-Edge
npx cdk deploy VirtualEnv-ControlPlane
npx cdk deploy VirtualEnv-Observability
```

### GitHub App Setup

1. Create a GitHub App in your organization settings
2. Configure webhook URL: `https://<api-gateway-url>/github/webhook`
3. Set webhook secret (store in Secrets Manager)
4. Enable permissions:
   - Pull requests: Read & Write
   - Repository contents: Read
5. Subscribe to events:
   - Pull request (opened, synchronize, closed)

---

## Configuration

### Environment Variables

Configure in `lib/config/environment.ts`:

```typescript
export const DEFAULT_CONFIG = {
  domainName: 'dev.example.com',      // Your preview domain
  ttlHours: 24,                        // Environment TTL
  primaryRegion: 'us-west-2',          // Main infrastructure region
  edgeRegion: 'us-east-1',             // CloudFront/WAF region
};
```

### Service Configuration

Define previewable services in `lib/config/services.ts`:

```typescript
export const PREVIEWABLE_SERVICES: PreviewableService[] = [
  {
    serviceId: 'api-gateway',
    ecrRepository: 'mycompany/api-gateway',
    containerPort: 3000,
    pathPattern: '/api/*',
    healthCheckPath: '/api/health',
    cpu: 256,
    memoryMiB: 512,
  },
  {
    serviceId: 'web-app',
    ecrRepository: 'mycompany/web-app',
    containerPort: 3000,
    pathPattern: '/*',
    healthCheckPath: '/health',
    cpu: 256,
    memoryMiB: 512,
  },
];
```

---

## Security

### Network Security

- **VPC Isolation**: All compute runs in private subnets
- **VPC Origins**: CloudFront connects via AWS backbone, not public internet
- **Security Groups**: Strict ingress rules (ALB ← VPC CIDR, ECS ← ALB only)
- **No Public IPs**: ECS tasks and ALB have no public exposure

### Edge Security

- **WAF Protection**: Rate limiting and AWS managed rule sets
- **TLS 1.2+**: Minimum protocol version enforced
- **HTTPS Only**: HTTP automatically redirects to HTTPS

### Trust Chain

```
Browser → CloudFront → WAF → CloudFront Function → VPC Origin → ALB → ECS
              ↓                      ↓                    ↓
         Rate limit          Inject headers         Verify x-cf-secret
         Block attacks       x-virtual-env-id       Route by header
```

### Webhook Security

- GitHub webhook signatures validated using HMAC-SHA256
- Webhook secret stored in AWS Secrets Manager
- API Gateway throttling prevents abuse

---

## Operational Considerations

### ALB Rule Limits

AWS ALB has a limit of 100 listener rules. Budget carefully:

| Range | Purpose | Count |
|-------|---------|-------|
| 1-100 | Preview environments | ~80 |
| 101-900 | Steady-state services | 15 |
| 901-1000 | Platform rules | 5 |

**Monitoring**: CloudWatch alarm triggers at 70% capacity.

### Scaling Considerations

- **Max Concurrent PRs**: ~8 with 10 services each
- **Horizontal Scaling**: Consider multiple ALBs for higher limits
- **Cost Optimization**: Use Fargate Spot for preview workloads

### Cleanup Strategy

1. **TTL Enforcement**: Environments expire after configured hours
2. **PR Close**: Immediate cleanup triggered by webhook
3. **Scheduled Scan**: Lambda runs every 15 minutes to catch stragglers
4. **Graceful Drain**: Tasks given 5 minutes to complete requests

### Troubleshooting

| Issue | Check |
|-------|-------|
| Preview URL not working | CloudWatch logs for environment-controller |
| 502 errors | Target group health checks, ECS task status |
| Slow provisioning | EventBridge delivery, Lambda concurrency |
| Cleanup not happening | DynamoDB TTL configuration, cleanup-handler logs |

---

## CDK Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run watch` | Watch mode compilation |
| `npm run test` | Run unit tests |
| `npx cdk list` | List all stacks |
| `npx cdk synth` | Synthesize CloudFormation |
| `npx cdk diff` | Compare with deployed |
| `npx cdk deploy --all` | Deploy all stacks |
| `npx cdk destroy --all` | Tear down all stacks |

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

---

## License

MIT License - see LICENSE file for details.
