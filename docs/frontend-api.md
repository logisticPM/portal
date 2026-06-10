# Frontend integration guide — the backend interface

The backend exposes **only interfaces**. You never import DynamoDB, AWS SDK, or
any data file — you import one object per domain and call typed methods. The
implementation (in-memory mock vs DynamoDB) is chosen by the `REPO_IMPL` env var
and is invisible to you.

- **Default (no env):** in-memory mock — build pages with zero setup, no database.
- **`REPO_IMPL=dynamo`:** real DynamoDB (Local or AWS). Same calls, same results.

---

## 1. Portal — `repo` (report → confirm → coverage)

```ts
import { repo } from "@/lib/repo";
import type { Coverage, ReportedLine, Party } from "@/lib/repo/types";
```

Reads — call directly in a **server component**:

| Method | Returns | Use in |
|---|---|---|
| `repo.listParties("supplier")` | `Party[]` | supplier picker, role switcher |
| `repo.getParty(id)` | `Party \| null` | profile + identity-tier badge |
| `repo.listLinesForCompany(companyId)` | `ReportedLine[]` | company's reported lines |
| `repo.listPendingForSupplier(supplierId)` | `ReportedLine[]` | supplier's confirm inbox |
| `repo.getCoverage(companyId)` | `Coverage` | coverage view (reported vs confirmed) |
| `repo.getSupplierRecord(supplierId)` | `SupplierRecord` | "My Record" view |
| `repo.getIndexSummary()` | `IndexSummary` | analytics (macro rollup) |
| `repo.exportRecords(partyId)` | `ExportBundle` | OCAP export |

```tsx
// server component example
export default async function CoveragePage({ searchParams }) {
  const cov = await repo.getCoverage(searchParams.as);
  return <div>{cov.confirmedPct}% confirmed</div>;
}
```

Writes — use the ready-made **server actions** (don't call `repo` write methods from the client):

```ts
import {
  createLineAction,
  respondToLine,
  withdrawConfirmations,
  registerSupplierAction,
} from "@/lib/repo/actions";
```

| Action | Form fields it reads |
|---|---|
| `createLineAction` | `companyId`, `supplierId`, `amount`, `pillar?` (default `procurement`), `period?` (default `2025`) |
| `respondToLine` | `lineId`, `byPartyId`, `status` (confirmed/disputed/corrected), `correctedAmount?` |
| `withdrawConfirmations` | `supplierId` |
| `registerSupplierAction` | `name`, `identityTier` |

```tsx
<form action={respondToLine}>
  <input type="hidden" name="lineId" value={line.id} />
  <input type="hidden" name="byPartyId" value={supplierId} />
  <button name="status" value="confirmed">Confirm</button>
</form>
```

---

## 2. RAP Impact Survey — `surveyRepo` (41-question responses)

```ts
import { surveyRepo } from "@/lib/survey";
import type { Organization, SurveyResponse } from "@/lib/survey";
```

| Method | Returns |
|---|---|
| `surveyRepo.getOrganization(id)` | `Organization \| null` |
| `surveyRepo.putOrganization(org)` | `Organization` |
| `surveyRepo.getResponse(orgId, year)` | `SurveyResponse \| null` |
| `surveyRepo.putResponse(response)` | `SurveyResponse` |
| `surveyRepo.listResponsesByYear(year)` | `SurveyResponse[]` (cross-org rollup) |

Test data available out of the box (mock): orgs `org-mckinsey`, `org-cedartrust`, year `"2025"`.

```tsx
const r = await surveyRepo.getResponse("org-mckinsey", "2025");
// r.procurementTotal, r.indigenousStaff.total, r.partneredWith, ...
```

`SurveyResponse` holds all 41 questions as typed fields (each annotated with its
Q number in `src/lib/survey/types.ts`). Nested answers (staff breakdowns,
partnerships, procurement) are nested objects — see the type for the shape.

---

## Rules of thumb

- **Reads** → `await` the repo method directly in a server component.
- **Writes** → go through a server action (`"use server"`), then `revalidatePath(...)`.
- **Never** import from `repo.mock` / `repo.dynamo` / `dynamo/*` / `seed/*` — only `@/lib/repo`, `@/lib/repo/actions`, `@/lib/repo/types`, and `@/lib/survey`.
- The only file shared between frontend and backend is `src/lib/repo/types.ts` — changes there must be announced to both groups.
