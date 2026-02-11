// src/types/GlobalSearch.ts
export type SearchPost = {
  id: string;
  entity_id?: string;
  title: string;
  snippet?: string;
  created_at?: string;
};

export type SearchPhone = {
  id: string;
  phone: string;
  ids?: string[];
  report_count: number;
  last_report_at?: string;
};

export type SearchBank = {
  id: string;
  bank_name: string;
  account_no_masked: string;
  ids?: string[];
  report_count: number;
  last_report_at?: string;
};
