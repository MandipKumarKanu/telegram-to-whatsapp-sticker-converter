import * as FileSystem from 'expo-file-system/legacy';

export interface StoredPackRecord {
  packName: string;
  title: string;
  customPackName?: string;
  totalCount: number;
  supportedCount: number;
  packChunks: number;
  lastSelectedCount?: number;
  exportedChunkIndexes?: number[];
  coverUrl?: string; // Add cover image URL
  updatedAt: string;
}

const LIBRARY_FILE_NAME = 'sticker_pack_library.json';

const getLibraryPath = (): string => {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) {
    throw new Error('Could not resolve app storage directory for pack library.');
  }

  return `${base}${LIBRARY_FILE_NAME}`;
};

const normalizeRecords = (records: StoredPackRecord[]): StoredPackRecord[] => {
  return [...records]
    .filter(record => Boolean(record.packName))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

async function readRawLibrary(): Promise<StoredPackRecord[]> {
  const path = getLibraryPath();
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    return [];
  }

  const content = await FileSystem.readAsStringAsync(path);
  if (!content.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as StoredPackRecord[];
  } catch {
    return [];
  }
}

async function writeRawLibrary(records: StoredPackRecord[]): Promise<void> {
  const path = getLibraryPath();
  const normalized = normalizeRecords(records);
  await FileSystem.writeAsStringAsync(path, JSON.stringify(normalized, null, 2));
}

export async function listStoredPacks(): Promise<StoredPackRecord[]> {
  const records = await readRawLibrary();
  return normalizeRecords(records);
}

export async function upsertStoredPack(
  input: Omit<StoredPackRecord, 'updatedAt'> & { updatedAt?: string }
): Promise<StoredPackRecord[]> {
  const records = await readRawLibrary();
  const next: StoredPackRecord = {
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

  const index = records.findIndex(record => record.packName === next.packName);
  if (index >= 0) {
    records[index] = { ...records[index], ...next };
  } else {
    records.push(next);
  }

  await writeRawLibrary(records);
  return normalizeRecords(records);
}

export async function getStoredPack(packName: string): Promise<StoredPackRecord | null> {
  const records = await readRawLibrary();
  const found = records.find(record => record.packName === packName);
  return found ?? null;
}
