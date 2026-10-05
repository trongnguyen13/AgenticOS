import path from 'node:path';
const normalize = value => value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase();
export function memoryReferences(content) {
  const text = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, '');
  const targets = [...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(m => m[1].split('|')[0].split('#')[0]);
  for (const m of text.matchAll(/(?<!!)\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g)) {
    let target = m[1].replace(/^<|>$/g, '').split('#')[0];
    try { target = decodeURIComponent(target); } catch { continue; }
    if (/\.md$/i.test(target) && !/^[a-z]+:\/\//i.test(target)) targets.push(target);
  }
  return [...new Set(targets.map(t => t.trim()).filter(Boolean))];
}
export function buildMemoryGraph(notes) {
  const aliases = new Map();
  const add = (key, note) => { if (!aliases.has(key)) aliases.set(key, []); aliases.get(key).push(note.id); };
  for (const note of notes) {
    const names = new Set([normalize(note.title), ...(note.path ? [normalize(path.basename(note.path)), normalize(note.path)] : [])]);
    for (const name of names) add(`${note.projectId || ''}:${name}`, note);
  }
  const edges = [], unresolved = [], seen = new Set();
  for (const note of notes) for (const reference of memoryReferences(note.content || '')) {
    const target = normalize(reference).replace(/^\.\//, '');
    const candidates = [...(aliases.get(`${note.projectId || ''}:${target}`) || [])];
    if (!candidates.length && note.path && /[\\/]/.test(reference)) {
      const resolved = normalize(path.resolve(path.dirname(note.path), reference));
      for (const n of notes) if (n.path && normalize(n.path) === resolved && (path.isAbsolute(reference) || n.projectId === note.projectId)) candidates.push(n.id);
    }
    if (candidates.length !== 1) { unresolved.push({ source: note.id, target: reference, reason: candidates.length ? 'ambiguous' : 'missing' }); continue; }
    if (candidates[0] === note.id) continue;
    const key = `${note.id}:${candidates[0]}`;
    if (!seen.has(key)) { edges.push({ source: note.id, target: candidates[0] }); seen.add(key); }
  }
  return { nodes: notes.map(({ id, title, projectId, path: file }) => ({ id, title, projectId, path: file })), edges, unresolved };
}
