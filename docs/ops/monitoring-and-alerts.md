# Monitoring and alerts

## What the API tells you

| Endpoint | Meaning | Who calls it |
|---|---|---|
| `GET /api/health` | the process is up | the container's restart check |
| `GET /api/health/ready` | `ok`, `degraded` (HTTP 200) or `down` (HTTP 503) | the load balancer and the uptime monitor |
| same, header `x-ops-token: $OPS_TOKEN` | adds `connectedSockets`, `uptimeSeconds`, `rssMb`, seconds since each background job last ticked | the metrics scraper |

- **down** = the database does not answer. The load balancer should stop sending traffic to this instance.
- **degraded** = still serving, but Redis is unreachable or a background job (`sweeper`, `job-lifecycle`, `sos`) has missed three ticks in a row. **Page someone**: nobody is hurt yet, but live updates across servers, rate limits shared between servers, auto-confirming finished jobs, or the SOS timeout may not be working.

## Alerts to create

| Alert | Condition | Why it matters | First thing to check |
|---|---|---|---|
| API down | `/health/ready` is 503 or unreachable for 2 min | nobody can use the app | database host status; the platform's container logs |
| API degraded | status `degraded` for 5 min | see above | the `checks` object tells you which part |
| **Background job silent** | `backgroundJobs[].stale` true, or `secondsSinceTick` > 3 × interval (matching sweep 30 s, SOS 15 s, lifecycle 60 s) | offers stop expiring, SOS never moves on, finished jobs never auto-confirm | is `RUN_BACKGROUND_JOBS=true` on at least one instance? is the instance alive? |
| Error rate | Sentry: more than 5 new 5xx issues in 10 min, or any issue with > 20 events in 10 min | a deploy broke something | the Sentry issue shows the release and route; roll back (staging-and-releasing.md) |
| Slow requests | p95 over 500 ms for 10 min (from the platform's metrics) | load test target is 300 ms | CPU/memory of the instances; database load |
| Sockets | `connectedSockets` drops by more than half in 5 min while the instance is up | live updates are not reaching phones | Redis health; the load balancer's websocket timeout |
| Redis | `checks.redis.ok` false | see degraded | Redis host; the API keeps working with per-server rate limits meanwhile |
| Database | connections > 80 % of the limit, disk > 80 %, replica lag | the next outage | scale or clean up before it fills (a full disk once stopped the dev database) |
| Backups | the nightly backup did not finish, or the last restore drill is older than 90 days | an untested backup is a hope | backups-and-restore.md |
| Unpaid-fee backlog | number of workers with `balanceBlocked` rising day on day (Admin > Finance > What workers owe) | business, not technical | Finance |

Each alert needs a **named owner** and a **phone that rings** (not just an email). Write the owner in the monitoring tool; this table does not do that.

## Reading a report

Every error the API returns has a `requestId` (also in the app's error text support can ask for). In Sentry, search `requestId:<id>`; in the logs, search the same id. The report shows the route, release and the account id only (no name, number, address or message text).

## What to do when ...

- **"The app says offline but my signal is fine."** `curl https://api.fixli.pk/api/health/ready`. If `down`, it is the database. If `ok`, the problem is the phone's network or the load balancer.
- **Customers say requests never get prices.** Matching runs in the request; check Sentry for errors on `POST /job-requests`, then `matching` in the logs. If the `sweeper` heartbeat is stale, unmatched requests are not being widened.
- **A worker says they cannot go online.** Admin > Finance > What workers owe: `balanceBlocked` means they owe more than the limit; confirm their settlement.
- **Emergency (SOS) not moving to the next professional.** `sos` background job silent. Restart the instance that has `RUN_BACKGROUND_JOBS=true`; another instance picks up the lease within a minute.
