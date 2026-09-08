// CSG construction-tree decomposition for a named part.
// Parts authored by the parametric agent are usually subtractive solids:
//   module corps() { color(...) difference() { <positive>; <tool>; <tool>; ... } }
// This rebuilds an OpenSCAD source that renders the positive base shape and each
// subtracted tool as SEPARATE top-level objects (lazy-union keeps top-level union
// children apart), so the viewer can show the construction tree.

export type CsgDecomposition = {
  scad: string;
  toolCount: number;
  labels: string[];
};

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moduleBody(source: string, name: string): string | null {
  const re = new RegExp(
    'module\\s+' + escapeName(name) + '\\s*\\([^)]*\\)\\s*\\{',
  );
  const m = re.exec(source);
  if (!m) return null;
  let depth = 0;
  const start = source.indexOf('{', m.index);
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  return null;
}

function firstDifferenceBlock(body: string): string | null {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    const prev = i > 0 ? body[i - 1] : '';
    if (
      depth === 0 &&
      body.startsWith('difference', i) &&
      !/[A-Za-z0-9_]/.test(prev)
    ) {
      let d = 0;
      const s = body.indexOf('{', i);
      for (let j = s; j < body.length; j++) {
        if (body[j] === '{') d++;
        else if (body[j] === '}') {
          d--;
          if (d === 0) return body.slice(s + 1, j);
        }
      }
    }
  }
  return null;
}

function splitStatements(block: string): string[] {
  const out: string[] = [];
  let dp = 0;
  let db = 0;
  let buf = '';
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    buf += ch;
    if (ch === '(') dp++;
    else if (ch === ')') dp--;
    else if (ch === '{') db++;
    else if (ch === '}') {
      db--;
      if (dp === 0 && db === 0) {
        out.push(buf.trim());
        buf = '';
      }
    } else if (ch === ';' && dp === 0 && db === 0) {
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.map((s) => s.trim()).filter((s) => s.length > 0 && s !== ';');
}

function definitionsHead(source: string): string {
  const lines = source.split(String.fromCharCode(10));
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (
      t === '' ||
      t.startsWith('//') ||
      t.startsWith('/*') ||
      t.startsWith('*')
    ) {
      out.push(lines[i]);
      i++;
      continue;
    }
    let p = 0;
    let br = 0;
    let b = 0;
    let hasBrace = false;
    let end = i;
    for (let k = i; k < lines.length; k++) {
      for (const ch of lines[k]) {
        if (ch === '(') p++;
        else if (ch === ')') p--;
        else if (ch === '[') br++;
        else if (ch === ']') br--;
        else if (ch === '{') {
          b++;
          hasBrace = true;
        } else if (ch === '}') b--;
      }
      const endsSemi = /;\s*$/.test(lines[k].trim());
      if (p === 0 && br === 0 && b === 0) {
        if (hasBrace) {
          let nxt = '';
          for (let m = k + 1; m < lines.length; m++) {
            const tt = lines[m].trim();
            if (tt) {
              nxt = tt;
              break;
            }
          }
          if (!/^else\b/.test(nxt)) {
            end = k;
            break;
          }
        } else if (endsSemi) {
          end = k;
          break;
        }
      }
    }
    const isDef = /^(module|function)\s+[A-Za-z_]/.test(t);
    const isAssign = /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t);
    if (isDef || isAssign) {
      for (let x = i; x <= end; x++) out.push(lines[x]);
    }
    i = end + 1;
  }
  return out.join(String.fromCharCode(10));
}

function ensureTerminated(stmt: string): string {
  const t = stmt.trim();
  return t.endsWith(';') || t.endsWith('}') ? t : t + ';';
}

const RESERVED_CALLS = new Set([
  'translate',
  'rotate',
  'scale',
  'mirror',
  'multmatrix',
  'color',
  'resize',
  'hull',
  'minkowski',
  'union',
  'difference',
  'intersection',
  'render',
  'offset',
  'linear_extrude',
  'rotate_extrude',
  'projection',
  'cube',
  'sphere',
  'cylinder',
  'polyhedron',
  'square',
  'circle',
  'polygon',
  'text',
  'import',
  'surface',
  'children',
  'let',
  'for',
  'if',
  'else',
  'echo',
  'assert',
  'each',
]);

function toolLabel(stmt: string, partName: string, index: number): string {
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stmt)) !== null) {
    const id = m[1];
    if (id && !RESERVED_CALLS.has(id)) return id;
  }
  return partName + '_coupe_' + index;
}

export function decomposePartScad(
  source: string,
  partName: string,
): CsgDecomposition | null {
  if (!source || !partName) return null;
  const body = moduleBody(source, partName);
  if (body === null) return null;
  const block = firstDifferenceBlock(body);
  if (block === null) return null;
  const children = splitStatements(block);
  if (children.length < 2) return null;
  const head = definitionsHead(source);
  const emitted = children.map(ensureTerminated).join('\n');
  const scad =
    head +
    '\n\n// ==== CSG decomposition of ' +
    partName +
    ' ====\n' +
    emitted +
    '\n';
  const labels = children.map((c, i) =>
    i === 0 ? partName : toolLabel(c, partName, i),
  );
  return { scad, toolCount: children.length - 1, labels };
}
