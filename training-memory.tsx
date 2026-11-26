import React, { useEffect, useRef, useState } from 'react';
import type { ApiClient, TrainingMemoryRow } from './types';

interface TrainingMemoryProps {
  api: ApiClient;
  student: number;
  name?: string;
}

export function TrainingMemory({ api, student, name }: TrainingMemoryProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<TrainingMemoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function callMemory(action: 'list' | 'generate' | 'review', args: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage('');
    try {
      const result = await api('coach/memory/' + action, { student, ...args });
      setRows(result.rows);
      if (action === 'review' && typeof args.id === 'string') {
        setEdits((prev) => {
          const next = { ...prev };
          delete next[args.id as string];
          return next;
        });
      }
      if (action === 'generate') {
        setMessage(
          result.rows.length
            ? '建议已更新，相同依据仅保留一条。'
            : '目前还没有可生成建议的训练记录。'
        );
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setRows([]);
    setEdits({});
  }, [student]);

  return (
    <>
      <button
        disabled={!student}
        onClick={() => {
          dialog.current?.showModal();
          callMemory('list');
        }}
      >
        训练记忆
      </button>

      <dialog className="desk" ref={dialog} aria-label="训练记忆">
        <div className="deskhead">
          <h2>{name} · 训练记忆</h2>
          <button onClick={() => dialog.current?.close()}>关闭</button>
        </div>

        <p>生成后请核对依据。只有已接受的内容会供下次 AI 编排参考。</p>
        <button disabled={busy} onClick={() => callMemory('generate')}>
          生成记忆建议
        </button>

        {message && <output>{message}</output>}
        {!busy && !rows.length && <p>暂无记忆。</p>}

        {rows.map((row) => {
          const currentNote = edits[row.id] ?? row.note;
          const actions: Array<{ title: string; status: TrainingMemoryRow['status'] }> = [
            { title: '保存修改', status: row.status },
            { title: '接受', status: '已接受' },
            { title: '拒绝', status: '已拒绝' },
          ];

          return (
            <article key={row.id}>
              <h3>
                {row.category} · {row.status}
              </h3>
              <p style={{ whiteSpace: 'pre-line' }}>{row.evidence}</p>
              <label style={{ display: 'grid' }}>
                记忆内容
                <textarea
                  maxLength={1000}
                  value={currentNote}
                  onChange={(event) => setEdits({ ...edits, [row.id]: event.target.value })}
                />
              </label>
              {actions.map(({ title, status }) => (
                <button
                  key={title}
                  disabled={busy || !currentNote.trim()}
                  onClick={() =>
                    callMemory('review', {
                      id: row.id,
                      rev: row.rev,
                      note: currentNote,
                      status,
                    })
                  }
                >
                  {title}
                </button>
              ))}
            </article>
          );
        })}
      </dialog>
    </>
  );
}
