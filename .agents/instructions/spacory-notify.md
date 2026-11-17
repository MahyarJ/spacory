---
name: spacory-notify
description: Finishing-up notification for Spacory's Product/Engineer agent runs — how to post a short Telegram wrap-up via .agents/notify.sh (done or blocked). Use at the end of every agent run. The exact per-mode message text lives in the product-agent / engineer-agent skills.
---

# Finishing up: post one Telegram wrap-up message

When a run finishes — shipped, commented, or blocked — send **one** short
Telegram message through the repo's committed helper, `.agents/notify.sh`:

```bash
.agents/notify.sh "<message>"
```

## How the helper behaves (why it's always safe to call)

- It loads credentials from the gitignored `.agents/.env` (or CI-exported
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`).
- If neither is present it prints a notice and exits cleanly — so it never
  hardcodes a token and is always safe to invoke.
- The Bash sandbox blocks outbound network independently of the permission
  allowlist, so `.claude/settings.json` opens `api.telegram.org` via
  `sandbox.network.allowedDomains`. Permissions gate *what runs*; the sandbox
  gates *what it can reach*.

If the helper reports Telegram isn't configured, just state the outcome in your
final text output instead.

## What to send

Send exactly one message: a **done** message for the mode you ran, or a
**blocked** message if you stopped (auth failed, or you asked a question and
stopped instead of guessing).

The exact message text per mode is listed in your role skill:

- Product Agent → the "Finishing up" section of the `product-agent` skill.
- Engineer Agent → the "Finishing up" section of the `engineer-agent` skill.

Keep it short (a few lines), lead with the role emoji (🪐 Product / 🛠️
Engineer), and include the issue/PR number and URL where relevant.
