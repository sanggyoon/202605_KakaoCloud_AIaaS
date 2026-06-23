import { unstable_cache } from 'next/cache';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/app/lib/data';

// 평문 키 → sha-256 hex(소문자). BE hashlib.sha256(...).hexdigest()와 일치.
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// RPC 에러를 캐시하지 않기 위한 sentinel(throw → unstable_cache가 미캐시).
class AuthCheckError extends Error {}

// 해시 1건당 60초 캐시. true/false 둘 다 캐시(RPC 성공 시), 에러는 throw해 캐시 회피.
const cachedValidate = unstable_cache(
  async (hash: string): Promise<boolean> => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_api_key`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_hash: hash }),
      cache: 'no-store',
    });
    if (!res.ok) throw new AuthCheckError();
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  },
  ['api-key-valid'], // keyParts; 실제 캐시 키엔 인자(hash)가 자동 포함됨
  { revalidate: 60 },
);

// vm4 validate_api_key RPC로 키 유효성 확인. 결과를 해시 기준 60초 캐시.
export async function isValidApiKey(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  try {
    const hash = await sha256Hex(provided);
    return await cachedValidate(hash);
  } catch {
    return false; // 해시 실패·RPC 에러 → 미캐시 false
  }
}
