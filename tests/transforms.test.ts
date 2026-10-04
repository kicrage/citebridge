import { describe, expect, it } from 'vitest';
import { formatDate, parseDate } from '../src/core/transforms/dates';
import { nameToString, parseName, stripRole } from '../src/core/transforms/names';
import { isPageRange, normalizePages, parseVolumeIssue, splitSubtitle } from '../src/core/transforms/numbers';
import { inferPageKind } from '../src/core/model/passage';

describe('日付・和暦', () => {
  it.each([
    ['1990', { y: 1990 }],
    ['1990-03', { y: 1990, m: 3 }],
    ['1990-03-12', { y: 1990, m: 3, d: 12 }],
    ['1990.4', { y: 1990, m: 4 }],
    ['1990年3月12日', { y: 1990, m: 3, d: 12 }],
    ['１９９０年３月', { y: 1990, m: 3 }],
    ['昭和12年5月', { y: 1937, m: 5 }],
    ['昭和元年', { y: 1926 }],
    ['平成31年4月30日', { y: 2019, m: 4, d: 30 }],
    ['令和2', { y: 2020 }],
    ['S12.5', { y: 1937, m: 5 }],
    ['明治39', { y: 1906 }],
    ['[1937]', { y: 1937 }],
    ['c1990', { y: 1990 }],
    ['199003', { y: 1990, m: 3 }],
  ])('%s', (input, want) => {
    const d = parseDate(input)!;
    expect({ y: d.y, m: d.m, d: d.d }).toEqual({ m: undefined, d: undefined, ...want });
    expect(d.raw).toBe(input);
  });

  it('解釈できないものは raw だけ', () => {
    expect(parseDate('不明')).toEqual({ raw: '不明' });
    expect(parseDate('1990-13')).toEqual({ raw: '1990-13' });
    expect(parseDate('')).toBeUndefined();
  });

  it('整形', () => {
    expect(formatDate(parseDate('昭和12年5月3日'))).toBe('1937-05-03');
    expect(formatDate(parseDate('1937-05'), 'ja')).toBe('1937年5月');
    expect(formatDate(parseDate('不明'))).toBe('不明');
  });
});

describe('人名', () => {
  it.each([
    ['山田, 太郎, 1950-', { family: '山田', given: '太郎' }],
    ['山田 太郎', { family: '山田', given: '太郎' }],
    ['山田　太郎', { family: '山田', given: '太郎' }],
    ['夏目漱石', { literal: '夏目漱石' }],
    ['Yamada, Taro', { family: 'Yamada', given: 'Taro' }],
    ['Taro Yamada', { family: 'Yamada', given: 'Taro' }],
    ['夏目, 漱石 (1867-1916)', { family: '夏目', given: '漱石' }],
  ])('%s', (input, want) => {
    expect(parseName(input).name).toEqual(want);
  });

  it('役割語', () => {
    expect(stripRole('夏目漱石 作')).toEqual({ text: '夏目漱石', role: 'author' });
    expect(stripRole('山田太郎 編')).toEqual({ text: '山田太郎', role: 'editor' });
    expect(stripRole('鈴木一郎 訳')).toEqual({ text: '鈴木一郎', role: 'translator' });
    expect(parseName('山田 太郎 編').role).toBe('editor');
  });

  it('表示', () => {
    expect(nameToString({ family: '山田', given: '太郎' })).toBe('山田 太郎');
    expect(nameToString({ family: 'Yamada', given: 'Taro' })).toBe('Taro Yamada');
    expect(nameToString({ literal: '日本学術会議' })).toBe('日本学術会議');
  });
});

describe('巻号・ページ', () => {
  it.each([
    ['12(3)', { volume: '12', issue: '3' }],
    ['第12巻第3号', { volume: '12', issue: '3' }],
    ['１２巻３号', { volume: '12', issue: '3' }],
    ['Vol.12, No.3', { volume: '12', issue: '3' }],
    ['第54号', { issue: '54' }],
    ['上', { volume: '上' }],
  ])('%s', (input, want) => {
    expect(parseVolumeIssue(input)).toEqual(want);
  });

  it('ページの正規化', () => {
    expect(normalizePages('pp. 11–27')).toBe('11-27');
    expect(normalizePages('１１～２７頁')).toBe('11-27');
    expect(normalizePages('11-27', 'endash')).toBe('11–27');
    expect(isPageRange('11-27')).toBe(true);
    expect(isPageRange('12')).toBe(false);
  });

  it('一節のページ種別', () => {
    expect(inferPageKind('12')).toBe('p');
    expect(inferPageKind('xii')).toBe('p');
    expect(inferPageKind('12-15')).toBe('pp');
    expect(inferPageKind('第3章')).toBe('loc');
  });

  it('副題', () => {
    expect(splitSubtitle('笑いのユートピア : 『吾輩は猫である』の世界')).toEqual({ title: '笑いのユートピア', subtitle: '『吾輩は猫である』の世界' });
    expect(splitSubtitle('題名だけ')).toEqual({ title: '題名だけ' });
  });
});
