import React, { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './types';

interface CopilotTurn {
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: Array<{ tool: string; summary: string }>;
}

interface CoachCopilotProps {
  api: ApiClient;
  student: number;
  name?: string;
  day: string;
  onDraftUpdated: (studentId: number, targetDay: string) => void;
}

const QUICK_PROMPTS = [
  '总结近期训练负荷、预估 1RM 与晨起状态',
  '检索适合居家无器械的核心与下肢动作',
  '为当日生成一套低负荷恢复课草稿',
];

export function CoachCopilot({ api, student, name, day, onDraftUpdated }: CoachCopilotProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [input, setInput] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setTurns([]);
    setErr('');
  }, [student]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  async function sendPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !student) return;
    setBusy(true);
    setErr('');
    const nextHistory = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');

    try {
      const result = await api('coach/copilot', {
        student,
        day,
        message: trimmed,
        history: nextHistory,
        localOnly,
      });
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.reply,
          toolTrace: result.toolTrace || [],
        },
      ]);
      if (result.draftUpdated) {
        onDraftUpdated(result.draftUpdated.student, result.draftUpdated.day);
      }
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" disabled={!student} onClick={() => setOpen(true)}>
        AI 教练副驾驶
      </button>

      {open && (
        <dialog
          ref={dialog}
          className="desk chat"
          aria-label="AI 教练副驾驶"
          onCancel={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div className="deskhead">
            <h2>{name} · AI 教练副驾驶</h2>
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>

          <small>
            当前日期 {day} · 副驾驶可查档案、检索动作库并写入教练草稿（严禁直接发布，仍需教练审核发布）。
          </small>

          <div className="copilot-chips">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                type="button"
                key={prompt}
                className="alt"
                disabled={busy}
                onClick={() => sendPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="chatlog">
            {turns.length === 0 && <p>输入自然语言指令，例如「把明天的下肢课改成无器械恢复草稿」。</p>}
            {turns.map((turn, idx) => (
              <div key={idx} className={turn.role === 'user' ? 'bubble mine' : 'bubble'}>
                <small>{turn.role === 'user' ? '教练' : 'AI 副驾驶'}</small>
                {turn.toolTrace && turn.toolTrace.length > 0 && (
                  <div className="tool-trace">
                    {turn.toolTrace.map((trace, i) => (
                      <small key={i}>
                        ⚙ {trace.tool}：{trace.summary}
                      </small>
                    ))}
                  </div>
                )}
                <p>{turn.content}</p>
              </div>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              sendPrompt(input);
            }}
          >
            <label style={{ display: 'grid' }}>
              副驾驶指令
              <textarea
                maxLength={1000}
                disabled={busy}
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <div className="editor-row">
              <button disabled={busy || !input.trim()}>{busy ? '思考中…' : '发送指令'}</button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={localOnly}
                  onChange={(event) => setLocalOnly(event.target.checked)}
                />
                本地工具直出（免外部模型）
              </label>
            </div>
          </form>

          {err && <aside>{err}</aside>}
        </dialog>
      )}
    </>
  );
}
