import { useEffect, useState } from 'react';
import { Main, Box, Typography, Badge, Flex, Grid, Loader } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { PLUGIN_ID } from '../pluginId';

interface PluginStatus {
  enabled: boolean;
  strategy: 'memory' | 'redis' | 'none';
  redisConnected: boolean;
  defaults: { limit: number; interval: string };
  rulesCount: number;
  allowlistCounts: { ips: number; tokens: number; users: number };
}

const HomePage = () => {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { get } = useFetchClient();

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const { data } = await get(`/${PLUGIN_ID}/status`);
        setStatus(data.data);
      } catch (err) {
        setError('Failed to fetch plugin status.');
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, [get]);

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

  if (error || !status) {
    return (
      <Main>
        <Box padding={8}>
          <Typography variant="alpha" tag="h1">Rate Limiter</Typography>
          <Box paddingTop={4}>
            <Typography textColor="danger600">{error || 'Unable to load status.'}</Typography>
          </Box>
        </Box>
      </Main>
    );
  }

  return (
    <Main>
      <Box padding={8}>
        <Flex gap={4} alignItems="center" paddingBottom={6}>
          <Typography variant="alpha" tag="h1">Rate Limiter</Typography>
          <Badge active={status.enabled}>{status.enabled ? 'Active' : 'Disabled'}</Badge>
        </Flex>

        <Grid.Root gap={6}>
          <Grid.Item col={4} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow">
              <Typography variant="sigma" textColor="neutral600">Strategy</Typography>
              <Box paddingTop={2}>
                <Typography variant="omega" fontWeight="bold">
                  {status.strategy.charAt(0).toUpperCase() + status.strategy.slice(1)}
                </Typography>
              </Box>
            </Box>
          </Grid.Item>

          {status.strategy === 'redis' && (
            <Grid.Item col={4} s={6} xs={12}>
              <Box padding={5} hasRadius background="neutral0" shadow="tableShadow">
                <Typography variant="sigma" textColor="neutral600">Redis</Typography>
                <Box paddingTop={2}>
                  <Badge active={status.redisConnected}>
                    {status.redisConnected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </Box>
              </Box>
            </Grid.Item>
          )}

          <Grid.Item col={4} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow">
              <Typography variant="sigma" textColor="neutral600">Default Limits</Typography>
              <Box paddingTop={2}>
                <Typography variant="omega" fontWeight="bold">
                  {status.defaults.limit} requests / {status.defaults.interval}
                </Typography>
              </Box>
            </Box>
          </Grid.Item>

          <Grid.Item col={4} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow">
              <Typography variant="sigma" textColor="neutral600">Custom Rules</Typography>
              <Box paddingTop={2}>
                <Typography variant="omega" fontWeight="bold">{status.rulesCount}</Typography>
              </Box>
            </Box>
          </Grid.Item>

          <Grid.Item col={4} s={6} xs={12}>
            <Box padding={5} hasRadius background="neutral0" shadow="tableShadow">
              <Typography variant="sigma" textColor="neutral600">Allowlists</Typography>
              <Box paddingTop={2}>
                <Typography variant="omega">
                  IPs: {status.allowlistCounts.ips} | Tokens: {status.allowlistCounts.tokens} | Users: {status.allowlistCounts.users}
                </Typography>
              </Box>
            </Box>
          </Grid.Item>
        </Grid.Root>
      </Box>
    </Main>
  );
};

export { HomePage };
