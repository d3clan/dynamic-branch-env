'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';

interface CloudFrontFunction {
  name: string;
  status: string;
  stage: string;
  lastModified?: string;
  comment?: string;
  code: string;
  etag: string;
}

export default function CloudFrontEditorPage() {
  const [functionData, setFunctionData] = useState<CloudFrontFunction | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [deployComment, setDeployComment] = useState('');

  const fetchFunction = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/routing/cloudfront');
      if (!response.ok) throw new Error('Failed to fetch CloudFront function');
      const data = await response.json();
      setFunctionData(data);
      setCode(data.code);
      setHasChanges(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CloudFront function');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFunction();
  }, []);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setHasChanges(newCode !== functionData?.code);
  };

  const handleDeploy = async () => {
    if (!functionData) return;

    try {
      setDeploying(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/routing/cloudfront/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          etag: functionData.etag,
          comment: deployComment || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to deploy');
      }

      const data = await response.json();
      setSuccess(`Function deployed successfully at ${data.deployedAt}`);
      setDeployComment('');

      // Refresh to get new etag
      await fetchFunction();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deploy CloudFront function');
    } finally {
      setDeploying(false);
    }
  };

  const handleReset = () => {
    if (functionData) {
      setCode(functionData.code);
      setHasChanges(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading CloudFront function...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/routing" className="text-gray-500 hover:text-gray-700">
            &larr;
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">CloudFront Function Editor</h1>
        </div>
        <Button onClick={fetchFunction} variant="secondary" disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          {success}
        </div>
      )}

      {functionData && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{functionData.name}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {functionData.comment || 'Header injection function for virtual environments'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">{functionData.stage}</Badge>
                  {hasChanges && (
                    <Badge variant="warning">Unsaved Changes</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="code-editor"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Function Code (JavaScript)
                  </label>
                  <textarea
                    id="code-editor"
                    value={code}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    className="w-full h-96 font-mono text-sm border border-gray-300 rounded-md p-4 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    spellCheck={false}
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Edit the CloudFront Function code. Changes will be validated and deployed to LIVE stage.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="deploy-comment"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Deploy Comment (optional)
                  </label>
                  <input
                    type="text"
                    id="deploy-comment"
                    value={deployComment}
                    onChange={(e) => setDeployComment(e.target.value)}
                    className="w-full border border-gray-300 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Describe your changes..."
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <div className="flex items-center justify-between w-full">
                <div className="text-sm text-gray-500">
                  Last modified:{' '}
                  {functionData.lastModified
                    ? new Date(functionData.lastModified).toLocaleString()
                    : 'Unknown'}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={handleReset}
                    disabled={!hasChanges || deploying}
                  >
                    Reset
                  </Button>
                  <Button
                    onClick={handleDeploy}
                    disabled={!hasChanges || deploying}
                  >
                    {deploying ? 'Deploying...' : 'Deploy to LIVE'}
                  </Button>
                </div>
              </div>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Important Notes</h2>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside space-y-2 text-gray-600">
                <li>
                  Changes are deployed directly to the LIVE stage and take effect immediately.
                </li>
                <li>
                  CloudFront Functions have a maximum size of 10 KB and execution time of 1ms.
                </li>
                <li>
                  The function runs on viewer request and should inject the{' '}
                  <code className="bg-gray-100 px-1 rounded">x-virtual-env-id</code> header.
                </li>
                <li>
                  Test changes carefully as they affect all incoming traffic.
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
