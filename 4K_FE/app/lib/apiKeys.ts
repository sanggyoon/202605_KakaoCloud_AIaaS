import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/app/lib/data';

// 평문 키 → sha-256 hex(소문자). BE hashlib.sha256(...).hexdigest()와 일치.
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// vm4 validate_api_key RPC로 키 유효성 확인. 유효(활성 키 1건 매칭)하면 true.
export async function isValidApiKey(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  try {
    const hash = await sha256Hex(provided);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_api_key`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_hash: hash }),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
