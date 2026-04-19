
# TM (Telemarketing) Module Implementation Plan

## Overview
Build a complete TM module for managing outbound call campaigns — lead lists, call logging, recall alerts, lead registration (individual + Excel bulk), and call history in customer detail.

## Database Changes (Migration)

1. **Add UPDATE/DELETE RLS policies on `tm_call_logs`** — currently missing, staff need to mark `recall_done = true`
2. **Add DELETE policy on `leads`** — currently missing
3. No new tables needed — `leads`, `tm_call_logs`, `call_type_codes`, `lead_assignments` already exist

```sql
-- Allow authenticated users to update/delete call logs
CREATE POLICY "call_logs_update" ON public.tm_call_logs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "call_logs_delete" ON public.tm_call_logs FOR DELETE TO authenticated USING (true);
-- Allow authenticated users to delete leads
CREATE POLICY "leads_delete" ON public.leads FOR DELETE TO authenticated USING (true);
```

## New Files

### Pages
1. **`src/pages/TmMain.tsx`** — TM main page (`/tm`)
   - Left: filter panel (type checkboxes, status checkboxes, sort selector). Collapses on mobile.
   - Right: prioritized lead card list with color-coded type icons, customer info, last call result, attempt count, `tel:` call button, detail button.
   - Bottom summary bar: "오늘 배분: N건 | 완료: N | 잔여: N"
   - Priority sort: recall_at due > new > recall retry > preventive (D-1/2 reservations) > no-show follow-up. Then by recall time, then by oldest assignment.

2. **`src/pages/TmRegister.tsx`** — Lead registration page (`/tm/register`)
   - Two tabs: "개별 등록" | "엑셀 업로드"
   - Individual: name, phone (010 format), source (select), treatment interest (select from `services`), memo
   - Duplicate detection on phone blur against `leads` + `customers` tables
   - "등록" and "등록 + 계속" buttons
   - Excel tab: file upload (CSV/XLSX via SheetJS), preview table, duplicate highlight, confirm button

### Components
3. **`src/components/tm/TmCallSheet.tsx`** — Call result input (Sheet/Dialog)
   - Read-only customer info header, last 3 call history
   - Call result form: category (from `call_type_codes`), subcategory (dynamic), result (radio), memo (textarea)
   - Conditional fields: reservation date/time/service when "예약완료", recall datetime when "재통화약속"
   - "저장" and "저장 + 다음 콜" buttons
   - On save: INSERT into `tm_call_logs`, UPDATE `leads.status`
   - On "예약완료": also INSERT into `reservations`

4. **`src/components/tm/TmRecallAlert.tsx`** — Recall notification hook/component
   - 1-minute polling interval for `recall_at <= now() AND recall_done = false`
   - Browser Notification API popup
   - Highlights card in list with 🔴

5. **`src/components/tm/TmCallHistoryTab.tsx`** — Call history tab for customer detail page
   - Query `tm_call_logs` by `customer_id` or `lead_id`
   - Reverse chronological: date, direction, category+subcategory, result, memo
   - Lead creation as first row
   - `tel:` call button

## Modified Files

6. **`src/App.tsx`** — Add routes `/tm` and `/tm/register` (lazy-loaded)
7. **`src/components/AdminLayout.tsx`** — Add "TM" nav button, visible only when `userRole === 'tm' || userRole === 'admin'`. Add `'tm'` to `activeTab` union type.
8. **`src/pages/AdminCustomers.tsx`** — Add "콜 이력" tab in customer detail sheet using `TmCallHistoryTab`

## Dependencies
- **SheetJS (`xlsx`)** — for Excel/CSV parsing in bulk lead upload. Install via npm.

## Key Implementation Details

- All queries scoped to `clinic_id` from `getSelectedClinicId()`
- `caller_id` for `tm_call_logs` = current auth user's `user_profiles.id` (via staff table lookup)
- Korean UI throughout, matching existing shadcn/ui + Tailwind style
- Mobile responsive: filter panel uses `Collapsible` or sheet on mobile
- Phone masking via existing `maskPhone()` utility on display
- `call_type_codes` loaded once and cached; subcategories filtered by selected category

## Priority Sort Logic (implemented in `useMemo`)
```text
1. recall_at IS NOT NULL AND recall_at <= now() AND recall_done = false  → weight 0
2. leads.status = 'new'                                                  → weight 1
3. Last call was no_answer (retry)                                       → weight 2
4. Reservation D-1 or D-2 (preventive)                                   → weight 3
5. No-show follow-up                                                     → weight 4
Tiebreak: recall_at ASC, then assigned_at ASC
```
