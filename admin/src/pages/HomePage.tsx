import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Main,
  Box,
  Typography,
  Badge,
  Flex,
  Grid,
  Loader,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  EmptyStateLayout,
  Button,
  Dialog,
} from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { Layouts, useFetchClient } from '@strapi/strapi/admin';
import type { PluginStatus, RateLimitEvent } from '../../../server/src/types';

interface EventsData {
  events: RateLimitEvent[];
  total: number;
  capacity: number;
}

const DEFAULT_POLL_MS = 10_000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function formatResetIn(timestamp: string, msBeforeNext: number): string {
  const resetAt = new Date(timestamp).getTime() + msBeforeNext;
  const remaining = resetAt - Date.now();
  if (remaining <= 0) return 'Expired';
  const seconds = Math.round(remaining / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const HomePage = () => {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [eventsData, setEventsData] = useState<EventsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const { get, del } = useFetchClient();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleClearEvents = useCallback(async () => {
    try {
      await del('/strapi-plugin-rate-limit/events');
      setEventsData({ events: [], total: 0, capacity: eventsData?.capacity ?? 100 });
    } catch {
      // Silently ignore — next poll will refresh
    }
  }, [del, eventsData?.capacity]);

  const fetchAll = useCallback(
    async (silent: boolean) => {
      try {
        const statusRes = await get('/strapi-plugin-rate-limit/status');
        setStatus(statusRes.data.data);
        if (!silent) setError(null);
      } catch (err: any) {
        if (!silent) {
          const is404 = err?.status === 404;
          setError(is404 ? 'not-enabled' : 'Failed to fetch plugin status.');
        }
      }
      try {
        const eventsRes = await get('/strapi-plugin-rate-limit/events');
        setEventsData(eventsRes.data.data);
      } catch {
        // Events endpoint may not be available — ignore silently
      }
      if (!silent) setLoading(false);
    },
    [get]
  );

  // Data polling — interval driven by server config
  useEffect(() => {
    fetchAll(false);
    const pollMs = status?.pollIntervalMs ?? DEFAULT_POLL_MS;
    pollTimerRef.current = setInterval(() => fetchAll(true), pollMs);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchAll, status?.pollIntervalMs]);

  // 1s tick to keep "Resets In" countdowns live
  useEffect(() => {
    tickTimerRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    };
  }, []);

  if (loading) {
    return (
      <Main>
        <Box padding={8}>
          <Flex justifyContent="center">
            <Loader>Loading status...</Loader>
          </Flex>
        </Box>
      </Main>
    );
  }

  if (error === 'not-enabled') {
    return (
      <Main>
        <Layouts.Header
          title="Rate Limiter"
          secondaryAction={<Badge variant="danger">Not Enabled</Badge>}
        />
        <Layouts.Content>
          <EmptyStateLayout content="The rate limiter plugin is not enabled. Add it to your config/plugins file with enabled: true, then restart Strapi." />
        </Layouts.Content>
      </Main>
    );
  }

  if (error || !status) {
    return (
      <Main>
        <Layouts.Header title="Rate Limiter" subtitle={error || 'Unable to load status.'} />
      </Main>
    );
  }

  const events = eventsData?.events ?? [];

  return (
    <Main>
      <Layouts.Header
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
            Rate Limiter
            <Badge variant={status.enabled ? 'success' : 'danger'}>
              {status.enabled ? 'Active' : 'Disabled'}
            </Badge>
          </span>
        }
      />
      <Layouts.Content>
        {/* Status cards */}
        <Grid.Root gap={6}>
          <Grid.Item col={3} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow" width="100%">
              <Typography variant="sigma" textColor="neutral600">
                Strategy
              </Typography>
              <Box paddingTop={2}>
                <Flex gap={2} alignItems="center">
                  <Typography variant="omega" fontWeight="bold">
                    {status.strategy.charAt(0).toUpperCase() + status.strategy.slice(1)}
                  </Typography>
                  {status.strategy === 'redis' && (
                    <Badge active={status.redisConnected}>
                      {status.redisConnected ? 'Connected' : 'Disconnected'}
                    </Badge>
                  )}
                </Flex>
              </Box>
            </Box>
          </Grid.Item>

          <Grid.Item col={3} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow" width="100%">
              <Typography variant="sigma" textColor="neutral600">
                Default Limits
              </Typography>
              <Box paddingTop={2}>
                <Typography variant="omega" fontWeight="bold">
                  {status.defaults.limit} req / {status.defaults.interval}
                </Typography>
              </Box>
            </Box>
          </Grid.Item>

          <Grid.Item col={3} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow" width="100%">
              <Typography variant="sigma" textColor="neutral600">
                Custom Rules
              </Typography>
              <Box paddingTop={2}>
                <Typography variant="omega" fontWeight="bold">
                  {status.rulesCount}
                </Typography>
              </Box>
            </Box>
          </Grid.Item>

          <Grid.Item col={3} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow" width="100%">
              <Typography variant="sigma" textColor="neutral600">
                Allowlists
              </Typography>
              <Box paddingTop={2}>
                <Flex gap={1} wrap="wrap">
                  <Badge>IPs: {status.allowlistCounts.ips}</Badge>
                  <Badge>Tokens: {status.allowlistCounts.tokens}</Badge>
                  <Badge>Users: {status.allowlistCounts.users}</Badge>
                </Flex>
              </Box>
            </Box>
          </Grid.Item>
        </Grid.Root>

        {/* Events section */}
        <Box paddingTop={8}>
          <Flex gap={2} alignItems="center" paddingBottom={4}>
            <Typography variant="beta" tag="h2">
              Recent Events
            </Typography>
            {eventsData && (
              <Typography variant="pi" textColor="neutral600">
                {Math.min(eventsData.total, eventsData.capacity)}/{eventsData.capacity} buffered
              </Typography>
            )}
            {events.length > 0 && (
              <Dialog.Root>
                <Dialog.Trigger>
                  <Button variant="danger-light" size="S">
                    Clear
                  </Button>
                </Dialog.Trigger>
                <Dialog.Content>
                  <Dialog.Header>Clear all events</Dialog.Header>
                  <Dialog.Body icon={<WarningCircle fill="danger600" />}>
                    Are you sure you want to clear all recorded rate limit events? This cannot be
                    undone.
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Dialog.Cancel>
                      <Button variant="tertiary">Cancel</Button>
                    </Dialog.Cancel>
                    <Dialog.Action>
                      <Button variant="danger" onClick={handleClearEvents}>
                        Clear events
                      </Button>
                    </Dialog.Action>
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog.Root>
            )}
          </Flex>

          {events.length === 0 ? (
            <EmptyStateLayout content="No rate limit events recorded yet." />
          ) : (
            <Table colCount={7} rowCount={events.length}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">Time</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Type</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Client</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Path</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Source</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Usage</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Resets In</Typography>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {events.map((event) => (
                  <Tr key={event.id}>
                    <Td>
                      <Typography textColor="neutral800">{formatTime(event.timestamp)}</Typography>
                    </Td>
                    <Td>
                      <Badge variant={event.type === 'blocked' ? 'danger' : 'warning'}>
                        {event.type === 'blocked' ? 'Blocked' : 'Warning'}
                      </Badge>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{event.clientKey}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{event.path}</Typography>
                    </Td>
                    <Td>
                      <Badge>{event.source}</Badge>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {event.consumedPoints}/{event.limit}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {formatResetIn(event.timestamp, event.msBeforeNext)}
                      </Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Box>
      </Layouts.Content>
    </Main>
  );
};

export { HomePage };
