import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { debugError } from '../debug/debugLog';

const STORAGE_KEY = '@studylens/fiches_v1';
const STUDY_DIR = 'studylens';
const STUDY_FILE = 'fiches.json';
const STUDY_TMP = 'fiches.json.tmp';

export const FICHE_LINE_LIMIT = 10;

export interface Fiche {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

function clipText(text: string): string {
  return text.replace(/\r\n/g, '\n').split('\n').slice(0, FICHE_LINE_LIMIT).join('\n');
}

export function ficheLineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

export function ficheTitle(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find((part) => part.length > 0);
  return line || 'Fiche vide';
}

export function fichePreview(text: string): string {
  const lines = text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return lines.slice(1).join(' ');
}

function shuffle<T>(list: T[]): T[] {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  return next;
}

export function drawFiches(fiches: Fiche[]): Fiche[] {
  return shuffle(fiches);
}

function isFiche(value: unknown): value is Fiche {
  if (!value || typeof value !== 'object') return false;
  const fiche = value as Fiche;
  return typeof fiche.id === 'string' && typeof fiche.text === 'string';
}

function normalize(parsed: unknown): Fiche[] | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as { fiches?: unknown };
  if (!Array.isArray(value.fiches)) return null;
  return value.fiches.filter(isFiche).map((fiche) => ({
    id: fiche.id,
    text: clipText(fiche.text),
    createdAt: typeof fiche.createdAt === 'number' ? fiche.createdAt : Date.now(),
    updatedAt: typeof fiche.updatedAt === 'number' ? fiche.updatedAt : Date.now()
  }));
}

function snapshot(fiches: Fiche[]): string {
  return JSON.stringify({ schema: 1, fiches });
}

function studyDir(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}${STUDY_DIR}/`;
}

async function readJsonFile(path: string): Promise<Fiche[] | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return normalize(JSON.parse(await FileSystem.readAsStringAsync(path)));
  } catch {
    return null;
  }
}

async function readDurableFile(): Promise<Fiche[] | null> {
  const dir = studyDir();
  if (!dir) return null;
  const main = await readJsonFile(`${dir}${STUDY_FILE}`);
  if (main) return main;
  return readJsonFile(`${dir}${STUDY_TMP}`);
}

async function writeDurableFile(payload: string): Promise<void> {
  const root = studyDir();
  if (!root) return;
  const info = await FileSystem.getInfoAsync(root);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  }
  const tmp = `${root}${STUDY_TMP}`;
  const dest = `${root}${STUDY_FILE}`;
  await FileSystem.writeAsStringAsync(tmp, payload);
  JSON.parse(await FileSystem.readAsStringAsync(tmp));
  await FileSystem.writeAsStringAsync(dest, payload);
  await FileSystem.deleteAsync(tmp, { idempotent: true });
}

async function readAsyncStore(): Promise<Fiche[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function saveFiches(fiches: Fiche[]): Promise<void> {
  const payload = snapshot(fiches);
  try {
    await writeDurableFile(payload);
  } catch (err) {
    void debugError('fiches', err, 'fiche file save failed');
  }
  await AsyncStorage.setItem(STORAGE_KEY, payload);
}

export async function loadFiches(): Promise<Fiche[]> {
  const stored = await readAsyncStore();
  const fromFile = await readDurableFile();
  const chosen =
    (fromFile?.length || 0) >= (stored?.length || 0) ? fromFile : stored;
  const fiches = chosen || [];
  if (snapshot(fromFile || []) !== snapshot(fiches) || snapshot(stored || []) !== snapshot(fiches)) {
    if (fiches.length > 0) await saveFiches(fiches);
  }
  return fiches;
}

function cleanBody(text: string): string {
  return clipText(text).replace(/[ \t]+\n/g, '\n').replace(/^\n+|\n+$/g, '').trim();
}

export async function saveFiche(id: string | null, text: string): Promise<Fiche | null> {
  const body = cleanBody(text);
  if (!body) return null;
  const fiches = await loadFiches();
  const now = Date.now();
  if (id) {
    const index = fiches.findIndex((fiche) => fiche.id === id);
    if (index < 0) return null;
    const next = { ...fiches[index], text: body, updatedAt: now };
    fiches[index] = next;
    await saveFiches(fiches);
    return next;
  }
  const fiche: Fiche = {
    id: `fiche-${now}`,
    text: body,
    createdAt: now,
    updatedAt: now
  };
  fiches.unshift(fiche);
  await saveFiches(fiches);
  return fiche;
}

export async function deleteFiche(id: string): Promise<void> {
  const fiches = await loadFiches();
  await saveFiches(fiches.filter((fiche) => fiche.id !== id));
}
