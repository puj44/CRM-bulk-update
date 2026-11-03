Per-account rate limiting: designed, not built. Example limit: 10,000 records per minute per account.

- Every action already has an accountId, so each batch job would carry it too.
- Before running a batch, the worker adds the batch size to a Redis counter for that account and the current minute. The counter expires after 60 seconds.
- If that takes the account over its limit, the worker takes the count back and delays the job until the next minute (BullMQ's moveToDelayed). This doesn't count as a failed attempt.
- All workers share the same counter, so the limit holds however many workers are running. It also stops one big account from taking every worker while smaller accounts wait.

Scheduling: designed, not built. Example: an action that should start on 22 Nov at 11:15pm.

- Add an optional scheduledAt date to POST /bulk-actions (it must be in the future) and a new "scheduled" status.
- Queue the planner job with a delay of scheduledAt minus now. BullMQ keeps delayed jobs in Redis, so they survive restarts.
- At that time a worker picks it up and the normal flow runs.
- To cancel, remove the delayed job and mark the action cancelled.
