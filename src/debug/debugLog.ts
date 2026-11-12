import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

const DIR_NAME = 'studylens';
const FILE_NAME = 'debug.log';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 160 * 1024;
const MAX_LINES = 400;
const MAX_FIELD = 700;

type Level = 'info' | 'warn' | 'error';

interface Entry {
  t: number;
  level: Level;
  scope: string;
  msg: string;
  extra: string;
}

let chain: Promise<void> = Promise.resolve();
let installed = false;

function logFile(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}${DIR_NAME}/${FILE_NAME}`;
}

function scrub(value: string): string {
  return value
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{20,}/g, '[image]')
    .replace(/[A-Za-z0-9+/]{180,}={0,2}/g, '[blob]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD);
}

function field(value: string): string {
  return scrub(value).replace(/\t/g, ' ');
}

function detailOf(extra: unknown): string {
  if (extra == null || extra === '') return '';
  if (extra instanceof Error) {
    const stack = extra.stack ? `\n${extra.stack}` : '';
    return field(`${extra.message}${stack}`);
  }
  if (typeof extra === 'string') return field(extra);
  try {
    return field(JSON.stringify(extra));
  } catch {
    return field(String(extra));
  }
}

function parseLine(line: string): Entry | null {
  const parts = line.split('\t');
  if (parts.length < 4) return null;
  const t = Number(parts[0]);
  const level = parts[1];
  if (!Number.isFinite(t)) return null;
  if (level !== 'info' && level !== 'warn' && level !== 'error') return null;
  return {
    t,
    level,
    scope: parts[2] || 'app',
    msg: parts[3] || '',
    extra: parts.slice(4).join(' ')
  };
}

function encode(entry: Entry): string {
  const parts = [String(entry.t), entry.level, field(entry.scope), field(entry.msg)];
  if (entry.extra) parts.push(entry.extra);
  return parts.join('\t');
}

function prune(entries: Entry[]): Entry[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh = entries.filter((entry) => entry.t >= cutoff).slice(-MAX_LINES);
  while (fresh.length > 1 && fresh.map(encode).join('\n').length > MAX_BYTES) {
    fresh.shift();
  }
  return fresh;
}

async function readEntries(): Promise<Entry[]> {
  const path = logFile();
  if (!path) return [];
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(path);
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(parseLine)
      .filter((entry): entry is Entry => entry !== null);
  } catch {
    return [];
  }
}

async function writeEntries(entries: Entry[]): Promise<void> {
  const path = logFile();
  const root = FileSystem.documentDirectory;
  if (!path || !root) return;
  const dir = `${root}${DIR_NAME}`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const body = entries.length === 0 ? '' : `${entries.map(encode).join('\n')}\n`;
  await FileSystem.writeAsStringAsync(path, body);
}

async function append(entry: Entry): Promise<void> {
  const entries = prune([...(await readEntries()), entry]);
  await writeEntries(entries);
}

export function debugLog(
  level: Level,
  scope: string,
  message: string,
  extra?: unknown
): Promise<void> {
  const entry: Entry = {
    t: Date.now(),
    level,
    scope,
    msg: field(message),
    extra: detailOf(extra)
  };
  const job = chain.then(() => append(entry));
  chain = job.catch(() => undefined);
  return job;
}

export function debugError(scope: string, error: unknown, message?: string): Promise<void> {
  const text =
    message ||
    (error instanceof Error ? error.message : error == null ? 'unknown error' : String(error));
  return debugLog('error', scope, text, error instanceof Error ? error : undefined);
}

function formatEntry(entry: Entry): string {
  const when = new Date(entry.t).toISOString();
  const tail = entry.extra ? `\n${entry.extra}` : '';
  return `${when} ${entry.level.toUpperCase()} ${entry.scope} ${entry.msg}${tail}`;
}

export async function readDebugLog(): Promise<string> {
  const entries = prune(await readEntries());
  if (entries.length === 0) return '';
  await writeEntries(entries);
  return entries.map(formatEntry).join('\n\n');
}

export function installDebugLog(): void {
  if (installed) return;
  installed = true;

  const errorUtils = (
    global as { ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    } }
  ).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    void debugLog(
      'error',
      isFatal ? 'crash' : 'error',
      error instanceof Error ? error.message : String(error),
      error
    );
    previous?.(error, isFatal);
  });

  try {
    const tracking = require('promise/setimmediate/rejection-tracking') as {
      enable: (options: {
        allRejections: boolean;
        onUnhandled: (id: number, error: unknown) => void;
        onHandled: (id: number) => void;
      }) => void;
    };
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id, error) => {
        void debugLog(
          'error',
          'promise',
          error instanceof Error ? error.message : String(error),
          error
        );
      },
      onHandled: () => undefined
    });
  } catch {
    // The runtime already reports some rejections through the global handler.
  }

  const version = Constants.nativeAppVersion || Constants.expoConfig?.version || '';
  const device = Constants.deviceName || '';
  void debugLog(
    'info',
    'boot',
    `${Platform.OS} ${String(Platform.Version)} ${device} ${version}`.trim()
  );
}
