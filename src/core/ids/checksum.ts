/** ISBN-10 のチェックディジット検証（入力はハイフン除去済み） */
export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/i.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i].toUpperCase();
    sum += (c === 'X' ? 10 : Number(c)) * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(s: string): boolean {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function isbn10to13(s: string): string {
  const body = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + ((10 - (sum % 10)) % 10);
}

export function isValidIssn(s: string): boolean {
  const d = s.replace('-', '').toUpperCase();
  if (!/^\d{7}[\dX]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += (d[i] === 'X' ? 10 : Number(d[i])) * (8 - i);
  return sum % 11 === 0;
}
