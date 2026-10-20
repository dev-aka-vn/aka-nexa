import { thresholds } from './thresholds.js';

const BASE_URL =
  (typeof __ENV !== 'undefined' && __ENV && __ENV.BASE_URL) ||
  'http://localhost:3000';

export const options = {
  scenarios: {
    inbound_events: {
      executor: 'constant-arrival-rate',
      exec: 'inboundEvents',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    concurrent_users: {
      executor: 'ramping-vus',
      exec: 'concurrentUsers',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds,
};

// Open model: iterations start independently of system response time.
// No sleep() here — the executor paces the arrival rate; a trailing sleep
// would silently reduce the offered load.
export function inboundEvents() {
  // k6 http is available at runtime; kept minimal for the smoke run.
  if (typeof http !== 'undefined') {
    http.post(`${BASE_URL}/webhooks/inbound`, JSON.stringify({ event: 'ping' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export function concurrentUsers() {
  // Representative browse-and-submit flow.
  if (typeof http !== 'undefined') {
    http.get(`${BASE_URL}/health/live`);
  }
}

export default { options, inboundEvents, concurrentUsers };