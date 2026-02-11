import { describe, it, expect, vi, beforeEach } from 'vitest';
import rateLimiter from '../../server/src/services/service';

function makeService() {
  const strapi = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as any;
  return rateLimiter({ strapi });
}

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    type: overrides.type ?? 'blocked',
    clientKey: overrides.clientKey ?? 'ip:1.2.3.4',
    path: overrides.path ?? '/api/articles',
    source: overrides.source ?? 'global',
    consumedPoints: overrides.consumedPoints ?? 101,
    limit: overrides.limit ?? 100,
    msBeforeNext: overrides.msBeforeNext ?? 30000,
  } as any;
}

describe('Service — Event Buffer', () => {
  let service: ReturnType<typeof makeService>;

  beforeEach(() => {
    service = makeService();
  });

  it('should start with empty events', () => {
    const result = service.getRecentEvents();
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.capacity).toBe(100);
  });

  it('should record and return a single event', () => {
    service.recordEvent(makeEvent());
    const result = service.getRecentEvents();
    expect(result.events).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.events[0].type).toBe('blocked');
    expect(result.events[0].clientKey).toBe('ip:1.2.3.4');
    expect(result.events[0].id).toBe(1);
    expect(result.events[0].timestamp).toBeDefined();
  });

  it('should return events newest-first', () => {
    service.recordEvent(makeEvent({ clientKey: 'ip:1.1.1.1' }));
    service.recordEvent(makeEvent({ clientKey: 'ip:2.2.2.2' }));
    service.recordEvent(makeEvent({ clientKey: 'ip:3.3.3.3' }));
    const result = service.getRecentEvents();
    expect(result.events[0].clientKey).toBe('ip:3.3.3.3');
    expect(result.events[1].clientKey).toBe('ip:2.2.2.2');
    expect(result.events[2].clientKey).toBe('ip:1.1.1.1');
  });

  it('should have monotonically increasing IDs', () => {
    for (let i = 0; i < 5; i++) {
      service.recordEvent(makeEvent());
    }
    const result = service.getRecentEvents();
    for (let i = 0; i < result.events.length - 1; i++) {
      expect(result.events[i].id).toBeGreaterThan(result.events[i + 1].id);
    }
  });

  it('should wrap circularly and evict oldest entries', () => {
    // Fill buffer beyond capacity
    for (let i = 0; i < 110; i++) {
      service.recordEvent(makeEvent({ clientKey: `ip:${i}` }));
    }
    const result = service.getRecentEvents();
    expect(result.events).toHaveLength(100);
    expect(result.total).toBe(110);
    // Newest should be ip:109
    expect(result.events[0].clientKey).toBe('ip:109');
    // Oldest in buffer should be ip:10 (first 10 were evicted)
    expect(result.events[99].clientKey).toBe('ip:10');
  });

  it('should assign ISO-8601 timestamps', () => {
    service.recordEvent(makeEvent());
    const result = service.getRecentEvents();
    const parsed = new Date(result.events[0].timestamp);
    expect(parsed.toISOString()).toBe(result.events[0].timestamp);
  });

  it('should preserve all event fields', () => {
    service.recordEvent(
      makeEvent({
        type: 'warning',
        clientKey: 'token:abc',
        path: '/api/users',
        source: 'route',
        consumedPoints: 80,
        limit: 100,
        msBeforeNext: 45000,
      })
    );
    const event = service.getRecentEvents().events[0];
    expect(event.type).toBe('warning');
    expect(event.clientKey).toBe('token:abc');
    expect(event.path).toBe('/api/users');
    expect(event.source).toBe('route');
    expect(event.consumedPoints).toBe(80);
    expect(event.limit).toBe(100);
    expect(event.msBeforeNext).toBe(45000);
  });
});
