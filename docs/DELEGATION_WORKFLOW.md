# Team Delegation Workflow

**Status:** Active operating rule
**Owner:** Hawa (default profile)
**Executor:** Claude Code CLI

## Routing

```text
App / code: Hawa → Goku → Kuririn + Bulma → Claude Code CLI
Video:      Hawa → Bejita → Claude Code CLI
```

Hawa is the COO/coordinator and does not implement application code, UX/UI, or
video output directly.

## App/code handoff contract

1. **Hawa** classifies the request, writes the brief, defines acceptance criteria,
   and sends it to `goku_cto`.
2. **Goku** owns technical scope, architecture, risks, and sequencing. Goku
   obtains both specialist inputs:
   - `kuririn_dev_lead`: implementation plan, code/test/build work;
   - `bulma_uiux`: user flow, visual specification, accessibility and UX criteria.
3. **Kuririn + Bulma** return concrete, implementation-ready inputs to Goku.
4. **Goku** consolidates the inputs into an execution brief for **Claude Code
   CLI**. Claude Code CLI implements and verifies; it does not make product or
   design decisions.
5. **Hawa** independently checks the evidence (tests, build output, diff, or
   other tool output) before reporting completion.

## Video handoff contract

1. **Hawa** sends the brief and acceptance criteria to `bejita_video_editor`.
2. **Bejita** prepares the edit plan, shot/timeline specification, asset rights
   constraints, export settings, and an execution brief for Claude Code CLI.
3. **Claude Code CLI** executes the approved pipeline and verifies the output
   (for example with `ffprobe` and playback/file checks).
4. **Hawa** validates the reported evidence before closing the work.

## Minimum handoff payload

Every handoff must identify:

- objective and scope;
- target files/assets and repository or working directory;
- constraints and decisions already made;
- acceptance criteria;
- exact verification command(s);
- owner and expected return artifact.

A self-report such as “done” is not sufficient evidence. The coordinator must
read back the artifact or rerun a cheap verification check.

## Standard profile commands

```bash
hermes -p goku_cto chat --query-file <brief.md> --oneshot -Q
hermes -p bejita_video_editor chat --query-file <brief.md> --oneshot -Q
```

Long briefs must use `--query-file`; capture stdout and stderr separately.
Kuririn, Bulma, and Bejita should provide implementation-ready briefs to the
Claude Code CLI executor rather than silently changing the chain.

## Exceptions

Any exception that makes Hawa implement directly, bypasses Goku for app/code,
or bypasses Bejita for video must be explicitly recorded with the reason and
approved by the user. This document does not grant permission for financial,
production, access-control, contract, or personnel actions.
