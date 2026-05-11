import { readFileSync, writeFileSync } from 'fs';

const LSQ = '‘'; // left single quotation mark '
const RSQ = '’'; // right single quotation mark '
const file = new URL('../src/data.ts', import.meta.url).pathname;
const content = readFileSync(file, 'utf-8');
const lines = content.split('\n');
let count = 0;

const fixed = lines.map(line => {
  if (!line.includes(LSQ) && !line.includes(RSQ)) return line;
  const result = [];
  let inDq = false, inSq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (!inDq && !inSq) {
      if (c === '"') { inDq = true; result.push(c); }
      else if (c === "'") { inSq = true; result.push(c); }
      else if (c === LSQ || c === RSQ) { result.push("'"); count++; }
      else result.push(c);
    } else if (inDq) {
      if (c === '"' && prev !== '\\') inDq = false;
      result.push(c);
    } else {
      if (c === "'" && prev !== '\\') inSq = false;
      result.push(c);
    }
  }
  return result.join('');
});

writeFileSync(file, fixed.join('\n'), 'utf-8');
console.log(`Replaced ${count} curly-quote delimiters`);
