'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { ConfirmModal } from '@/components/ui/modal';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

interface ServiceConfig {
  name: string;
  imageUri: string;
  pathPattern: string;
  port: number;
  cpu?: number;
  memory?: number;
  healthCheckPath?: string;
  status?: string;
  taskArn?: string;
  targetGroupArn?: string;
}

interface RoutingConfig {
  virtualEnvId: string;
  serviceName: string;
  pathPattern: string;
  priority: number;
  albRuleArn?: string;
}

interface VirtualEnvironment {
  virtualEnvId: string;
  status: string;
  repository: string;
  branch: string;
  prNumber?: number;
  services: ServiceConfig[];
  createdAt: string;
  updatedAt: string;
  ttlTimestamp?: number;
  previewUrl?: string;
  errorMessage?: string;
}

export default function EnvironmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const envId = params.envId as string;

  const [environment, setEnvironment] = useState<VirtualEnvironment | null>(null);
  const [routingConfigs, setRoutingConfigs] = useState<RoutingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchEnvironment = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/environments/${envId}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('Environment not found');
          return;
        }
        throw new Error('Failed to fetch environment');
      }
      const data = await response.json();
      setEnvironment(data.environment);
      setRoutingConfigs(data.routingConfigs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load environment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnvironment();
  }, [envId]);

  const handleDelete = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/environments/${envId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete environment');
      router.push('/environments');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete environment');
    } finally {
      setActionLoading(false);
      setShowDeleteModal(false);
    }
  };

  const handleExtendTTL = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/environments/${envId}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      });
      if (!response.ok) throw new Error('Failed to extend TTL');
      await fetchEnvironment();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extend TTL');
    } finally {
      setActionLoading(false);
      setShowExtendModal(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatTTL = (ttlTimestamp?: number) => {
    if (!ttlTimestamp) return 'No TTL set';
    const date = new Date(ttlTimestamp * 1000);
    const now = Date.now();
    const diff = ttlTimestamp * 1000 - now;

    if (diff < 0) return `Expired at ${date.toLocaleString()}`;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const remaining = hours > 24
      ? `${Math.floor(hours / 24)}d ${hours % 24}h remaining`
      : `${hours}h remaining`;

    return `${date.toLocaleString()} (${remaining})`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading environment...</div>
      </div>
    );
  }

  if (error || !environment) {
    return (
      <div className="space-y-4">
        <Link href="/environments" className="text-primary-600 hover:underline">
          &larr; Back to Environments
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error || 'Environment not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/environments" className="text-gray-500 hover:text-gray-700">
            &larr;
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {environment.virtualEnvId}
          </h1>
          <Badge variant={getStatusBadgeVariant(environment.status)}>
            {environment.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {environment.previewUrl && (
            <a
              href={environment.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="secondary">Open Preview</Button>
            </a>
          )}
          <Button onClick={fetchEnvironment} variant="secondary">
            Refresh
          </Button>
          <Button
            variant="danger"
            onClick={() => setShowDeleteModal(true)}
          >
            Destroy
          </Button>
        </div>
      </div>

      {environment.errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          <strong>Error:</strong> {environment.errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Details</h2>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm text-gray-500">Repository</dt>
                <dd className="font-medium">{environment.repository}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Branch</dt>
                <dd className="font-medium">{environment.branch}</dd>
              </div>
              {environment.prNumber && (
                <div>
                  <dt className="text-sm text-gray-500">Pull Request</dt>
                  <dd>
                    <a
                      href={`https://github.com/${environment.repository}/pull/${environment.prNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:underline font-medium"
                    >
                      #{environment.prNumber}
                    </a>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-sm text-gray-500">Created</dt>
                <dd className="font-medium">{formatDate(environment.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Last Updated</dt>
                <dd className="font-medium">{formatDate(environment.updatedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">TTL / Expiration</h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowExtendModal(true)}
              >
                Extend +24h
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p
                className={
                  environment.ttlTimestamp &&
                  environment.ttlTimestamp * 1000 - Date.now() < 3600000
                    ? 'text-orange-600 font-medium'
                    : 'text-gray-700'
                }
              >
                {formatTTL(environment.ttlTimestamp)}
              </p>
              <p className="text-sm text-gray-500">
                Environments are automatically destroyed when their TTL expires.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Services</h2>
        </CardHeader>
        <CardContent className="p-0">
          {environment.services?.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No services deployed
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service Name</TableHead>
                  <TableHead>Path Pattern</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {environment.services?.map((service) => (
                  <TableRow key={service.name}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell>
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        {service.pathPattern}
                      </code>
                    </TableCell>
                    <TableCell>{service.port}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(service.status || 'UNKNOWN')}>
                        {service.status || 'UNKNOWN'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {service.healthCheckPath || '/health'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {routingConfigs.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Routing Configuration</h2>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Path Pattern</TableHead>
                  <TableHead>Priority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routingConfigs.map((config) => (
                  <TableRow key={`${config.virtualEnvId}-${config.serviceName}`}>
                    <TableCell className="font-medium">{config.serviceName}</TableCell>
                    <TableCell>
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        {config.pathPattern}
                      </code>
                    </TableCell>
                    <TableCell>{config.priority}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Destroy Environment"
        message={`Are you sure you want to destroy "${environment.virtualEnvId}"? This action cannot be undone and will remove all associated resources.`}
        confirmText="Destroy"
        confirmVariant="danger"
        isLoading={actionLoading}
      />

      <ConfirmModal
        isOpen={showExtendModal}
        onClose={() => setShowExtendModal(false)}
        onConfirm={handleExtendTTL}
        title="Extend TTL"
        message="Extend the environment TTL by 24 hours?"
        confirmText="Extend"
        confirmVariant="primary"
        isLoading={actionLoading}
      />
    </div>
  );
}
