import { deriveAgeCopay, ageFromBirth, birthYearAgeLabel, resolveEffectiveGrade } from '../../src/lib/age.ts';
let pass=0, fail=0;
function chk(name:string, got:unknown, want:unknown){ const g=JSON.stringify(got), w=JSON.stringify(want); if(g===w){pass++;console.log(`✓ ${name}`);} else {fail++;console.log(`✗ ${name}\n    got=${g}\n   want=${w}`);} }
const T='2026-07-20'; // 오늘 KST
// AC-1: 1961-07-20 생일당일 → 만65 → elderly_flat
chk('AC-1 elderly 생일당일', deriveAgeCopay('1961-07-20',T).kind, 'elderly_flat');
// AC-2: 1961-07-21 생일전날 → 만64 → 파생없음(일반)
chk('AC-2 만64 파생없음', deriveAgeCopay('1961-07-21',T).kind, null);
chk('AC-2 age', deriveAgeCopay('1961-07-21',T).ageYears, 64);
// AC-3: 1926-05-15 만100 → elderly (0세 오판 없음)
chk('AC-3 만100 elderly', deriveAgeCopay('1926-05-15',T).kind, 'elderly_flat');
chk('AC-3 age100', deriveAgeCopay('1926-05-15',T).ageYears, 100);
// AC-4: 2026-01-10 만0 → infant_under1 5%
chk('AC-4 infant<1 5%', deriveAgeCopay('2026-01-10',T).rateOverride, 0.05);
chk('AC-4 kind', deriveAgeCopay('2026-01-10',T).kind, 'infant_under1');
// AC-5: 2021-01-10 만5 → 21% (infant_under6, override null)
chk('AC-5 만5 infant_under6', deriveAgeCopay('2021-01-10',T).kind, 'infant_under6');
chk('AC-5 override null(21%)', deriveAgeCopay('2021-01-10',T).rateOverride, null);
// AC-6: 2020-01-10 만6 → 파생없음(일반)
chk('AC-6 만6 파생없음', deriveAgeCopay('2020-01-10',T).kind, null);
chk('AC-6 age6', deriveAgeCopay('2020-01-10',T).ageYears, 6);
// AC-7: RPC 완전연도 정확판정 (1961-07-20 완전연도 → elderly, not blocked)
chk('AC-7 완전연도 not blocked', deriveAgeCopay('1961-07-20',T).blocked, false);
// AC-8: birth 미상 → blocked
chk('AC-8 null blocked', deriveAgeCopay(null,T).blocked, true);
chk('AC-8 empty blocked', deriveAgeCopay('',T).blocked, true);
// AC-9 timebomb: 27년생 데이터를 2027-01-01 시각 판정 → 2027 (표시), 세기 하드코딩 26 미사용
chk('AC-9 표시 2027경계(레거시 270101)', birthYearAgeLabel('270101','2027-01-01'), '2027 (만 0세)');
chk('AC-9 표시 26→2026(2026시각)', birthYearAgeLabel('260101','2026-06-01'), '2026 (만 0세)');
// 레거시 2자리는 계산용 blocked (세기 불확실)
chk('레거시 계산 blocked', deriveAgeCopay('610720',T).blocked, true);
// AC-10 SSOT: 완전연도 표시 일치
chk('AC-10 표시 1990', birthYearAgeLabel('1990-03-15','2026-07-20'), '1990 (만 36세)');
chk('AC-10 ageFromBirth 1990', ageFromBirth('1990-03-15','2026-07-20'), 36);
// resolveEffectiveGrade: 급여종별 우선(의급1 유지, 나이 무시)
chk('resolve 의급 우선', resolveEffectiveGrade('medical_aid_1', deriveAgeCopay('1961-07-20',T)).grade, 'medical_aid_1');
// general + 나이 elderly → elderly 파생 우선
chk('resolve general→elderly', resolveEffectiveGrade('general', deriveAgeCopay('1961-07-20',T)).grade, 'elderly_flat');
// unverified + birth 미상 → blocked 전파(AC-8)
chk('resolve unverified+미상 blocked', resolveEffectiveGrade('unverified', deriveAgeCopay(null,T)).blocked, true);
// general + birth 미상 → general 유지(진행)
chk('resolve general+미상 유지', resolveEffectiveGrade('general', deriveAgeCopay(null,T)).grade, 'general');
console.log(`\n=== ${pass} pass / ${fail} fail ===`);
process.exit(fail?1:0);
