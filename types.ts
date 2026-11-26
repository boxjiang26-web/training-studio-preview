export type ApiClient = (path: string, data?: unknown) => Promise<any>;

export type ExerciseUnit = '次' | '秒';
export type LoadUnit = 'kg' | 'lb' | '%1RM' | '自重';
export type SetLogUnit = 'kg' | 'lb';

export interface CustomExercise {
  id: string;
  name: string;
  category: string;
  muscles: string[];
  equipment: string[];
  notes: string;
  created: string;
  custom: true;
}

export interface ExerciseItem {
  id?: string;
  name: string;
  sets: number;
  qty: number;
  unit: ExerciseUnit;
  load?: number | null;
  loadUnit?: LoadUnit;
  targetRpe?: number | null;
  restSec?: number | null;
  tempo?: string;
  cue?: string;
}

export interface SetLogEntry {
  done: boolean;
  weight: number | null;
  unit: SetLogUnit;
  reps: number | null;
  rpe?: number | null;
}

export interface ExerciseMetrics {
  volumeKg: number;
  bestE1rmKg: number | null;
}

export interface SessionMetrics {
  totalVolumeKg: number;
  exercises: ExerciseMetrics[];
}

export interface Student {
  id: number;
  name: string;
}

export interface MeResponse {
  studentId: number;
  coach: boolean;
  name: string;
  moves: string[];
  customExercises: CustomExercise[];
  students: Student[];
  archivedStudents?: Student[];
}

export interface DraftSnapshot {
  rev: number;
  items: ExerciseItem[];
}

export interface PublishedPlan {
  id: number;
  rev: number;
  items: ExerciseItem[];
}

export interface SessionFeedback {
  id: string;
  plan: number;
  rpe: number;
  note: string;
  sets: boolean[][];
  setLogs?: SetLogEntry[][] | null;
  metrics?: SessionMetrics | null;
}

export interface DayState {
  draft: DraftSnapshot | null;
  plan: PublishedPlan | null;
  feedback: SessionFeedback | null;
}

export interface CalendarDay {
  day: string;
  names: string[];
  published: boolean;
  revision?: number;
  dirty?: boolean;
  rpe?: number | null;
}

export interface CalendarHistoryItem {
  day: string;
  names: string[];
  rpe: number;
}

export interface CalendarResponse {
  days: CalendarDay[];
  history: CalendarHistoryItem[];
}

export interface TrainingTeam {
  id: string;
  name: string;
  members: number[];
}

export interface TrainingTemplate {
  id: string;
  name: string;
  items: ExerciseItem[];
}

export interface AssessmentRow {
  day: string;
  metric: string;
  unit: string;
  score: number;
  delta?: number | null;
}

export interface TrainingMemoryRow {
  id: string;
  category: string;
  evidence: string;
  note: string;
  status: '待审核' | '已接受' | '已拒绝';
  rev: number;
}

export interface MessageRow {
  id: number;
  sender: 'coach' | 'student';
  body: string;
  created: string;
  seen: number;
}

export interface TrainingCycle {
  id: string;
  student: number;
  goal: string;
  start_day: string;
  weeks: number;
}

export interface CycleWeekReview {
  start: string;
  published: boolean;
  sessions: number;
  reported: number;
  planned: number;
  completed: number;
  rpe: number | null;
  volumeKg?: number | null;
  volumeDeltaPct?: number | null;
  topE1rms?: Array<{ exercise: string; e1rmKg: number }>;
  tests: AssessmentRow[];
}

export interface CycleReportData {
  name: string;
  goal: string;
  start: string;
  weeks: CycleWeekReview[];
  note: string;
}
