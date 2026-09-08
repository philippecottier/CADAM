// CSG construction-tree decomposition for a named part.
// Parts authored by the parametric agent are usually subtractive solids:
//   module corps() { color(...) difference() { <positive>; <tool>; <tool>; ... } }
// This rebuilds an OpenSCAD source that renders the positive base shape and each
// subtracted tool as SEPARATE top-level objects (lazy-union keeps top-level union
// children apart), so the viewer can show the construction tree.

export type CsgDecomposition = {
  scad: string;
  toolCount: number;
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
  const lines = source.split('\n');
  let depth = 0;
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (
      depth === 0 &&
      t &&
      !t.startsWith('//') &&
      !t.startsWith('/*') &&
      !t.startsWith('*')
    ) {
      const isDef = /^(module|function)\s+[A-Za-z_]/.test(t);
      const isAssign = /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t);
      const isAssembly =
        /^(let|if)\s*\(/.test(t) ||
        /^(translate|rotate|scale|mirror|color|union|difference|intersection|hull|minkowski)\s*\(/.test(
          t,
        ) ||
        /^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)\s*;?$/.test(t);
      if (!isDef && !isAssign && isAssembly) {
        cut = i;
        break;
      }
    }
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  return lines.slice(0, cut).join('\n');
}

function ensureTerminated(stmt: string): string {
  const t = stmt.trim();
  return t.endsWith(';') || t.endsWith('}') ? t : t + ';';
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
  return { scad, toolCount: children.length - 1 };
}
