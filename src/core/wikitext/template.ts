/** ウィキテキスト中のテンプレート呼び出しを、元の書式を保ったまま位置付きで解析する */

export interface ParsedParam {
  /** 名前付き引数の名前（位置引数は '1', '2', …） */
  name: string;
  value: string;
  named: boolean;
  /** `|` の次から次の `|` または `}}` の手前まで（元テキスト上の位置） */
  start: number;
  end: number;
}

export interface ParsedTemplate {
  name: string;
  start: number;
  /** `}}` の直後 */
  end: number;
  text: string;
  params: ParsedParam[];
}

/** コメントと nowiki の範囲（解析時に飛ばす） */
function opaqueEnd(text: string, i: number): number {
  if (text.startsWith('<!--', i)) {
    const e = text.indexOf('-->', i + 4);
    return e < 0 ? text.length : e + 3;
  }
  if (/^<nowiki\b/i.test(text.slice(i, i + 8))) {
    const e = text.toLowerCase().indexOf('</nowiki>', i);
    return e < 0 ? text.length : e + 9;
  }
  return -1;
}

/** text[start] から始まる `{{…}}` を解析する。閉じていなければ undefined */
export function parseTemplateAt(text: string, start: number): ParsedTemplate | undefined {
  if (!text.startsWith('{{', start)) return undefined;
  let depthT = 0; // 入れ子の {{ }}
  let depthL = 0; // [[ ]]
  const cuts: number[] = []; // トップレベルの | の位置
  let i = start + 2;
  for (; i < text.length; i++) {
    const oe = opaqueEnd(text, i);
    if (oe >= 0) {
      i = oe - 1;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '{{') {
      depthT++;
      i++;
    } else if (two === '}}') {
      if (depthT === 0) break;
      depthT--;
      i++;
    } else if (two === '[[') {
      depthL++;
      i++;
    } else if (two === ']]' && depthL > 0) {
      depthL--;
      i++;
    } else if (text[i] === '|' && depthT === 0 && depthL === 0) cuts.push(i);
  }
  if (i >= text.length) return undefined;
  const end = i + 2;
  const nameEnd = cuts[0] ?? i;
  const name = text.slice(start + 2, nameEnd).replace(/<!--[\s\S]*?-->/g, '').trim();
  const params: ParsedParam[] = [];
  let pos = 0;
  cuts.forEach((c, k) => {
    const pStart = c + 1;
    const pEnd = cuts[k + 1] ?? i;
    const seg = text.slice(pStart, pEnd);
    const eq = topLevelEquals(seg);
    if (eq >= 0) {
      params.push({ name: seg.slice(0, eq).trim(), value: seg.slice(eq + 1).trim(), named: true, start: pStart, end: pEnd });
    } else {
      pos++;
      params.push({ name: String(pos), value: seg.trim(), named: false, start: pStart, end: pEnd });
    }
  });
  return { name, start, end, text: text.slice(start, end), params };
}

function topLevelEquals(seg: string): number {
  let d = 0;
  for (let i = 0; i < seg.length; i++) {
    const two = seg.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      d++;
      i++;
    } else if ((two === '}}' || two === ']]') && d > 0) {
      d--;
      i++;
    } else if (seg[i] === '=' && d === 0) return i;
  }
  return -1;
}

/** テキスト中のトップレベルのテンプレートをすべて返す（filter で名前を絞れる） */
export function findTemplates(text: string, filter?: (name: string) => boolean, from = 0, to = text.length): ParsedTemplate[] {
  const out: ParsedTemplate[] = [];
  for (let i = from; i < to; i++) {
    const oe = opaqueEnd(text, i);
    if (oe >= 0) {
      i = oe - 1;
      continue;
    }
    if (text.startsWith('{{', i)) {
      const t = parseTemplateAt(text, i);
      if (!t) break;
      if (!filter || filter(t.name)) out.push(t);
      i = t.end - 1;
    }
  }
  return out;
}

/** 引数名の比較用キー（access-date ≡ accessdate、last ≡ last1 など） */
export function paramKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_\s]/g, '')
    .replace(/^(last|first|author|editor|translator|authorlink)1(?=$|last|first)/, '$1')
    .replace(/^(surname)1?$/, 'last')
    .replace(/^(given)1?$/, 'first')
    .replace(/^author(\d*)last$/, 'last$1')
    .replace(/^author(\d*)first$/, 'first$1')
    // author= と last= はどちらも第1著者を表す
    .replace(/^author(\d*)$/, 'last$1');
}
