const config = require('./config');

// Metrics stored in memory
const requests = {};
const methods = {};
let greetingChangedCount = 0;

const os = require('os');
// Add these at the top with your other variables

let pizzasSold = 0;
let pizzasFailed = 0;
let revenue = 0;
let pizzaLatency = 0;
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
  pizzaLatency = latency;
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


  //login
  metrics.push(createMetric('auth_success', authSuccess, '1', 'sum', 'asInt', {}));
  metrics.push(createMetric('auth_fail', authFail, '1', 'sum', 'asInt', {}));


  //pizza selling
  metrics.push(createMetric('pizzas_sold', pizzasSold, '1', 'sum', 'asInt', {}));
  metrics.push(createMetric('pizza_failures', pizzasFailed, '1', 'sum', 'asInt', {}));
  metrics.push(createMetric('revenue', revenue, 'USD', 'sum', 'asDouble', {}));
  metrics.push(createMetric('pizza_latency', pizzaLatency, 'ms', 'gauge', 'asDouble', {}));

  sendMetricToGrafana(metrics);
}, 10000);

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.source };

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

  fetch(`${config.metrics.endpointUrl}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP status: ${response.status}`);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
}

module.exports = { requestTracker, pizzaPurchase, authAttempt};