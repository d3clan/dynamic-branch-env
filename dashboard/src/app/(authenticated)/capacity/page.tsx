'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';

interface CapacityData {
  environments: {
    total: number;
    byStatus: Record<string, number>;
  };
  alb: {
    used: number;
    max: number;
    percentage: number;
    isWarning: boolean;
    isCritical: boolean;
  };
  priorities: {
    used: number;
  };
}

export default function CapacityPage() {
  const [capacity, setCapacity] = useState<CapacityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCapacity = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/capacity');
      if (!response.ok) throw new Error('Failed to fetch capacity');
      const data = await response.json();
      setCapacity(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capacity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCapacity();
  }, []);

  const getProgressBarColor = (percentage: number, isWarning: boolean, isCritical: boolean) => {
    if (isCritical) return 'bg-red-500';
    if (isWarning) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading capacity data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Capacity Dashboard</h1>
        <Button onClick={fetchCapacity} variant="secondary" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {capacity && (
        <>
          {(capacity.alb.isWarning || capacity.alb.isCritical) && (
            <div
              className={`border px-4 py-3 rounded ${
                capacity.alb.isCritical
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-yellow-50 border-yellow-200 text-yellow-700'
              }`}
            >
              <strong>
                {capacity.alb.isCritical ? 'Critical:' : 'Warning:'}
              </strong>{' '}
              ALB rule usage is at {capacity.alb.percentage}% (
              {capacity.alb.used}/{capacity.alb.max}).
              {capacity.alb.isCritical
                ? ' Consider destroying unused environments immediately.'
                : ' Consider cleaning up unused environments.'}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">ALB Rules Usage</h2>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-center">
                    <span className="text-4xl font-bold">
                      {capacity.alb.used}
                    </span>
                    <span className="text-2xl text-gray-500">
                      / {capacity.alb.max}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                      className={`h-4 rounded-full ${getProgressBarColor(
                        capacity.alb.percentage,
                        capacity.alb.isWarning,
                        capacity.alb.isCritical,
                      )}`}
                      style={{ width: `${capacity.alb.percentage}%` }}
                    />
                  </div>
                  <div className="text-center text-sm text-gray-500">
                    {capacity.alb.percentage}% utilized
                  </div>
                  <div className="flex justify-center gap-4 text-xs text-gray-400">
                    <span>Warning: 70%</span>
                    <span>Critical: 90%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Total Environments</h2>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <span className="text-4xl font-bold">
                    {capacity.environments.total}
                  </span>
                </div>
                <div className="mt-6 space-y-2">
                  {Object.entries(capacity.environments.byStatus).map(
                    ([status, count]) => (
                      <div
                        key={status}
                        className="flex items-center justify-between"
                      >
                        <Badge
                          variant={
                            status === 'ACTIVE'
                              ? 'success'
                              : status === 'FAILED'
                              ? 'danger'
                              : status === 'CREATING' || status === 'UPDATING'
                              ? 'info'
                              : 'default'
                          }
                        >
                          {status}
                        </Badge>
                        <span className="font-medium">{count}</span>
                      </div>
                    ),
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Priority Allocations</h2>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <span className="text-4xl font-bold">
                    {capacity.priorities.used}
                  </span>
                  <p className="text-sm text-gray-500 mt-2">
                    Active priority allocations
                  </p>
                </div>
                <div className="mt-6 text-sm text-gray-600">
                  <p>
                    Each service in an environment consumes one ALB rule priority.
                    Priorities are released when environments are destroyed.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Capacity Planning</h2>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-gray-600">
                <h3 className="text-base font-medium text-gray-900">
                  Understanding Limits
                </h3>
                <ul>
                  <li>
                    <strong>ALB Rules:</strong> AWS limits ALB listeners to 100 rules
                    (excluding the default rule). Each service routing configuration
                    uses one rule.
                  </li>
                  <li>
                    <strong>Environments:</strong> The number of concurrent environments
                    is limited by ALB rules divided by average services per environment.
                  </li>
                  <li>
                    <strong>TTL:</strong> Environments are automatically cleaned up when
                    their TTL expires, freeing up capacity.
                  </li>
                </ul>

                <h3 className="text-base font-medium text-gray-900 mt-4">
                  Recommendations
                </h3>
                <ul>
                  <li>
                    Set appropriate TTLs (24-72 hours) for preview environments.
                  </li>
                  <li>
                    Monitor the capacity dashboard regularly, especially during active
                    development periods.
                  </li>
                  <li>
                    Manually destroy environments that are no longer needed to free up
                    capacity.
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
