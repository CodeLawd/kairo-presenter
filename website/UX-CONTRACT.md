# Dashboard interaction contract

The website uses its existing dashboard theme tokens in `src/app/globals.css`,
shared `components/ui` controls, and `DashboardProvider` authenticated requests.
New licence screens preserve the sibling dashboard card layout and typography.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | Native select | Existing dashboard filters | native | Keyboard and OS popup |
| Date | Native date input | Existing dashboard filters | native | Browser locale and keyboard |
| Form | Shared Input, Label, Button | Server licensing validation | create/edit | Typecheck and server bounds |
| CRUD | DashboardProvider request | Authenticated licensing API | stay and announce | Mutation error/status text |
| Confirmation | Shared Base UI Dialog | Existing account dialog | device deactivation, licence changes | Cancel and focus restoration |
| Scrollbar | Global dashboard stylesheet | Existing theme | inherited | No new viewport owner |

Native select and date controls intentionally use operating-system-owned popups;
expiry is a calendar date ending at 23:59 UTC. Status changes to church licences
require confirmation. Saved provider credentials never enter browser state beyond a four-character tail;
each provider row saves on its own; drafts are masked
(with a reveal toggle) and cleared after save, and Remove asks inline before sending null. Each church's single activation key is
shown to owners and admins with Copy and Revoke; the same key stays visible and activates any of its computers until revoked.
Clipboard failures provide manual-copy recovery.

Church lists use ten entries per page. The authenticated server remains authoritative
for church ownership/admin roles and superadmin access. Loading and mutation failures
remain in context; retries do not navigate away. Licences have no payment dependency.
