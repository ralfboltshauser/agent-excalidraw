# Verification ledger

2026-11-19. Design artifacts exist. No application build, native installer or real agent operation has been verified in this design pass.

| Gate | Status | Evidence still required |
|---|---|---|
| M0 Product design | Ready for user review; not accepted | User walkthrough and recorded design corrections |
| M1 Editor/platform proof | Not started | Real SDK/concurrency/history checks and native launch on all supported OS families |
| M2 Files/recovery | Not started | Actual files, failures, reopen, conflict and recovery evidence |
| M3 Daily manual UX | Not started | Native create/open/library/file-management/keyboard walkthrough |
| M4 CLI agent workflow | Not started | Full real agent loop without MCP; receipts and artifacts |
| M5 Setup/MCP | Not started | Clean-home installs, discovery links, actual calls and adapter parity |
| M6 Quality/performance | Not started | Visual/a11y/export audits and measured fixtures on declared hardware |
| M7 Platform lifecycle | Not started | Signed installers, cold-cache offline, updates and uninstall on actual OSes |
| M8 Release candidate | Not started | Public distribution/documentation evidence and user acceptance |

## Design checks performed

* Prototype inline JavaScript passed a syntax parse with Node.
* Rendered canvas at 1000px and 390px, library at 728px, and dark agent setup at 728px; inspected screenshots with no reported console messages.
* Simulated-DOM smoke checks passed for create, dirty-close guard, cancel, save, library, setup, agent edit and conflict-copy. These are prototype-only checks, not browser/native integration tests.
* These checks establish rendering for those sampled states only. They do not prove native behavior, complete interaction accessibility or every flow.

## Criterion template for implementation handoffs

| Criterion / flow | OS / version / architecture | Build SHA | Fixture | Evidence location | Result: pass / fail / not run | Limitation / next action |
|---|---|---|---|---|---|---|
| Replace with exact milestone criterion | Specify actual test host | Pin build | Synthetic input hash/name | Logs + files + receipts as appropriate | Not run | State what remains |

Keep engineering completion and user acceptance distinct. User acceptance entry: date, build, milestones reviewed, accepted changes, remaining blockers. Never infer acceptance from silence.
