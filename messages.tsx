import React, { useEffect, useRef, useState } from 'react';
import type { ApiClient, MeResponse, MessageRow } from './types';

export function useUnread(api: ApiClient, me: MeResponse | null | undefined): Record<number, number> {
  const [counts, setCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!me) return;
    let active = true;
    let seq = 0;

    async function load() {
      const requestSeq = ++seq;
      try {
        const result = await api('messages/unread');
        if (active && requestSeq === seq) {
          setCounts(Object.fromEntries(result.counts.map((item: any) => [item.student, Number(item.count)])));
        }
      } catch {
        // Ignore transient polling failures.
      }
    }

    load();
    const timer = setInterval(load, 3000);
    window.addEventListener('message-count', load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('message-count', load);
    };
  }, [me]);

  return counts;
}

function mergeMessages(existing: MessageRow[], incoming: MessageRow[]): MessageRow[] {
  const items = new Map<number, MessageRow>(existing.map((msg) => [msg.id, msg]));
  incoming.forEach((msg) => items.set(msg.id, msg));
  return Array.from(items.values()).sort((a, b) => a.id - b.id);
}

interface ChatProps {
  api: ApiClient;
  coach: boolean;
  student: number;
  name?: string;
  close: () => void;
}

function Chat({ api, coach, student, name, close }: ChatProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const requestToken = useRef('');
  const firstId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tailId = useRef(0);
  const alive = useRef(true);

  async function loadThread(before = 0) {
    try {
      const result = await api(
        'messages/thread?student=' + student + (before ? '&before=' + before : '')
      );
      if (!alive.current) return;
      const hasGap = !before && result.older && tailId.current > 0 && result.rows[0]?.id > tailId.current;
      if (before || !firstId.current || hasGap) {
        setHasOlder(result.older);
        firstId.current = result.rows[0]?.id || 0;
      }
      setRows((prev) => mergeMessages(hasGap ? [] : prev, result.rows));
    } catch (error) {
      if (alive.current) setErrorMsg((error as Error).message);
    }
  }

  useEffect(() => {
    dialog.current?.showModal();
    alive.current = true;
    loadThread();
    const timer = setInterval(() => {
      if (!document.hidden) loadThread();
    }, 2500);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!rows.length) return;
    const latest = rows[rows.length - 1].id;
    const box = listRef.current;
    const myRole = coach ? 'coach' : 'student';

    if (
      box &&
      latest !== tailId.current &&
      (!tailId.current ||
        box.scrollHeight - box.scrollTop - box.clientHeight < 200 ||
        rows[rows.length - 1].sender === myRole)
    ) {
      box.scrollTop = box.scrollHeight;
    }
    tailId.current = latest;

    const unreadIds = rows.filter((msg) => !msg.seen && msg.sender !== myRole).map((msg) => msg.id);

    async function markRead() {
      if (document.hidden) return;
      try {
        for (let i = 0; i < unreadIds.length; i += 50) {
          await api('messages/read', { student, ids: unreadIds.slice(i, i + 50) });
        }
        if (unreadIds.length) {
          window.dispatchEvent(new Event('message-count'));
        }
      } catch (error) {
        if (alive.current) setErrorMsg((error as Error).message);
      }
    }

    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [rows]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      requestToken.current ||=
        globalThis.crypto.randomUUID?.() ||
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      await api('messages/send', {
        student,
        body: text,
        requestId: requestToken.current,
      });
      setText('');
      requestToken.current = '';
      await loadThread();
    } catch (error) {
      setErrorMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="desk chat" aria-label="训练对话" onCancel={close}>
      <div className="deskhead">
        <h2>{coach ? name : '教练'} · 训练对话</h2>
        <button onClick={close}>关闭</button>
      </div>

      <div ref={listRef} className="chatlog">
        {hasOlder && (
          <button className="alt" onClick={() => loadThread(firstId.current)}>
            查看更早消息
          </button>
        )}
        {!rows.length && <p>暂无消息</p>}
        {rows.map((msg) => {
          const isMine = msg.sender === (coach ? 'coach' : 'student');
          return (
            <div className={isMine ? 'bubble mine' : 'bubble'} key={msg.id}>
              <small>
                {isMine ? '我' : coach ? name : '教练'} · {new Date(msg.created).toLocaleString('zh-CN')}
              </small>
              <p>{msg.body}</p>
              {isMine && <small>{msg.seen ? '已读' : '未读'}</small>}
            </div>
          );
        })}
      </div>

      <form onSubmit={sendMessage}>
        <label style={{ display: 'grid' }}>
          消息内容
          <textarea
            value={text}
            disabled={busy}
            maxLength={2000}
            onChange={(event) => {
              setText(event.target.value);
              requestToken.current = '';
            }}
          />
        </label>
        <button disabled={busy || !text.trim()}>发送消息</button>
      </form>

      {errorMsg && <aside>{errorMsg}</aside>}
    </dialog>
  );
}

interface MessageEntryProps {
  api: ApiClient;
  coach: boolean;
  student: number;
  name?: string;
  count?: number;
}

export function MessageEntry({ api, coach, student, name, count }: MessageEntryProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button disabled={coach && !student} onClick={() => setOpen(true)}>
        {coach ? '学员消息' : '教练消息'}
        {count ? ` · ${count} 条未读` : ''}
      </button>
      {open && <Chat api={api} coach={coach} student={student} name={name} close={() => setOpen(false)} />}
    </>
  );
}
