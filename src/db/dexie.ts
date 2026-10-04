import Dexie, { type Table } from 'dexie';
import type { Clip, Passage } from '@/core/model/passage';
import type { CiteRecord } from '@/core/model/record';

export interface StoredRecord {
  key: string;
  /** ソースから組み立てた値 */
  record: CiteRecord;
  /** 利用者の修正（ソースの再取得で消えないよう別に持つ） */
  overrides?: Partial<CiteRecord>;
  errors?: { source: string; message: string }[];
  updatedAt: string;
}

/** 取得した生レスポンス（同じ URL への再要求を避ける） */
export interface RawEntry {
  url: string;
  body: string;
  fetchedAt: number;
  expiresAt: number;
}

export class CitebridgeDB extends Dexie {
  records!: Table<StoredRecord, string>;
  raw!: Table<RawEntry, string>;
  passages!: Table<Passage, string>;
  clips!: Table<Clip, string>;

  constructor() {
    super('citebridge');
    this.version(1).stores({
      records: 'key, updatedAt',
      raw: 'url, expiresAt',
      passages: 'id, recordKey, capturedAt',
      clips: 'recordKey, addedAt, *tags',
    });
  }
}

export const db = new CitebridgeDB();

export async function saveRecord(record: CiteRecord, errors?: StoredRecord['errors']): Promise<void> {
  const prev = await db.records.get(record.key);
  await db.records.put({ key: record.key, record, overrides: prev?.overrides, errors, updatedAt: new Date().toISOString() });
}

/** 出典クリップボードに入れる（既にあれば何もしない） */
export async function addClip(recordKey: string, memo?: string): Promise<void> {
  if (await db.clips.get(recordKey)) return;
  await db.clips.put({ recordKey, tags: [], memo, addedAt: new Date().toISOString() });
}

export async function removeClip(recordKey: string): Promise<void> {
  await db.transaction('rw', db.clips, db.passages, async () => {
    await db.clips.delete(recordKey);
    await db.passages.where('recordKey').equals(recordKey).delete();
  });
}

/** 書き出し（バックアップ・別ブラウザへの移行用）。生レスポンスは含めない */
export async function exportData() {
  return {
    format: 'citebridge-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: await db.records.toArray(),
    clips: await db.clips.toArray(),
    passages: await db.passages.toArray(),
  };
}

export async function importData(data: Awaited<ReturnType<typeof exportData>>): Promise<number> {
  if (data?.format !== 'citebridge-export') throw new Error('Citebridge の書き出しファイルではありません');
  await db.transaction('rw', db.records, db.clips, db.passages, async () => {
    await db.records.bulkPut(data.records);
    await db.clips.bulkPut(data.clips);
    await db.passages.bulkPut(data.passages);
  });
  return data.records.length;
}

export async function purgeExpiredRaw(now = Date.now()): Promise<number> {
  return db.raw.where('expiresAt').below(now).delete();
}
