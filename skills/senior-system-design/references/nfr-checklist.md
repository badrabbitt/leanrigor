# Non-functional requirement checklist

Loaded on demand, not with the skill. Use it when a section of the design feels
thin, or during review to find what a design left out.

## Load and capacity

- Requests per second: average, peak, and the ratio between them.
- Read/write mix.
- Payload size: typical and worst case.
- Growth rate over the next year.
- Storage at one year, including indexes and replicas.
- Which of the above are measured, which estimated, which assumed?

## Latency

- Target at p50, p95 and p99 — a mean hides the experience that people complain
  about.
- Budget split across the call chain. Do the parts add up to the target?
- What is the timeout at each hop, and is it shorter than the caller's?

## Availability and durability

- Availability target, and over what window.
- What a single-instance failure costs. A single-zone failure. A region.
- Durability expectation for stored data, and what backup actually restores.
- Has a restore ever been tested?

## Consistency

- Strong, read-your-writes, or eventual — per access pattern, not globally.
- What a stale read looks like to a user.
- What happens to in-flight work during a failover.

## Failure handling

- Timeout for every remote call.
- Retry policy: how many, with what backoff, with what jitter.
- Retry budget: the ceiling that stops retries amplifying an outage.
- Idempotency key for anything retried that mutates state.
- Circuit breaking or load shedding when a dependency degrades.
- Queue depth limits, and what is dropped when the limit is reached.
- Behaviour when a dependency returns wrong data, not just no data.

## Security

- Trust boundaries, and what crosses each one.
- Authentication at each boundary.
- Authorization: which subject, which action, which resource.
- Input validation, and where it happens.
- Secret storage, rotation and blast radius if one leaks.
- What must never appear in a log, a metric label or an error message.
- Data retention and deletion, including backups.

## Observability

- The SLI that reflects user experience, and its target.
- Alerts on symptoms, not causes.
- A correlation id that survives every hop.
- What a first responder looks at first, and whether it exists yet.

## Cost

- Dominant cost driver.
- What it scales with: requests, storage, egress, or idle capacity.
- The cheapest change that would halve it.

## Rollout

- Deployment order across components.
- Compatibility window where both versions run.
- Flag, and who can flip it.
- Data migration: forward, backward, and whether it is reversible.
- The exact rollback step, and the point after which rollback stops working.
