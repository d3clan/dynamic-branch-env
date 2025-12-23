'use client';

import Link from 'next/link';
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

interface VirtualEnvironment {
  virtualEnvId: string;
  status: string;
  repository: string;
  branch: string;
  prNumber?: number;
  services: { name: string }[];
  createdAt: string;
  ttlTimestamp?: number;
  previewUrl?: string;
}

export default function EnvironmentsPage() {
  const [environments, setEnvironments] = useState<VirtualEnvironment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleteEnvId, setDeleteEnvId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchEnvironments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/environments');
      if (!response.ok) throw new Error('Failed to fetch environments');
      const data = await response.json();
      setEnvironments(data.environments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load environments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnvironments();
  }, []);

  const handleDelete = async () => {
    if (!deleteEnvId) return;

    try {
      setDeleting(true);
      const response = await fetch(`/api/environments/${deleteEnvId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete environment');

      // Refresh the list
      await fetchEnvironments();
      setDeleteEnvId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete environment');
    } finally {
      setDeleting(false);
    }
  };

  const filteredEnvironments = environments.filter((env) =>
    statusFilter === 'all' ? true : env.status === statusFilter,
  );

  const statusOptions = ['all', ...new Set(environments.map((e) => e.status))];

  const formatTTL = (ttlTimestamp?: number) => {
    if (!ttlTimestamp) return 'No TTL';
    const now = Date.now();
    const ttlMs = ttlTimestamp * 1000;
    const diff = ttlMs - now;

    if (diff < 0) return 'Expired';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Environments</h1>
        <Button onClick={fetchEnvironments} variant="secondary" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Active Environments</h2>
            <div className="flex items-center gap-2">
              <label htmlFor="status-filter" className="text-sm text-gray-600">
                Filter by status:
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? 'All' : status}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && environments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Loading environments...
            </div>
          ) : filteredEnvironments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No environments found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Environment ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Branch / PR</TableHead>
                  <TableHead>Services</TableHead>
                  <TableHead>TTL</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEnvironments.map((env) => (
                  <TableRow key={env.virtualEnvId}>
                    <TableCell>
                      <Link
                        href={`/environments/${env.virtualEnvId}`}
                        className="text-primary-600 hover:underline font-medium"
                      >
                        {env.virtualEnvId}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(env.status)}>
                        {env.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {env.repository}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{env.branch}</span>
                        {env.prNumber && (
                          <span className="text-sm text-gray-500">
                            PR #{env.prNumber}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">
                        {env.services?.length || 0} service(s)
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          env.ttlTimestamp &&
                          env.ttlTimestamp * 1000 - Date.now() < 3600000
                            ? 'text-orange-600 font-medium'
                            : 'text-gray-600'
                        }
                      >
                        {formatTTL(env.ttlTimestamp)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {env.previewUrl && (
                          <a
                            href={env.previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:underline text-sm"
                          >
                            Preview
                          </a>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteEnvId(env.virtualEnvId)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          Destroy
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmModal
        isOpen={!!deleteEnvId}
        onClose={() => setDeleteEnvId(null)}
        onConfirm={handleDelete}
        title="Destroy Environment"
        message={`Are you sure you want to destroy the environment "${deleteEnvId}"? This action cannot be undone and will remove all associated resources.`}
        confirmText="Destroy"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
