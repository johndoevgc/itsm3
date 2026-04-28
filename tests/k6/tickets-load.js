import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * k6 load test for POST /api/v1/tickets
 * SLO Target: 99.95% availability, P95 <2s
 */

const failRate = new Rate('failed_requests');
const API_URL = __ENV.K6_API_URL || 'http://localhost:3001';

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up
    { duration: '1m', target: 50 },    // Sustain
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // P95 < 2s (SLO)
    http_req_failed: ['rate<0.005'],    // <0.5% failure rate
    failed_requests: ['rate<0.005'],
  },
};

export default function () {
  const payload = JSON.stringify({
    title: 'Load test ticket',
    description: 'Automated load test',
    severity: 'D',
    reporterUpn: 'loadtest@contoso.com',
    channel: 'web',
  });

  const res = http.post(`${API_URL}/api/v1/tickets`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': 'loadtest-tenant',
    },
  });

  const success = check(res, {
    'status is 201': (r) => r.status === 201,
    'has ticket id': (r) => {
      try {
        return JSON.parse(r.body).id !== undefined;
      } catch {
        return false;
      }
    },
    'response time < 2s': (r) => r.timings.duration < 2000,
  });

  failRate.add(!success);

  sleep(1);
}
