'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

interface RoutingConfig {
  virtualEnvId: string;
  serviceName: string;
  pathPattern: string;
  priority: number;
  albRuleArn?: string;
}

export default function RoutingPage() {
  const [routingConfigs, setRoutingConfigs] = useState<RoutingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<RoutingConfig | null>(null);
  const [editPathPattern, setEditPathPattern] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchRoutingConfigs = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/routing');
      if (!response.ok) throw new Error('Failed to fetch routing configs');
      const data = await response.json();
      setRoutingConfigs(data.routingConfigs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load routing configs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutingConfigs();
  }, []);

  const handleEdit = (config: RoutingConfig) => {
    setEditingConfig(config);
    setEditPathPattern(config.pathPattern);
  };

  const handleSave = async () => {
    if (!editingConfig) return;

    try {
      setSaving(true);
      const response = await fetch(`/api/routing/${editingConfig.virtualEnvId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: editingConfig.serviceName,
          pathPattern: editPathPattern,
        }),
      });

      if (!response.ok) throw new Error('Failed to update routing config');

      await fetchRoutingConfigs();
      setEditingConfig(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update routing config');
    } finally {
      setSaving(false);
    }
  };

  // Group configs by environment
  const configsByEnv = routingConfigs.reduce((acc, config) => {
    if (!acc[config.virtualEnvId]) {
      acc[config.virtualEnvId] = [];
    }
    acc[config.virtualEnvId].push(config);
    return acc;
  }, {} as Record<string, RoutingConfig[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Routing Configuration</h1>
        <div className="flex items-center gap-2">
          <Link href="/routing/cloudfront">
            <Button variant="secondary">CloudFront Function Editor</Button>
          </Link>
          <Button onClick={fetchRoutingConfigs} variant="secondary" disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">ALB Routing Rules</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure path patterns for each service. Changes will update both DynamoDB and ALB rules.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loading && routingConfigs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Loading routing configs...
            </div>
          ) : routingConfigs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No routing configurations found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Environment</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Path Pattern</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(configsByEnv).map(([envId, configs]) =>
                  configs.map((config, idx) => (
                    <TableRow key={`${config.virtualEnvId}-${config.serviceName}`}>
                      <TableCell>
                        {idx === 0 ? (
                          <Link
                            href={`/environments/${envId}`}
                            className="text-primary-600 hover:underline font-medium"
                          >
                            {envId}
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-medium">
                        {config.serviceName}
                      </TableCell>
                      <TableCell>
                        <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                          {config.pathPattern}
                        </code>
                      </TableCell>
                      <TableCell>{config.priority}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(config)}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={!!editingConfig}
        onClose={() => setEditingConfig(null)}
        title="Edit Path Pattern"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setEditingConfig(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        {editingConfig && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Environment
              </label>
              <p className="mt-1 text-gray-900">{editingConfig.virtualEnvId}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Service
              </label>
              <p className="mt-1 text-gray-900">{editingConfig.serviceName}</p>
            </div>
            <div>
              <label
                htmlFor="pathPattern"
                className="block text-sm font-medium text-gray-700"
              >
                Path Pattern
              </label>
              <input
                type="text"
                id="pathPattern"
                value={editPathPattern}
                onChange={(e) => setEditPathPattern(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="/api/*"
              />
              <p className="mt-1 text-sm text-gray-500">
                Use wildcards like /api/* or /service/v1/*
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
