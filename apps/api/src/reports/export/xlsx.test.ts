import readXlsxFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import type { ReportDocument, ReportTable } from './report-table';
import { sheetName, toXlsx } from './xlsx';

const doc = (sections: ReportTable[], locale: ReportDocument['locale'] = 'az'): ReportDocument => ({
  title: 'T', tenantName: 'Acme MMC', from: '2026-11-02', to: '2026-11-04', filters: [], generatedAt: new Date('2026-11-04T08:00:00Z'), timezone: 'Asia/Baku', locale, sections,
});

describe('XLSX writer', () => {
  it('writes one sheet per section with typed number, date and time cells', async () => {
    const out = await toXlsx(doc([
      {
        title: 'Obyektlər',
        columns: [
          { label: 'Obyekt', type: 'text' }, { label: 'Planlaşdırılıb', type: 'int' }, { label: 'Tamamlanma faizi', type: 'decimal' },
          { label: 'Tarix', type: 'date' }, { label: 'Son vaxt', type: 'datetime' }, { label: 'Aktiv', type: 'bool' },
        ],
        rows: [
          ['Zona A1', 7, 57.1, '2026-11-02', '2026-11-02T07:00:00.000Z', true],
          ['Zona A2', 5, null, null, null, false],
        ],
      },
      { title: 'Gündəlik', columns: [{ label: 'Tarix', type: 'date' }], rows: [] },
    ]));
    const sheets = await readXlsxFile(out);
    expect(sheets.map((s) => s.sheet)).toEqual(['Obyektlər', 'Gündəlik']);
    const [header, a1, a2] = sheets[0]!.data;
    expect(header).toEqual(['Obyekt', 'Planlaşdırılıb', 'Tamamlanma faizi', 'Tarix', 'Son vaxt', 'Aktiv']);
    expect([a1![0], a1![1], a1![2], a1![3], a1![5]]).toEqual(['Zona A1', 7, 57.1, new Date('2026-11-02T00:00:00.000Z'), 'Bəli']);
    // 07:00Z is 11:00 in Baku: the cell holds the tenant's wall clock. Excel stores a fraction of a day, so allow a millisecond.
    expect(a1![4]).toBeInstanceOf(Date);
    expect(Math.abs(+(a1![4] as unknown as Date) - +new Date('2026-11-02T11:00:00.000Z'))).toBeLessThan(1000);
    expect(a2).toEqual(['Zona A2', 5, null, null, null, 'Xeyr']);
    expect(sheets[1]!.data).toEqual([['Tarix']]);
  });

  it('writes booleans in the export language', async () => {
    const section: ReportTable = { title: 'A', columns: [{ label: 'Active', type: 'bool' }], rows: [[true], [false]] };
    expect((await readXlsxFile(await toXlsx(doc([section], 'en'))))[0]!.data.slice(1)).toEqual([['Yes'], ['No']]);
    expect((await readXlsxFile(await toXlsx(doc([section], 'ru'))))[0]!.data.slice(1)).toEqual([['Да'], ['Нет']]);
  });

  it('keeps sheet names valid (31 characters, no []:*?/\\) and unique', () => {
    const used = new Set<string>();
    expect(sheetName('İcralar [a/b]: *?', used)).toBe('İcralar  a b');
    expect(sheetName('X'.repeat(40), used)).toBe('X'.repeat(31));
    expect(sheetName('X'.repeat(40), used)).toBe(`${'X'.repeat(28)} 2`);
    expect(sheetName('Problemlər', used)).toBe('Problemlər');
    expect(sheetName('Problemlər', used)).toBe('Problemlər 2');
  });
});
