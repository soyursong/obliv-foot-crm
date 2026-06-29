/**
 * T-20260611-foot-SPACE-RESET-RECUR5 — Phase A / A0+A3 (READ-ONLY)
 *
 * 질문(A0): 오늘 "공간배정 계속 풀림"이
 *   H1 = RECUR4 06-06·06-08 null-wipe 손실분이 재입력된 적 없어, today 행 부재로
 *        06-08 null baseline 을 carry-over 해 빈칸으로 보이는 '미복구 잔존 손실'
 *   H2/H3 = 06-09 이후 새 save→reset 사이클(신규 재발)
 *   중 무엇인지 데이터로 판별.
 *
 * 머지 규칙 (Staff.fetchEffectiveAssignments):
 *   today 행이 있으면 그 방은 today 우선(null 이면 미배정),
 *   today 행 없으면 baseline(today 이전 최근일) carry-over.
 *
 * READ-ONLY. select 만. 행 변경/삭제 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TODAY = process.env.TODAY || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // yyyy-mm-dd KST

function isAssigned(staff_id) {
  return staff_id !== null && staff_id !== undefined && String(staff_id).trim() !== '';
}

async function main() {
  console.log('=== A0/A3 room_assignments 진단 (READ-ONLY) ===');
  console.log('TODAY(KST):', TODAY);

  // 1) clinic 목록
  const { data: clinics, error: cErr } = await sb.from('clinics').select('id, name, slug');
  if (cErr) { console.error('clinics err', cErr); process.exit(1); }
  console.log('\n[clinics]');
  for (const c of clinics) console.log(`  ${c.id}  ${c.slug}  ${c.name}`);

  // 2) 최근 14일 room_assignments 날짜별·clinic별 분포
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const sinceStr = since.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  const { data: rows, error: rErr } = await sb
    .from('room_assignments')
    .select('id, clinic_id, date, room_name, staff_id, created_at')
    .gte('date', sinceStr)
    .order('date', { ascending: true });
  if (rErr) { console.error('room_assignments err', rErr); process.exit(1); }

  // 날짜×clinic 집계
  const byDateClinic = {};
  for (const r of rows) {
    const k = `${r.date}|${r.clinic_id}`;
    if (!byDateClinic[k]) byDateClinic[k] = { date: r.date, clinic_id: r.clinic_id, total: 0, assigned: 0, nul: 0, lastUpd: null };
    const g = byDateClinic[k];
    g.total++;
    if (isAssigned(r.staff_id)) g.assigned++; else g.nul++;
    const u = r.created_at;
    if (u && (!g.lastUpd || u > g.lastUpd)) g.lastUpd = u;
  }

  console.log('\n[날짜별·clinic별 분포 — total / assigned / null / last_write]');
  const keys = Object.keys(byDateClinic).sort();
  for (const k of keys) {
    const g = byDateClinic[k];
    console.log(`  ${g.date}  clinic=${g.clinic_id.slice(0,8)}  total=${g.total}  assigned=${g.assigned}  null=${g.nul}  last_write=${g.lastUpd}`);
  }

  // 3) A0 핵심: today 행 존재 여부 + carry-over baseline
  console.log('\n[A0 판별 — clinic별 today 유무 / baseline carry-over]');
  for (const c of clinics) {
    const todayRows = rows.filter(r => r.clinic_id === c.id && r.date === TODAY);
    const priorDates = [...new Set(rows.filter(r => r.clinic_id === c.id && r.date < TODAY).map(r => r.date))].sort();
    const baselineDate = priorDates.length ? priorDates[priorDates.length - 1] : null;
    const baselineRows = baselineDate ? rows.filter(r => r.clinic_id === c.id && r.date === baselineDate) : [];
    const baseAssigned = baselineRows.filter(r => isAssigned(r.staff_id)).length;
    const todayAssigned = todayRows.filter(r => isAssigned(r.staff_id)).length;

    if (todayRows.length === 0 && baselineRows.length === 0) continue; // skip empty clinics

    console.log(`  --- ${c.slug} (${c.id.slice(0,8)}) ---`);
    console.log(`    today(${TODAY}) rows=${todayRows.length}  assigned=${todayAssigned}`);
    console.log(`    baseline=${baselineDate} rows=${baselineRows.length}  assigned=${baseAssigned}`);
    if (todayRows.length === 0) {
      console.log(`    => today 행 없음 → 화면은 baseline(${baselineDate}) carry-over 표시. baseline assigned=${baseAssigned}/${baselineRows.length}`);
      if (baselineRows.length > 0 && baseAssigned <= 1) {
        console.log(`    *** H1 정황: baseline이 거의 전부 null(=과거 null-wipe 미복구). 신규 save 없이 그 빈 상태가 노출됨 ***`);
      }
    } else {
      console.log(`    => today 행 존재 → 화면은 today 우선. today assigned=${todayAssigned}/${todayRows.length}`);
      if (todayAssigned <= 1 && todayRows.length > 1) {
        console.log(`    *** today 행이 거의 전부 null → H2/H3(새 save가 null-wipe) 또는 H1(과거 null-wipe된 today행이 그대로) 가능. last_write 시각으로 신규/잔존 구분 ***`);
      }
    }
  }

  // 4) 06-06 ~ 06-11 상세 (RECUR4 손실 추적 구간)
  console.log('\n[06-05~TODAY 상세 row 덤프 (date/clinic/room/staff/last_write)]');
  const detail = rows.filter(r => r.date >= '2026-06-05').sort((a,b) => (a.date+a.clinic_id+a.room_name).localeCompare(b.date+b.clinic_id+b.room_name));
  for (const r of detail) {
    console.log(`  ${r.date} ${r.clinic_id.slice(0,8)} ${r.room_name.padEnd(12)} staff=${isAssigned(r.staff_id) ? String(r.staff_id).slice(0,8) : 'NULL'.padEnd(8)} upd=${r.created_at}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
