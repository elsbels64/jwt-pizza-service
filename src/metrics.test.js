// Mock config before requiring metrics
jest.mock('./config', () => ({
  source: 'test-source',
  metrics: {
    source: 'test-source',
    endpointUrl: null,
    apiKey: null,
    accountId: null,
  },
}));

// Mock fetch globally so sendMetricToGrafana doesn't fire
global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

// We need access to internal state, so we re-require with module isolation
let metrics;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
  jest.mock('./config', () => ({
    source: 'test-source',
    metrics: {
      source: 'test-source',
      endpointUrl: 'http://fake-grafana.example.com',
      apiKey: 'fake-key',
      accountId: 'fake-account',
    },
  }));
  metrics = require('./metrics');
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ─── pizzaPurchase ────────────────────────────────────────────────────────────

describe('pizzaPurchase', () => {
  test('increments pizzasSold and revenue on success', () => {
    // Call twice with different prices
    metrics.pizzaPurchase(true, 100, 12.99);
    metrics.pizzaPurchase(true, 80, 9.99);

    // Trigger the metrics interval so we can inspect what was sent
    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const soldMetric = metricsArray.find((m) => m.name === 'pizzas_sold');
    const revenueMetric = metricsArray.find((m) => m.name === 'revenue');

    expect(soldMetric.sum.dataPoints[0].asInt).toBe(2);
    expect(revenueMetric.sum.dataPoints[0].asDouble).toBeCloseTo(22.98);
  });

  test('increments pizzasFailed on failure', () => {
    metrics.pizzaPurchase(false, 50, 0);
    metrics.pizzaPurchase(false, 60, 0);

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const failMetric = metricsArray.find((m) => m.name === 'pizza_failures');
    expect(failMetric.sum.dataPoints[0].asInt).toBe(2);
  });

  test('records pizza latency data points', () => {
    metrics.pizzaPurchase(true, 123, 10);
    metrics.pizzaPurchase(false, 456, 0);

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const latencyMetric = metricsArray.find((m) => m.name === 'pizza_latency');
    expect(latencyMetric).toBeDefined();
    expect(latencyMetric.gauge.dataPoints).toHaveLength(2);
    expect(latencyMetric.gauge.dataPoints[0].asDouble).toBe(123);
    expect(latencyMetric.gauge.dataPoints[1].asDouble).toBe(456);
  });

  test('pizza latency array is cleared after each interval', () => {
    metrics.pizzaPurchase(true, 100, 10);

    jest.advanceTimersByTime(10000);
    jest.clearAllMocks();

    // No new purchases — next interval should have no pizza_latency metric
    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const latencyMetric = metricsArray.find((m) => m.name === 'pizza_latency');
    expect(latencyMetric).toBeUndefined();
  });
});

// ─── authAttempt ─────────────────────────────────────────────────────────────

describe('authAttempt', () => {
  test('increments authSuccess on success', () => {
    metrics.authAttempt(true);
    metrics.authAttempt(true);
    metrics.authAttempt(true);

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const successMetric = metricsArray.find((m) => m.name === 'auth_success');
    expect(successMetric.sum.dataPoints[0].asInt).toBe(3);
  });

  test('increments authFail on failure', () => {
    metrics.authAttempt(false);
    metrics.authAttempt(false);

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const failMetric = metricsArray.find((m) => m.name === 'auth_fail');
    expect(failMetric.sum.dataPoints[0].asInt).toBe(2);
  });

  test('tracks success and failure independently', () => {
    metrics.authAttempt(true);
    metrics.authAttempt(false);
    metrics.authAttempt(true);

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const successMetric = metricsArray.find((m) => m.name === 'auth_success');
    const failMetric = metricsArray.find((m) => m.name === 'auth_fail');

    expect(successMetric.sum.dataPoints[0].asInt).toBe(2);
    expect(failMetric.sum.dataPoints[0].asInt).toBe(1);
  });
});

// ─── requestTracker middleware ────────────────────────────────────────────────

describe('requestTracker', () => {
  function makeReqRes(method, path, user = null) {
    const listeners = {};
    const req = {
      method,
      path,
      user,
    };
    const res = {
      on: (event, cb) => {
        listeners[event] = cb;
      },
      emit: (event) => listeners[event] && listeners[event](),
    };
    return { req, res };
  }

  test('counts requests per endpoint', () => {
    const { req, res } = makeReqRes('GET', '/api/pizza');
    const next = jest.fn();

    metrics.requestTracker(req, res, next);
    res.emit('finish');
    metrics.requestTracker(req, res, next);
    res.emit('finish');

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const endpointMetric = metricsArray.find(
      (m) =>
        m.name === 'requests' &&
        m.sum?.dataPoints[0].attributes.some(
          (a) => a.key === 'endpoint' && a.value.stringValue === '[GET] /api/pizza'
        )
    );
    expect(endpointMetric.sum.dataPoints[0].asInt).toBe(2);
  });

  test('counts requests per HTTP method', () => {
    const next = jest.fn();

    metrics.requestTracker(makeReqRes('POST', '/api/order').req, makeReqRes('POST', '/api/order').res, next);
    metrics.requestTracker(makeReqRes('POST', '/api/order').req, makeReqRes('POST', '/api/order').res, next);
    metrics.requestTracker(makeReqRes('GET', '/api/menu').req, makeReqRes('GET', '/api/menu').res, next);

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const postMetric = metricsArray.find(
      (m) =>
        m.name === 'requests' &&
        m.sum?.dataPoints[0].attributes.some(
          (a) => a.key === 'method' && a.value.stringValue === 'POST'
        )
    );
    expect(postMetric.sum.dataPoints[0].asInt).toBe(2);
  });

  test('calls next()', () => {
    const { req, res } = makeReqRes('GET', '/health');
    const next = jest.fn();
    metrics.requestTracker(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('tracks authenticated users as active', () => {
    const { req, res } = makeReqRes('GET', '/api/order', { id: 'user-42' });
    const next = jest.fn();

    metrics.requestTracker(req, res, next);

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const activeUsersMetric = metricsArray.find((m) => m.name === 'active_users');
    expect(activeUsersMetric.gauge.dataPoints[0].asInt).toBeGreaterThanOrEqual(1);
  });

  test('records service latency on finish', () => {
    const { req, res } = makeReqRes('GET', '/api/menu');
    const next = jest.fn();

    metrics.requestTracker(req, res, next);
    res.emit('finish');

    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const metricsArray = body.resourceMetrics[0].scopeMetrics[0].metrics;

    const latencyMetric = metricsArray.find((m) => m.name === 'service_latency');
    expect(latencyMetric).toBeDefined();
    expect(latencyMetric.gauge.dataPoints.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Grafana send ─────────────────────────────────────────────────────────────

describe('sendMetricToGrafana', () => {
  test('sends metrics with correct Authorization header', () => {
    jest.advanceTimersByTime(10000);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://fake-grafana.example.com');
    expect(options.headers['Authorization']).toBe('Bearer fake-account:fake-key');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  test('wraps metrics in correct OTLP envelope shape', () => {
    jest.advanceTimersByTime(10000);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toHaveProperty('resourceMetrics');
    expect(body.resourceMetrics[0]).toHaveProperty('scopeMetrics');
    expect(body.resourceMetrics[0].scopeMetrics[0]).toHaveProperty('metrics');
    expect(Array.isArray(body.resourceMetrics[0].scopeMetrics[0].metrics)).toBe(true);
  });
});
