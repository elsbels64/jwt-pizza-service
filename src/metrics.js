const config = require('./config');

// Metrics stored in memory
const requests = {};
const methods = {};

const activeUserMap = {};
const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const serviceLatencies = [];
const pizzaLatencies = [];

const os = require('os');
// Add these at the top with your other variables

let pizzasSold = 0;
let pizzasFailed = 0;
let revenue = 0;
let authSuccess = 0;
let authFail = 0;

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}


// Function to track when the greeting is changed
function pizzaPurchase(success, latency, price) {
  if(success){
    pizzasSold++;
    revenue += price;
  }else{
    pizzasFailed++;
  }
  pizzaLatencies.push({ value: latency, time: Date.now() });
}

function authAttempt(success) {
  if (success) {
    authSuccess++;
  } else {
    authFail++;
  }
}

// Middleware to track requests
function requestTracker(req, res, next) {
  const endpoint = `[${req.method}] ${req.path}`;
  requests[endpoint] = (requests[endpoint] || 0) + 1;

  const method = req.method;
  methods[method] = (methods[method] || 0) + 1;

  const start = Date.now();
  res.on('finish', () => {
    serviceLatencies.push({ value: Date.now() - start, time: Date.now() });
  });

  if (req.user) {
    activeUserMap[req.user.id] = Date.now();
  }

  next();
}

// This will periodically send metrics to Grafana
setInterval(() => {
  const metrics = [];
  Object.keys(requests).forEach((endpoint) => {
    metrics.push(createMetric('requests', requests[endpoint], '1', 'sum', 'asInt', { endpoint }));
  });

  Object.keys(methods).forEach((method) => {
    metrics.push(createMetric('requests', methods[method], '1', 'sum', 'asInt', { method: method }));
  });

  //cpu and memory
  metrics.push(createMetric('cpu', getCpuUsagePercentage(), '%', 'gauge', 'asDouble', {}));
  metrics.push(createMetric('memory', getMemoryUsagePercentage(), '%', 'gauge', 'asDouble', {}));


  //login
  metrics.push(createMetric('auth_success', authSuccess, '1', 'sum', 'asInt', {}));
  metrics.push(createMetric('auth_fail', authFail, '1', 'sum', 'asInt', {}));

  //active users
  const now = Date.now();
    Object.keys(activeUserMap).forEach((userId) => {
    if (now - activeUserMap[userId] > ACTIVE_USER_WINDOW_MS) {
        delete activeUserMap[userId];
    }
    });

    metrics.push(createMetric('active_users', Object.keys(activeUserMap).length, '1', 'gauge', 'asInt', {}));

  //pizza selling
  metrics.push(createMetric('pizzas_sold', pizzasSold, '1', 'sum', 'asInt', {}));
  metrics.push(createMetric('pizza_failures', pizzasFailed, '1', 'sum', 'asInt', {}));
  metrics.push(createMetric('revenue', revenue, 'USD', 'sum', 'asDouble', {}));
  
  //latencies
  if (serviceLatencies.length > 0) {
    const metric = {
        name: 'service_latency',
        unit: 'ms',
        gauge: {
            dataPoints: serviceLatencies.map((entry) => ({
                asDouble: entry.value,
                timeUnixNano: entry.time * 1000000,
                attributes: [
                    { key: 'source', value: { stringValue: config.metrics.source } },
                    { key: 'type', value: { stringValue: 'service' } },
                    ],
            })),
        },
    };
    metrics.push(metric);
    serviceLatencies.length = 0;
    }

    if (pizzaLatencies.length > 0) {
    const metric = {
        name: 'pizza_latency',
        unit: 'ms',
        gauge: {
        dataPoints: pizzaLatencies.map((entry) => ({
            asDouble: entry.value,
            timeUnixNano: entry.time * 1000000,
            attributes: [
                { key: 'source', value: { stringValue: config.metrics.source } },
                { key: 'type', value: { stringValue: 'pizza' } },
                ],
        })),
        },
    };
    metrics.push(metric);
    pizzaLatencies.length = 0;
    }

  sendMetricToGrafana(metrics);
}, 10000);

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.metrics.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: metricValue,
          timeUnixNano: Date.now() * 1000000,
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: attributes[key] },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

function sendMetricToGrafana(metrics) {
    if (!config.metrics?.endpointUrl || !config.metrics?.apiKey || !config.metrics?.accountId) {
    return; // skip if credentials not configured
  }
  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

console.log('Sending metrics to:', config.metrics.endpointUrl);
console.log('account  id:', config.metrics.accountId);
console.log('api key:', config.metrics.apiKey);

  fetch(`${config.metrics.endpointUrl}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
  })
    .then((response) => {
        console.log('Grafana response status:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP status: ${response.status}`);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
}

module.exports = { requestTracker, pizzaPurchase, authAttempt};