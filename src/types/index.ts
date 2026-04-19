// Shared interfaces — single source of truth
export interface Customer {
  id: string;
  name: string;
  phone: string;
  memo: string | null;
  created_at?: string;
}

export interface VisitRecord {
  id: string;
  checked_in_at: string;
  status: string;
  queue_number: number;
  referral_source?: string;
  check_in_id?: string;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  method: string;
  installment: number;
  memo: string | null;
  created_at: string;
  check_in_id: string | null;
  customer_id?: string;
}

export interface ReservationRecord {
  id: string;
  reservation_date: string;
  reservation_time: string;
  status: string;
  memo: string | null;
  service_id?: string | null;
  created_by?: string | null;
}

export interface ServiceRecord {
  service_name: string;
  price: number;
  check_in_id: string;
}
