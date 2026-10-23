# Tandix Web API SDK

Source: https://github.com/samchen2009/tandix

Commit: `2c43eb9a227e1d04efef5af86ef496180281468c`

Files: `extensions/dsh-browser/src/web-api/client.ts` and `protocol.ts`.

The browser SDK is vendored under the upstream MIT license. TypeScript was transformed with Node.js module.stripTypeScriptTypes (mode: transform); the protocol import points to the local .mjs file. No behavioral patches. The former local beforeSubmit hook was removed: StudyTrail now allocates and persists taskId before calling the official run({taskId}) API.

Public API stays v1, with hello.taskRecovery === 1 required; companion webTaskApiVersion must be 2. SDK getTask/attach only observe the original task; explicit task.resume uses the original session and an idempotent requestId. Browser clients do not require a build step or network download.
