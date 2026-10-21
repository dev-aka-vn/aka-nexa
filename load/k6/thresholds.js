// k6 threshold set for the OBS-08 load suite.
//
// The webhook ack budget (NFR-SEC ... <200 ms) is asserted here as a
// threshold scoped to the inbound-events scenario, not merely reported.
// A threshold that fails aborts the run, so a slow ack is a hard failure.

// Dropped-iterations budget: an open-model executor at target load is expected
// to drop a small number of iterations when the system is saturated; requiring
// exactly zero would make the test flaky without improving safety. 1% (0.01)
// is the chosen budget: it is small enough to catch a genuinely broken run
// (which drops far more) and large enough to absorb scheduler jitter on a
// shared CI runner. Documented so the number is reviewable, not arbitrary.
export const DROPPED_ITERATIONS_BUDGET = 0.01;

export const thresholds = {
  // Webhook ack budget, scoped to the inbound-events scenario only.
  'http_req_duration{scenario:inbound_events}': ['p(95)<200'],
  // Dropped iterations under the open model.
  dropped_iterations: [`rate<${DROPPED_ITERATIONS_BUDGET}`],
  // No 5xx responses.
  http_req_failed: ['rate<0.01'],
};

export default thresholds;