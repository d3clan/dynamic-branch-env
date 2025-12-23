import {
  CloudFrontClient,
  GetFunctionCommand,
  UpdateFunctionCommand,
  PublishFunctionCommand,
  DescribeFunctionCommand,
} from '@aws-sdk/client-cloudfront';

const client = new CloudFrontClient({
  region: 'us-east-1', // CloudFront Functions are global but managed via us-east-1
});

const CLOUDFRONT_FUNCTION_NAME =
  process.env.CLOUDFRONT_FUNCTION_NAME || 'virtual-env-header-injection';

export interface CloudFrontFunctionInfo {
  name: string;
  status: string;
  stage: 'DEVELOPMENT' | 'LIVE';
  lastModified?: Date;
  comment?: string;
  etag?: string;
}

export interface CloudFrontFunctionCode {
  code: string;
  etag: string;
}

export async function getFunctionInfo(): Promise<CloudFrontFunctionInfo> {
  const response = await client.send(
    new DescribeFunctionCommand({
      Name: CLOUDFRONT_FUNCTION_NAME,
      Stage: 'LIVE',
    }),
  );

  const config = response.FunctionSummary?.FunctionConfig;
  const metadata = response.FunctionSummary?.FunctionMetadata;

  return {
    name: CLOUDFRONT_FUNCTION_NAME,
    status: response.FunctionSummary?.Status || 'UNKNOWN',
    stage: metadata?.Stage as 'DEVELOPMENT' | 'LIVE' || 'LIVE',
    lastModified: metadata?.LastModifiedTime,
    comment: config?.Comment,
    etag: response.ETag,
  };
}

export async function getFunctionCode(): Promise<CloudFrontFunctionCode> {
  const response = await client.send(
    new GetFunctionCommand({
      Name: CLOUDFRONT_FUNCTION_NAME,
      Stage: 'LIVE',
    }),
  );

  const code = response.FunctionCode
    ? new TextDecoder().decode(response.FunctionCode)
    : '';

  return {
    code,
    etag: response.ETag || '',
  };
}

export async function updateAndPublishFunction(
  code: string,
  etag: string,
  comment?: string,
): Promise<{ etag: string; stage: string }> {
  // First, update the function (creates DEVELOPMENT stage)
  const updateResponse = await client.send(
    new UpdateFunctionCommand({
      Name: CLOUDFRONT_FUNCTION_NAME,
      IfMatch: etag,
      FunctionCode: new TextEncoder().encode(code),
      FunctionConfig: {
        Comment: comment || `Updated via dashboard at ${new Date().toISOString()}`,
        Runtime: 'cloudfront-js-2.0',
      },
    }),
  );

  // Then publish to LIVE
  const publishResponse = await client.send(
    new PublishFunctionCommand({
      Name: CLOUDFRONT_FUNCTION_NAME,
      IfMatch: updateResponse.ETag!,
    }),
  );

  return {
    etag: publishResponse.FunctionSummary?.FunctionMetadata?.Stage === 'LIVE'
      ? updateResponse.ETag!
      : publishResponse.FunctionSummary?.FunctionMetadata?.FunctionARN || '',
    stage: publishResponse.FunctionSummary?.FunctionMetadata?.Stage || 'UNKNOWN',
  };
}
