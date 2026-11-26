import type { ExerciseItem, SessionMetrics, SetLogEntry, SetLogUnit } from './types';

export const LB_TO_KG = 0.45359237;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function calculateEpley1RM(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || !Number.isInteger(reps) || reps < 1 || reps > 12) {
    return null;
  }
  if (reps === 1) {
    return round1(weightKg);
  }
  return round1(weightKg * (1 + reps / 30));
}

export function createInitialSetLogs(items: ExerciseItem[], existing?: SetLogEntry[][] | null, fallbackSets?: boolean[][] | null): SetLogEntry[][] {
  return items.map((item, itemIndex) => {
    const existingRow = existing?.[itemIndex];
    const fallbackRow = fallbackSets?.[itemIndex];
    const defaultUnit: SetLogUnit = item.loadUnit === 'lb' ? 'lb' : 'kg';
    const defaultWeight =
      item.load != null && (item.loadUnit === 'kg' || item.loadUnit === 'lb' || !item.loadUnit)
        ? item.load
        : null;

    return Array.from({ length: item.sets }, (_, setIndex) => {
      const saved = existingRow?.[setIndex];
      if (saved) {
        return {
          done: Boolean(saved.done),
          weight: saved.weight ?? null,
          unit: saved.unit === 'lb' ? 'lb' : 'kg',
          reps: saved.reps ?? null,
          rpe: saved.rpe ?? null,
        };
      }
      return {
        done: Boolean(fallbackRow?.[setIndex]),
        weight: defaultWeight,
        unit: defaultUnit,
        reps: item.qty,
        rpe: null,
      };
    });
  });
}

export function computeSessionMetrics(items: ExerciseItem[], setLogs: SetLogEntry[][]): SessionMetrics {
  let totalRawKg = 0;

  const exercises = items.map((item, itemIndex) => {
    const row = setLogs[itemIndex];
    if (!Array.isArray(row) || item.unit !== '次') {
      return { volumeKg: 0, bestE1rmKg: null };
    }

    let exerciseRawKg = 0;
    let bestE1rmKg: number | null = null;

    for (const entry of row) {
      if (!entry.done) continue;
      if (!(entry.weight && entry.weight > 0) || !(entry.reps && entry.reps > 0)) continue;
      const weightKg = entry.unit === 'lb' ? entry.weight * LB_TO_KG : entry.weight;
      exerciseRawKg += weightKg * entry.reps;
      const e1rm = calculateEpley1RM(weightKg, entry.reps);
      if (e1rm !== null && (bestE1rmKg === null || e1rm > bestE1rmKg)) {
        bestE1rmKg = e1rm;
      }
    }

    totalRawKg += exerciseRawKg;
    return {
      volumeKg: round1(exerciseRawKg),
      bestE1rmKg,
    };
  });

  return {
    totalVolumeKg: round1(totalRawKg),
    exercises,
  };
}

export function formatPrescriptionTags(item: ExerciseItem): string[] {
  const tags: string[] = [];
  if (item.load != null && item.loadUnit && item.loadUnit !== '自重') {
    tags.push(item.loadUnit === '%1RM' ? `${item.load}% 1RM` : `${item.load} ${item.loadUnit}`);
  } else if (item.loadUnit === '自重') {
    tags.push('自重');
  }
  if (item.targetRpe != null) tags.push(`目标 RPE ${item.targetRpe}`);
  if (item.restSec != null) tags.push(`间歇 ${item.restSec} 秒`);
  if (item.tempo) tags.push(`节奏 ${item.tempo}`);
  return tags;
}
