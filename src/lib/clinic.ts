import { supabase } from '@/integrations/supabase/client';

export interface Clinic {
  id: string;
  name: string;
  slug: string;
  open_time: string | null;
  close_time: string | null;
  slot_interval: number | null;
  consultation_rooms: number | null;
  treatment_rooms: number | null;
  max_per_slot: number | null;
  slots: string[] | null;
  room_names: Record<string, string> | null;
}

export interface DaySchedule {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
}

export interface Holiday {
  holiday_date: string;
  memo: string | null;
}

const STORAGE_KEY = 'ose_selected_clinic';

export function getSelectedClinicId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setSelectedClinicId(id: string) {
  localStorage.setItem(STORAGE_KEY, id);
}

export async function fetchClinics(): Promise<Clinic[]> {
  const { data } = await supabase.from('clinics').select('*').order('name');
  return (data || []) as unknown as Clinic[];
}

export async function getSelectedClinic(): Promise<Clinic | null> {
  const savedId = getSelectedClinicId();
  const clinics = await fetchClinics();

  if (savedId) {
    const found = clinics.find(c => c.id === savedId);
    if (found) return found;
  }

  // Default to first
  if (clinics.length > 0) {
    setSelectedClinicId(clinics[0].id);
    return clinics[0];
  }

  return null;
}

export async function getClinicSchedules(clinicId: string): Promise<DaySchedule[]> {
  const { data } = await (supabase.from('clinic_schedules') as any).select('day_of_week, open_time, close_time, is_closed').eq('clinic_id', clinicId).order('day_of_week');
  return (data || []) as DaySchedule[];
}

export async function getClinicHolidays(clinicId: string, startDate: string, endDate: string): Promise<Holiday[]> {
  const { data } = await (supabase.from('clinic_holidays') as any).select('holiday_date, memo').eq('clinic_id', clinicId).gte('holiday_date', startDate).lte('holiday_date', endDate);
  return (data || []) as Holiday[];
}

// Get open/close time for a specific date, considering day-of-week schedule and holidays
export function getHoursForDate(date: Date, schedules: DaySchedule[], holidays: Holiday[], defaultOpen: string, defaultClose: string): { open: string; close: string; isClosed: boolean } {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  // Check holiday first
  const holiday = holidays.find(h => h.holiday_date === dateStr);
  if (holiday) return { open: '', close: '', isClosed: true };

  // Check day of week (JS: 0=Sun)
  const dow = date.getDay();
  const schedule = schedules.find(s => s.day_of_week === dow);

  if (schedule) {
    if (schedule.is_closed) return { open: '', close: '', isClosed: true };
    return {
      open: schedule.open_time || defaultOpen,
      close: schedule.close_time || defaultClose,
      isClosed: false,
    };
  }

  return { open: defaultOpen, close: defaultClose, isClosed: false };
}
