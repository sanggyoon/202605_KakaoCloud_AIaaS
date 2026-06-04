'use client';

// 매니저 페이지 — 포스터 클릭 시 영화 상세 정보(메타데이터 + 벡터 + 벡터 메타)를
// 텍스트로 조회하고 수정·저장(PATCH)하는 모달.
import { useState, useEffect, useCallback } from 'react';
import { posterUrl } from '@/app/lib/data';

// movies 테이블에서 수정 가능한 메타데이터 필드 정의
interface MovieMeta {
  tmdb_id: number;
  imdb_id?: string | null;
  title?: string | null;
  original_title?: string | null;
  poster_path?: string | null;
  director?: string | null;
  release_year?: number | null;
  runtime?: number | null;
  genre?: string | null;
  actors?: string | null;
  overview?: string | null;
  youtube_key?: string | null;
  has_vector?: boolean | null;
}

interface VectorRow {
  vector?: string | number[] | null;
  vector_version?: string | null;
  normalization?: string | null;
  smoothing_method?: string | null;
}

interface DetailResponse {
  movie: MovieMeta | null;
  vector: VectorRow | null;
  detail?: string; // 에러 메시지 (FastAPI HTTPException)
}

// pgvector REST 응답("[0.1,...]" 문자열 또는 배열)을 number[]로 변환
function parseVector(raw: string | number[] | null | undefined): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

// 수정 가능한 텍스트 메타데이터 필드 (라벨, 멀티라인 여부)
const TEXT_FIELDS: { key: keyof MovieMeta; label: string; multiline?: boolean }[] = [
  { key: 'title', label: '제목' },
  { key: 'original_title', label: '원제' },
  { key: 'director', label: '감독' },
  { key: 'genre', label: '장르 (쉼표 구분)' },
  { key: 'actors', label: '배우 (쉼표 구분)' },
  { key: 'overview', label: '줄거리', multiline: true },
  { key: 'youtube_key', label: 'YouTube 키' },
  { key: 'imdb_id', label: 'IMDB ID' },
  { key: 'poster_path', label: '포스터 경로' },
];

const NUM_FIELDS: { key: keyof MovieMeta; label: string }[] = [
  { key: 'release_year', label: '개봉연도' },
  { key: 'runtime', label: '러닝타임(분)' },
];

export default function MovieDetailModal({
  tmdbId,
  fallbackTitle,
  onClose,
}: {
  tmdbId: number;
  fallbackTitle?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<MovieMeta | null>(null);
  const [vectorRow, setVectorRow] = useState<VectorRow | null>(null);

  // 수정 폼 상태 — 모든 값은 문자열로 다룬 뒤 저장 시 변환
  const [form, setForm] = useState<Record<string, string>>({});
  const [vectorText, setVectorText] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/movies/${tmdbId}`);
      const data: DetailResponse = await res.json();
      if (!res.ok || !data.movie) {
        setError(data.detail ?? 'DB에 저장되지 않은 영화입니다. 먼저 추가해 주세요.');
        return;
      }
      setMeta(data.movie);
      setVectorRow(data.vector);

      // 폼 초기화
      const initial: Record<string, string> = {};
      for (const { key } of [...TEXT_FIELDS, ...NUM_FIELDS]) {
        const v = data.movie[key];
        initial[key as string] = v == null ? '' : String(v);
      }
      setForm(initial);

      const vec = parseVector(data.vector?.vector);
      setVectorText(vec.length ? JSON.stringify(vec) : '');
    } catch {
      setError('상세 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [tmdbId]);

  useEffect(() => {
    load();
  }, [load]);

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setField = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      // 메타데이터 payload 구성 (빈 문자열은 null로)
      const movie: Record<string, unknown> = {};
      for (const { key } of TEXT_FIELDS) {
        const raw = form[key as string] ?? '';
        movie[key as string] = raw.trim() === '' ? null : raw;
      }
      for (const { key } of NUM_FIELDS) {
        const raw = (form[key as string] ?? '').trim();
        if (raw === '') {
          movie[key as string] = null;
        } else {
          const n = Number(raw);
          if (Number.isNaN(n)) {
            setSaveMsg(`숫자 필드 형식 오류: ${key as string}`);
            setSaving(false);
            return;
          }
          movie[key as string] = n;
        }
      }

      const payload: { movie: Record<string, unknown>; vector?: number[] } = { movie };

      // 벡터가 입력되어 있으면 파싱해서 함께 전송
      const vt = vectorText.trim();
      if (vt !== '') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(vt);
        } catch {
          setSaveMsg('벡터는 JSON 숫자 배열이어야 합니다. 예: [0.1, -0.2, ...]');
          setSaving(false);
          return;
        }
        if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'number')) {
          setSaveMsg('벡터는 숫자만 담긴 배열이어야 합니다.');
          setSaving(false);
          return;
        }
        payload.vector = parsed as number[];
      }

      const res = await fetch(`/api/manager/movies/${tmdbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg(data.detail ?? '저장에 실패했습니다.');
        return;
      }
      setSaveMsg('저장되었습니다 ✓');
      // 화면 표시값 갱신
      load();
    } catch {
      setSaveMsg('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const img = posterUrl(meta?.poster_path ?? form.poster_path);
  const vecPreview = parseVector(vectorRow?.vector);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '48px 20px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 760,
          background: '#0d0e13', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14, overflow: 'hidden',
          fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
          color: 'var(--fg)',
        }}
      >
        {/* Header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 22px',
          background: 'rgba(13,14,19,0.95)', backdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {meta?.title ?? fallbackTitle ?? '영화 상세'}
            </h2>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-mono), monospace' }}>
              #{tmdbId}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 0,
          }}>×</button>
        </div>

        <div style={{ padding: '22px' }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              불러오는 중...
            </div>
          ) : error ? (
            <div style={{ padding: '30px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🎬</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{error}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* 상단: 포스터 + 메타 요약 */}
              <div style={{ display: 'flex', gap: 18 }}>
                <div style={{
                  width: 120, flexShrink: 0, aspectRatio: '2/3',
                  borderRadius: 8, overflow: 'hidden', background: '#111218',
                }}>
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt={meta?.title ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 28 }}>🎬</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                  <Badge label="벡터" value={meta?.has_vector ? '있음 ✓' : '없음'} ok={!!meta?.has_vector} />
                  <KV k="벡터 버전" v={vectorRow?.vector_version ?? '—'} />
                  <KV k="정규화" v={vectorRow?.normalization ?? '—'} />
                  <KV k="스무딩" v={vectorRow?.smoothing_method ?? '—'} />
                  <KV k="차원 수" v={vecPreview.length ? `${vecPreview.length}` : '—'} />
                </div>
              </div>

              {/* 메타데이터 수정 */}
              <Section title="메타데이터">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {NUM_FIELDS.map(({ key, label }) => (
                    <Field key={key as string} label={label}>
                      <input
                        type="number"
                        value={form[key as string] ?? ''}
                        onChange={(e) => setField(key as string, e.target.value)}
                        style={inputStyle}
                      />
                    </Field>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 }}>
                  {TEXT_FIELDS.map(({ key, label, multiline }) => (
                    <Field key={key as string} label={label}>
                      {multiline ? (
                        <textarea
                          value={form[key as string] ?? ''}
                          onChange={(e) => setField(key as string, e.target.value)}
                          rows={3}
                          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                        />
                      ) : (
                        <input
                          value={form[key as string] ?? ''}
                          onChange={(e) => setField(key as string, e.target.value)}
                          style={inputStyle}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </Section>

              {/* 클라이맥스 벡터 (씬 스코어 시계열) 수정 */}
              <Section title="클라이맥스 벡터 (씬 스코어 시계열)">
                <p style={{ margin: '0 0 8px', fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
                  씬 스코어를 시계열 처리·정규화한 {vecPreview.length || 200}차원 벡터입니다.
                  JSON 숫자 배열 형식으로 직접 수정할 수 있습니다.
                </p>
                <textarea
                  value={vectorText}
                  onChange={(e) => setVectorText(e.target.value)}
                  rows={6}
                  placeholder="[0.12, -0.34, ...]"
                  style={{
                    ...inputStyle,
                    fontFamily: 'var(--font-mono), monospace',
                    fontSize: 11, lineHeight: 1.5, resize: 'vertical',
                    whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto',
                  }}
                />
              </Section>
            </div>
          )}
        </div>

        {/* Footer 저장 바 */}
        {!loading && !error && (
          <div style={{
            position: 'sticky', bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14,
            padding: '14px 22px',
            background: 'rgba(13,14,19,0.95)', backdropFilter: 'blur(8px)',
            borderTop: '1px solid rgba(255,255,255,0.07)',
          }}>
            {saveMsg && (
              <span style={{
                fontSize: 12,
                color: saveMsg.includes('✓') ? 'rgb(74,222,128)' : 'rgb(248,113,113)',
              }}>
                {saveMsg}
              </span>
            )}
            <button onClick={onClose} style={{
              padding: '8px 16px', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7,
              color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
              닫기
            </button>
            <button onClick={handleSave} disabled={saving} style={{
              padding: '8px 20px', border: 'none', borderRadius: 7,
              background: 'color-mix(in oklch, var(--accent) 22%, transparent)',
              color: 'var(--accent)', fontSize: 12, fontWeight: 700,
              fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}>
              {saving ? '저장 중...' : '저장 (DB 업데이트)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6, color: 'var(--fg)',
  fontSize: 12, fontFamily: 'inherit', outline: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 style={{
        margin: '0 0 12px', fontSize: 11, fontWeight: 700,
        letterSpacing: '0.12em', color: 'var(--accent)', textTransform: 'uppercase',
      }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: 'rgba(255,255,255,0.35)', minWidth: 56 }}>{k}</span>
      <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'rgba(255,255,255,0.75)' }}>{v}</span>
    </div>
  );
}

function Badge({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ color: 'rgba(255,255,255,0.35)', minWidth: 56 }}>{label}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
        background: ok ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
        color: ok ? 'rgb(74,222,128)' : 'rgba(255,255,255,0.4)',
      }}>
        {value}
      </span>
    </div>
  );
}
