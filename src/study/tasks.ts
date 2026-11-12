import AsyncStorage from '@react-native-async-storage/async-storage';
import { OcrLanguageCode } from '../types';
import { STUDY_TASKS, StudyTaskKey, taskSentence } from '../llmPrompts';

const STORAGE_KEY = '@studylens/tasks_v1';

export interface StudyTask {
  id: string;
  /** Empty for an original task: the name follows the app language. */
  title: string;
  /** Empty for an original task: the text follows the answer language. */
  instruction: string;
}

const BUILTIN = new Set<string>(STUDY_TASKS.map((task) => task.key));

export function isBuiltinTask(id: string): id is StudyTaskKey {
  return BUILTIN.has(id);
}

export function defaultStudyTasks(): StudyTask[] {
  return STUDY_TASKS.map((task) => ({
    id: task.key,
    title: '',
    instruction: ''
  }));
}

export function taskDisplayTitle(
  task: StudyTask,
  builtinLabel: (key: StudyTaskKey) => string
): string {
  const title = task.title.trim();
  if (title) return title;
  if (isBuiltinTask(task.id)) return builtinLabel(task.id);
  return task.id;
}

export function taskInstruction(task: StudyTask, lang: OcrLanguageCode): string {
  const written = task.instruction.trim();
  if (written) return written;
  if (isBuiltinTask(task.id)) return taskSentence(lang, task.id);
  return '';
}

function normalize(value: unknown): StudyTask[] | null {
  if (!Array.isArray(value)) return null;
  const tasks: StudyTask[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as { id?: unknown; title?: unknown; instruction?: unknown };
    if (typeof raw.id !== 'string' || !raw.id.trim()) continue;
    tasks.push({
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      instruction: typeof raw.instruction === 'string' ? raw.instruction : ''
    });
  }
  return tasks;
}

export async function loadStudyTasks(): Promise<StudyTask[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStudyTasks();
    return normalize(JSON.parse(raw)) ?? defaultStudyTasks();
  } catch {
    return defaultStudyTasks();
  }
}

export async function saveStudyTasks(tasks: StudyTask[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export function restoreMissingTasks(tasks: StudyTask[]): StudyTask[] {
  const ids = new Set(tasks.map((task) => task.id));
  const missing = defaultStudyTasks().filter((task) => !ids.has(task.id));
  return missing.length === 0 ? tasks : [...tasks, ...missing];
}
