# Agent automation

The dispatcher in `.agents/dispatch.sh` coordinates Engineer and Product through
GitHub. It starts a fresh process for each stage. After a runner exits, the
dispatcher checks the result on GitHub and immediately evaluates the next stage
of the same PR. The webhook wakes the dispatcher for changes outside the local
runner. The scheduled health check recovers missed deliveries and interrupted runs.

## Review and handoffs

| Trigger or result | Next step |
| --- | --- |
| A maintainer adds `agent:ready` to an issue | Engineer implements and opens a linked PR. |
| An eligible PR opens or its head changes | Engineer reviews the current head. The first pass covers the full PR. A re-review starts with the delta, the previous findings, and regressions introduced by the fix. |
| Engineer requests code changes | Resolve addresses the findings. A verified push returns the PR to Engineer. |
| Engineer approves the current head | Product walks the user workflow against the issue. It can cite Engineer's evidence for findings already covered. |
| Product requests code changes | Resolve pushes a fix. Engineer reviews that revision before Product runs again. |
| A reviewer makes approval conditional on a non-code edit | Clarify handles the PR title or body, the linked issue, or both. The PR then needs fresh verdicts even if its head is unchanged. |
| Both verdicts approve the current head | The PR is marked `agent:accepted`. The merge gate checks branch freshness and, for opt-in automerge, CI. |

Engineer and Product include the full `**Head:**` SHA in their GitHub verdicts.
A conditional verdict can include `**Clarify:** engineer`, `product`, or `both`.
The dispatcher records phase checkpoints as hidden PR comments before launching a
runner. It matches each verdict to a checkpoint by role and SHA, using comments
from the configured `gh` account. A push during a review disqualifies the previous
SHA. A label alone cannot make a stale verdict advance. When upgrading, an old
accepted PR whose verdicts have only timestamps will get fresh reviews.

At the merge boundary, a conflicting branch or a branch behind `main` moves to
`agent:conflict`. Engineer's Reconcile mode merges `main` into the PR branch,
resolves conflicts, and pushes. That revision goes back through review. Maintainers
can add `agent:conflict` to request reconciliation earlier. Automerge defaults to
off. When enabled, it still checks CI and passes the approved head SHA to `gh pr
merge --match-head-commit`. Enable GitHub's up-to-date branch protection as well
to enforce freshness for human merges.

Resolve keeps the existing review-round cap. A fresh loop after Clarify,
Reconcile, acceptance, or blocking resets the cap, as does a linked spec edit.
A failed runner can retry while its expected artifact is missing. If the runner
returns successfully without a verdict or required push, or retries run out, the
dispatcher sets `agent:blocked`. Inspect the PR and logs, remove `agent:blocked`,
and apply the label for the next step. After a blocked clarification, use
`agent:clarify` to finish the pending batch or `agent:review` to start a fresh
review after resolving the clarification yourself.

## Maintainer requests

- To groom an idea into a spec, apply `agent:triage` to an issue. A maintainer
  applies `agent:ready` when the spec is ready to build.
- To clarify a PR, leave a top-level comment and apply `agent:clarify`, in either
  order. The dispatcher keeps a maintainer request queued across pushes. A
  push cancels any remaining roles for a conditional verdict on the old head. A
  pending maintainer request still runs before re-review, including questions
  posted while a clarification is finishing. To target one role,
  put `/agent clarify engineer` or `/agent clarify product` on its own line in
  the comment. Inline review comments use the explicit command. A plain top-level
  request can involve both roles. After an interruption, the dispatcher finishes
  the recorded batch using saved replies before starting newer requests. Completed
  requests are recorded by comment ID.
- For clarification on an issue, apply `agent:clarify` after posting the question.
  Product answers and folds any decision back into the spec.
- Apply `agent:review` to start a fresh review, including after a spec change on
  the same PR revision. Apply `agent:conflict` to reconcile. The dispatcher owns
  the in-flight labels such as `agent:reviewing`.

## Prepare the runner

Install Bash, Git, `gh`, Node/npm, and the configured agent CLI. On Linux, also
install `flock` from `util-linux`. Run `npm ci` in the checkout so agent worktrees
can reuse its dependencies. Configure Git fetch/push and authenticate `gh` as the
account that writes checkpoints and verdicts. Keep the same `gh` account during
cutover while PRs are in flight so recovery recognizes earlier checkpoints.
Configure the provider in `.agents/.env` using `.agents/.env.example`. Codex uses
the explicitly selected `CODEX_HOME` from the runner environment.

### macOS and Linux defaults

Both launchd and systemd run the same dispatcher commands (`webhook`, `tick`, and
`cycle`). The service manager controls startup, scheduling, and logs.

| Behavior | macOS with launchd | Linux with systemd |
| --- | --- | --- |
| Startup | Per-user jobs run while the user is logged in. | The timers and webhook service start at boot. Dispatcher processes run as `spacory`. |
| Recovery check | Runs when launchd loads the job and every 10 minutes while the Mac is awake. Ticks missed during sleep are skipped. | Runs on 10-minute clock boundaries. The persistent timer triggers a catch-up run after downtime. |
| Daily Product cycle | 09:00 in the Mac's local timezone. A missed cycle during sleep runs on wake. | 09:00 UTC by default. The persistent timer triggers a catch-up run after downtime. |
| Webhook receiver | Starts when the job loads and restarts after a failed exit. | Starts at boot and restarts after failure with a five-second delay. |
| Tool paths | The installer finds tool directories on its `PATH` and writes them into the launchd jobs. | The units specify a fixed `PATH` that can be extended through a drop-in. |
| Service logs | `dispatch.log`, `webhook.log`, and `cycle.log` under `.agents/logs`. | The systemd journal. |

On either host, the receiver exits normally when its signing secret is missing.
The [Linux setup](#linux-with-systemd) shows how to set the Product cycle to the
same local timezone as the Mac during a cutover.

### macOS with launchd

```bash
.agents/dispatch.sh setup
.agents/launchd/install.sh install
.agents/launchd/install.sh status
```

The installer loads all three jobs. The daily cycle gets its issue inventory
through `gh` before launching Product.

### Linux with systemd

The units in `.agents/systemd/` use the `spacory` service account, its home at
`/home/spacory`, and the checkout at `/opt/spacory`. On a fresh host, create that
account and checkout before configuring its credentials.

```bash
sudo useradd --system --create-home --home-dir /home/spacory spacory
sudo install -d -o spacory /opt/spacory
sudo -u spacory -H git clone https://github.com/MahyarJ/spacory.git /opt/spacory
sudo -u spacory -H npm --prefix /opt/spacory ci
```

Put the provider binaries on the unit's `PATH` or extend it using drop-ins for
`spacory-agents@.service` and `spacory-agents-webhook.service`. Store
`.agents/.env` with mode `0600`. Keep the checkout on persistent storage so the
webhook queue and usage log survive a reboot.

Run `.agents/dispatch.sh setup` as the service account if the GitHub labels still
need to be created. When moving an active runner, stop its jobs before enabling
the new ones. The dispatcher lock is local to a host.

From `/opt/spacory`, install the jobs and check their status.

```bash
.agents/systemd/install.sh install
.agents/systemd/install.sh status
```

The installer verifies the units, installs them under `/etc/systemd/system`,
and starts the timers and webhook service. The receiver exits until its signing
secret is configured. After adding the secret, run
`sudo systemctl restart spacory-agents-webhook.service`.

To remove the jobs, run `.agents/systemd/install.sh uninstall`. This stops any
active worker and removes the installed unit files. The checkout, credentials,
webhook queue, logs, and systemd drop-ins stay on disk.

To change the Product timezone, use `sudo systemctl edit spacory-agents-cycle.timer`
and clear the inherited schedule before setting the new one.

```ini
[Timer]
OnCalendar=
OnCalendar=*-*-* 09:00:00 Europe/Helsinki
```

Restart `spacory-agents-cycle.timer` to apply the new schedule. Inspect the
schedules or trigger a recovery check with these commands.

```bash
systemctl list-timers 'spacory-agents-*'
sudo systemctl start spacory-agents@tick.service
journalctl -u spacory-agents-webhook.service -u spacory-agents@tick.service -u spacory-agents@cycle.service
```

## Connect GitHub webhooks

1. Set `SPACORY_WEBHOOK_SECRET` to a random secret in `.agents/.env`. Set
   `SPACORY_WEBHOOK_PORT` if you need a loopback port other than `8787`. Restart
   the receiver so it reads the configuration.
2. Forward an HTTPS endpoint you control to `127.0.0.1:8787/github` using your
   reverse proxy or tunnel. The server listens on loopback.
3. Add a **repository webhook** on GitHub with that HTTPS URL, JSON content type,
   and the same secret. Subscribe to **Issues**, **Issue comments**, **Pull
   requests**, and **Pull request review comments**. Verify the ping and a test
   delivery in GitHub's **Recent Deliveries** view. [GitHub webhook setup](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks)

The receiver validates the signature and repository and saves wake-ups to
`.agents/logs/webhook-queue`. It passes the artifact number to the dispatcher,
which re-reads live GitHub state. Duplicate and out-of-order events can therefore
wake the dispatcher more than once without replaying a completed stage. If the
shared OS lock is busy, the queue retains the wake-up and retries. There is still
one dispatcher in flight across the webhook, health check, and Product cycle.

| Setting | Default | Behavior |
| --- | --- | --- |
| `SPACORY_MAX_ROUNDS` | `5` | Engineer review rounds allowed in one resolve loop. |
| `SPACORY_AUTOMERGE` | `0` | Set to `1` to squash-merge once approvals, CI, and branch freshness pass. |
| `SPACORY_AGENT_RETRIES` | `1` | Additional attempts for a failed runner when its expected result is missing. |
| `SPACORY_AGENT_RETRY_BACKOFF_SECS` | `20` | Delay between attempts. |
| `SPACORY_CYCLE_LOCK_WAIT_SECS` | `1800` | Maximum time for the daily cycle to wait for the dispatcher lock. |
| `SPACORY_INFLIGHT_STALE_MINS` | `120` | Age at which recovery prunes a leaked temporary Engineer worktree. |
| `SPACORY_REVIEWER_RESUME` | `0` | Set to `1` to pilot per-PR Engineer reviewer resumption. |
| `SPACORY_AGENT_USAGE_LOG` | `.agents/logs/usage.jsonl` | Optional absolute path for structured runner usage. |

## Recovery and verification

```bash
.agents/dispatch.sh status
.agents/dispatch.sh wake pr 34       # re-evaluate a PR immediately
.agents/dispatch.sh wake issue 12    # re-evaluate an issue immediately
.agents/dispatch.sh tick             # run the scheduled recovery now
```

Check the service logs for your [host](#macos-and-linux-defaults). A healthy signed
delivery receives `202` when queued or `204` when irrelevant. Restart the receiver through
the host service manager if it is unavailable. It reads saved wake-ups at startup.
If GitHub missed a delivery during host downtime, redeliver it in GitHub or run
a targeted wake.

At the next recovery check, the dispatcher uses in-flight labels and checkpoints
to continue from a published verdict or pushed revision, or retry the interrupted
stage if its expected result is missing.

For a scheduler-disabled smoke test, stop just the Linux health-check timer with
`sudo systemctl stop spacory-agents-tick.timer`. On macOS, unload it with
`launchctl bootout "gui/$(id -u)/com.spacory.agents.dispatch"`. Apply `agent:ready`
to a disposable test issue and watch implementation, Engineer review, Resolve,
Engineer re-review, and Product acceptance. Then push another revision and
verify that old approvals do not advance it. Apply `agent:clarify` before
posting your question to verify it waits for the comment. Restore the health check
with `sudo systemctl start spacory-agents-tick.timer` or the macOS installer.
The agent test suite exercises these handoffs with mocked providers and GitHub
state, including a restart and a missed event.

## Usage and the reviewer pilot

The runners record one JSON line per provider invocation. Each entry includes the
role, provider, configured or reported model, elapsed time, PR and SHA when
available, and provider-reported input, cached input, and output tokens. Input
includes cached tokens. Missing fields remain `null`. The log records token
counts and session IDs. Provider tool payloads stay in the temporary capture. The
report totals all Engineer and Product review attempts per PR. It measures time
from eligibility to the first review and from eligibility to acceptance, so the
numbers include time spent waiting for a dispatcher and for fixes.

The dispatcher records eligibility from GitHub rather than its local run start.
For an implementation PR, it uses the opening or ready-for-review time and the
linked issue's queue time. For a manually queued PR, it uses the `agent:review`
label time, accounting for drafts. The report keeps elapsed times unknown for
logs that lack eligibility evidence.

```bash
node .agents/usage.mjs report .agents/logs/usage.jsonl
node .agents/usage.mjs report engineer-first.jsonl parallel-baseline.jsonl
```

To collect a parallel baseline, apply **Record provider usage and support
reviewer session IDs** to an isolated copy of the old dispatcher. Use comparable
PRs, providers, and models, and keep separate logs. Keep the instrumented files
available in the runner's worktrees. With `SPACORY_AGENT_USAGE_LOG` pointing at
the baseline log, import the observed eligibility and acceptance times from GitHub
before running the report.

```bash
node .agents/usage.mjs eligible PR_NUMBER ELIGIBILITY_TIMESTAMP
node .agents/usage.mjs accepted PR_NUMBER HEAD_SHA ACCEPTANCE_TIMESTAMP
```

### Controlled ordering comparison

The two fixture PRs below were replayed with fresh, read-only Codex CLI sessions
using `gpt-6.2-sol` at low reasoning effort. The criteria required accepting
both endpoints of `[0, 10]`. The clean fixture used `x >= 0 && x <= 10`. The
blocked fixture started with `x > 0 && x <= 10` and used the clean code as its
next revision. Engineer checked the comparison and the regression. Product
checked the user-visible endpoints and could cite Engineer evidence in the
Engineer-first runs. The provider reported token usage for every review.

| Fixture PR | Ordering | Review calls | Input tokens | Cached input | Output tokens | Eligibility to acceptance |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 9001, clean | Parallel, scheduled | 2 | 32,329 | 27,904 | 75 | 608.8 s |
| 9001, clean | Engineer first, immediate | 2 | 34,323 | 27,904 | 77 | 14.2 s |
| 9002, fix required | Parallel, scheduled | 4 | 68,598 | 55,808 | 156 | 1,806.2 s |
| 9002, fix required | Engineer first, immediate | 3 | 51,505 | 41,856 | 125 | 18.8 s |

Acceptance times combine measured CLI wall time with simulated scheduling. Both
PRs become eligible just after a scheduled check. The parallel loop waits until
minute 10 to review. For fixture 9002, Resolve occupies the minute-20 check and
review resumes at minute 30. The immediate loop starts with a free runner, and
both paths apply the fixture fix instantly. This isolates the review order and
schedule effects from implementation time and live queue traffic.

The blocked fixture skipped one Product pass and used about 25% fewer input
tokens. The clean fixture used two passes in both orderings and slightly more
input in the Engineer-first sample. In the clean case, the concurrent passes
finished in 8.8 seconds once started, while the sequential passes took 14.2
seconds. The end-to-end gain in this replay comes from removing the scheduled
wait. Live timings depend on the runner's queue and real fix duration.

Resumption is off by default. With `SPACORY_REVIEWER_RESUME=1`, an Engineer
re-review can reopen the previous reviewer session for that PR, prior head, and
provider/model by ID. The provider exits and the isolated worktree is removed
between rounds. The next review receives both SHAs and the link to the previous
findings. If it cannot resume or produces no verdict, the dispatcher starts a
fresh review using the PR and issue. The report shows fresh and resumed
re-review totals separately. Compare matched rounds with the same model and
review scope before changing the default.
