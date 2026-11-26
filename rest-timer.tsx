import React, { useEffect, useState } from 'react';

interface RestTimerProps {
  exerciseName: string;
  initialSec: number;
  triggerKey: number;
  onDismiss: () => void;
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function playDoneChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // Ignore audio failures in autoplay-restricted or headless environments.
  }
}

export function RestTimer({ exerciseName, initialSec, triggerKey, onDismiss }: RestTimerProps) {
  const [total, setTotal] = useState(initialSec);
  const [remaining, setRemaining] = useState(initialSec);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setTotal(initialSec);
    setRemaining(initialSec);
    setPaused(false);
  }, [initialSec, triggerKey]);

  useEffect(() => {
    if (paused || remaining <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          playDoneChime();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [paused, remaining]);

  const progress = total > 0 ? Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100))) : 100;

  return (
    <div className="rest-timer-bar" role="region" aria-label="组间倒计时">
      <div className="rest-timer-progress" style={{ width: `${progress}%` }} />
      <div className="rest-timer-content">
        <div>
          <small>{exerciseName} · 组间歇</small>
          <strong className="rest-clock">{remaining === 0 ? '准备下一组！' : formatClock(remaining)}</strong>
        </div>
        <div className="rest-timer-actions">
          <button
            type="button"
            className="alt"
            onClick={() => setRemaining((prev) => Math.max(0, prev - 15))}
          >
            -15s
          </button>
          <button
            type="button"
            className="alt"
            onClick={() => {
              setRemaining((prev) => prev + 30);
              setTotal((prev) => Math.max(prev, remaining + 30));
            }}
          >
            +30s
          </button>
          <button type="button" className="alt" onClick={() => setPaused((p) => !p)}>
            {paused ? '继续' : '暂停'}
          </button>
          <button type="button" onClick={onDismiss}>
            跳过
          </button>
        </div>
      </div>
    </div>
  );
}
