// src/types/PostItem.ts
export type PostItem = {
  id: string;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  created_at?: string | number | null;
  author?: { id: string; name?: string | null } | null;

  images?: Array<{ id: string | number; url: string }> | null;

  tel_numbers?: Array<{ id: string; tel: string }> | null;
  seller_accounts?: Array<{ id: string; bank_name?: string | null; seller_account?: string | null }> | null;

  comments_count?: number | null;

  fb_permalink_url?: string | null;
  fb_status?: string | null;
};
