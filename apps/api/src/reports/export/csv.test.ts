import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { csvField, neutralise, toCsv } from './csv';
import type { ReportDocument, ReportTable } from './report-table';

const doc = (sections: ReportTable[]): ReportDocument => ({
  title: 'T', tenantName: 'Acme MMC', from: '2026-11-02', to: '2026-11-04', filters: [], generatedAt: new Date('2026-11-04T08:00:00Z'), timezone: 'Asia/Baku', locale: 'az', sections,
});
const text = (b: Buffer) => b.toString('utf8');

describe('CSV writer', () => {
  it('quotes per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('cr\rhere')).toBe('"cr\rhere"');
  });

  it('neutralises formula-looking text', () => {
    for (const s of ['=1+2', '+7', '-3', '@SUM(A1)', '\tx', '\rx']) expect(neutralise(s), JSON.stringify(s)).toBe(`'${s}`);
    expect(neutralise('Qapı = açıq')).toBe('Qapı = açıq');
    expect(neutralise('')).toBe('');
  });

  it('writes a BOM, CRLF rows, one header per section and an empty line between sections', () => {
    const out = toCsv(doc([
      { title: 'A', columns: [{ label: 'Ad', type: 'text' }, { label: 'Say', type: 'int' }], rows: [['Zona, A1', -5], ['=HYPERLINK("x")', null]] },
      { title: 'B', columns: [{ label: 'Tarix', type: 'date' }], rows: [['2026-11-02']] },
    ]));
    expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // Numbers are never neutralised: -5 stays a number.
    expect(text(out).slice(1)).toBe('Ad,Say\r\n"Zona, A1",-5\r\n"\'=HYPERLINK(""x"")",\r\n\r\nTarix\r\n02.11.2026\r\n');
  });

  it('round-trips Azerbaijani text, quotes and line breaks through a CSV parser', () => {
    const cells = ['Şəki, "Mərkəz"', 'ilk sətir\nikinci sətir', 'ğ ı ö ü ç ş ə Ə İ', '@admin'];
    const out = toCsv(doc([{ title: 'A', columns: cells.map((_, i) => ({ label: `S${i}`, type: 'text' as const })), rows: [cells] }]));
    expect(parse(text(out), { bom: true })).toEqual([
      ['S0', 'S1', 'S2', 'S3'],
      ['Şəki, "Mərkəz"', 'ilk sətir\nikinci sətir', 'ğ ı ö ü ç ş ə Ə İ', "'@admin"],
    ]);
  });

  it('writes times on the tenant’s wall clock and booleans in Azerbaijani', () => {
    const out = toCsv(doc([{ title: 'A', columns: [{ label: 'Vaxt', type: 'datetime' }, { label: 'Gecikib', type: 'bool' }, { label: 'Bal', type: 'decimal' }], rows: [['2026-11-02T07:00:00.000Z', true, 90], [null, false, null]] }]));
    expect(text(out).slice(1)).toBe('Vaxt,Gecikib,Bal\r\n02.11.2026 11:00,Bəli,90.0\r\n,Xeyr,\r\n');
  });

  it('writes only the header of an empty table', () => {
    expect(text(toCsv(doc([{ title: 'A', columns: [{ label: 'Ad', type: 'text' }], rows: [] }]))).slice(1)).toBe('Ad\r\n');
  });
});
