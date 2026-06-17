'use client';

import { useEffect, useState } from 'react';

interface ApiKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
}

interface CreatedKey {
  id: number;
  name: string;
  key: string;
  key_prefix: string;
}

export default function ApiKeyManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/manager/api-keys', { cache: 'no-store' });
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // 모달이 열릴 때 상태 초기화 + 목록 1회 로드 (fetch-on-open).
  useEffect(() => {
    if (open) {
      setCreated(null);
      setError('');
      load();
    }
  }, [open]);

  const create = async () => {
    if (!name.trim()) return;
    setError('');
    const res = await fetch('/api/manager/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      setError('키 생성에 실패했습니다.');
      return;
    }
    setCreated((await res.json()) as CreatedKey);
    setName('');
    load();
  };

  const revoke = async (id: number) => {
    await fetch(`/api/manager/api-keys/${id}`, { method: 'DELETE' });
    load();
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 100%)', maxHeight: '80vh', overflowY: 'auto',
          background: 'rgba(16,17,23,0.98)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: 24, color: 'var(--fg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>API 키 관리</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {/* 생성 폼 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="키 이름 (예: customer-acme)"
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--fg)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button
            onClick={create}
            style={{
              padding: '9px 16px', borderRadius: 8, border: '1px solid var(--accent)',
              background: 'color-mix(in oklch, var(--accent) 18%, transparent)',
              color: 'var(--fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            발급
          </button>
        </div>
        {error && <div style={{ color: 'rgb(239,120,120)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        {/* 새로 생성된 평문 키 — 1회 표시 */}
        {created && (
          <div style={{
            margin: '8px 0 16px', padding: 14, borderRadius: 10,
            background: 'rgba(123,97,255,0.1)', border: '1px solid rgba(123,97,255,0.35)',
          }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              아래 키는 <b>지금 한 번만</b> 표시됩니다. 복사해 안전하게 보관하세요.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', color: '#fff' }}>{created.key}</code>
              <button
                onClick={() => navigator.clipboard?.writeText(created.key)}
                style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'var(--fg)', fontSize: 12, cursor: 'pointer' }}
              >
                복사
              </button>
            </div>
          </div>
        )}

        {/* 목록 */}
        {loading ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '12px 0' }}>로딩 중...</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '12px 0' }}>발급된 키가 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                borderRadius: 8, background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)', opacity: r.active ? 1 : 0.5,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                    {r.key_prefix}… · {new Date(r.created_at).toLocaleDateString('ko-KR')}
                    {r.last_used_at ? ` · 최근 ${new Date(r.last_used_at).toLocaleDateString('ko-KR')}` : ' · 미사용'}
                  </div>
                </div>
                {r.active ? (
                  <button
                    onClick={() => revoke(r.id)}
                    style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: 'rgb(239,120,120)', fontSize: 12, cursor: 'pointer' }}
                  >
                    폐기
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>폐기됨</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
