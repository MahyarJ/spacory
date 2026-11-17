# Agent command permissions

The shared command policy lives in `.agents/command-policy.json`. Run
`npm run agents:sync` after editing it. This generates Claude's Bash entries in
`.claude/settings.json` and Codex's `.codex/rules/spacory.rules`; the existing
instruction-sync check also detects stale permission files. Claude's named-skill
permissions and sandbox settings remain specific to Claude.

For interactive Codex, trust the project's `.codex` configuration layer and start
a new session after changing rules. Codex loads project rules at startup; it does
not read Claude's settings. No account path or global installation is needed.
See the [official rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules).

The initial policy preserves the existing Claude command prefixes and denials.
It does not allow arbitrary `python3`, `node`, or shell execution outside the
sandbox. Ordinary interpreter commands can still run within the sandbox; add
specific script prefixes when an outside-sandbox operation is needed.

Codex rules match exact argument prefixes. For example, `git push --force` is
forbidden, but `git push origin --force` does not match that denial. These rules
preserve the existing policy's prefixes, rather than providing a comprehensive
Git safety filter. Alternate option placement and complex shell scripts can
produce different matches. Review commands before relying on a denial.

Allow rules authorize matching commands outside Codex's sandbox. They do not
provide credentials or override managed host restrictions. Work Cloud local
computer access uses managed command rules rather than these local rule files.
Headless Codex continues to use its explicit launch flags; `approval_policy=never`
alone does not grant access outside the sandbox.

Validate without executing the target commands:

```bash
codex execpolicy check --rules .codex/rules/spacory.rules -- gh pr view 109
codex execpolicy check --rules .codex/rules/spacory.rules -- git push --force origin main
```
