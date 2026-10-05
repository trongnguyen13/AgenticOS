import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { memoryReferences, buildMemoryGraph } from '../memory-graph.mjs';

test('extracts wiki aliases, headings, and local Markdown links, excluding code and external links',()=>{
  assert.deepEqual(memoryReferences('[[other#Section|Alias]] [[other]] [Note](some%20note.md#heading) [Web](https://a.test/file.md) `[[example]]`\n```\n[[code]]\n```'),['other','some note.md']);
});
test('resolves project-scoped filenames, relative paths and local titles without invented connections',()=>{
  const base=path.resolve('fixtures');
  const notes=[
    {id:'a',title:'First',projectId:'one',path:path.join(base,'first.md'),content:'[[second]] [[second|again]] [Third](./third.md) [[missing]] [[First]]'},
    {id:'b',title:'Second title',projectId:'one',path:path.join(base,'second.md'),content:'[[First]]'},
    {id:'c',title:'Third',projectId:'one',path:path.join(base,'third.md'),content:''},
    {id:'d',title:'Second title',projectId:'two',path:path.join(base,'two','second.md'),content:'[[First]]'},
    {id:'e',title:'Local note',projectId:'one',content:'[[Second title]]'}
  ];
  const graph=buildMemoryGraph(notes);
  assert.deepEqual(graph.edges,[{source:'a',target:'b'},{source:'a',target:'c'},{source:'b',target:'a'},{source:'e',target:'b'}]);
  assert.deepEqual(graph.unresolved,[{source:'a',target:'missing',reason:'missing'},{source:'d',target:'First',reason:'missing'}]);
  assert.equal(graph.nodes.length,5);
  assert.equal('content' in graph.nodes[0],false);
});
test('reports ambiguous titles instead of choosing a target arbitrarily',()=>{
  const graph=buildMemoryGraph([{id:'a',title:'Start',content:'[[same]]'},{id:'b',title:'Same'},{id:'c',title:'Same'}]);
  assert.equal(graph.edges.length,0);assert.equal(graph.unresolved[0].reason,'ambiguous');
});
