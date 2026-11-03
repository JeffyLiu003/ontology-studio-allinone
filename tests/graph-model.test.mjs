import test from 'node:test';
import assert from 'node:assert/strict';
import { graphSlice, neighborhood, directedCurve } from '../public/graph-model.js';
const data = {
 nodes:[{id:'domain',model:'CTX',context:'payment'},{id:'a',model:'M1',context:'payment'},{id:'b',model:'M2',context:'payment'},{id:'c',model:'M1',context:'account'},{id:'isolated',model:'M1',context:'loan'}],
 edges:[{source:'domain',target:'a',label:'包含对象',status:'CODE'},{source:'a',target:'b',label:'提供行为',status:'CODE'},{source:'b',target:'c',label:'调用',status:'MAPPED'},{source:'c',target:'a',label:'引用',status:'MAPPED'}],
};
test('Neighbourhood respects one/two hops and edge direction, including cycles',()=>{
 assert.deepEqual([...neighborhood('a',data.edges,1,'out')],['a','b']);
 assert.deepEqual([...neighborhood('a',data.edges,2,'out')],['a','b','c']);
 assert.deepEqual(new Set(neighborhood('a',data.edges,1,'in')),new Set(['a','domain','c']));
 assert.equal(neighborhood('a',data.edges,30).size,4);
 assert.deepEqual([...neighborhood('isolated',data.edges,2)],['isolated']);
 const outgoing=graphSlice(data,{focus:'a',hops:1,direction:'out'});
 assert.deepEqual(outgoing.edges.map(e=>[e.source,e.target]),[['a','b']]);
 const incoming=graphSlice(data,{focus:'a',hops:1,direction:'in'});
 assert.ok(incoming.edges.every(e=>e.target==='a'));
});
test('Relation and evidence filters preserve actual directed edges without inventing paths',()=>{
 const filtered=graphSlice(data,{focus:'a',hops:2,direction:'out',evidence:'mapped'});
 assert.deepEqual(filtered.nodes.map(n=>n.id),['a']);
 assert.equal(filtered.edges.length,0);
 const mapped=graphSlice(data,{evidence:'mapped'});assert.equal(mapped.edges.length,2);assert.ok(mapped.edges.every(e=>data.edges.includes(e)));
 const relation=graphSlice(data,{relation:'提供行为'});assert.equal(relation.edges.length,1);assert.equal(relation.edges[0].target,'b');
 assert.equal(graphSlice(data,{relation:'missing'}).edges.length,0);
});
test('Context, model, object and domain views keep endpoints consistent and do not mutate input',()=>{
 const before=JSON.stringify(data);
 for(const options of [{context:'payment'},{mode:'objects'},{mode:'domains'},{type:'M2'},{focus:'b',hops:2}]){
  const view=graphSlice(data,options),ids=new Set(view.nodes.map(n=>n.id));assert.ok(view.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
 }
 assert.ok(!graphSlice(data,{context:'payment'}).nodes.some(n=>n.id==='isolated'));
 assert.deepEqual(graphSlice(data,{mode:'domains'}).nodes.map(n=>n.id),['domain']);
 assert.equal(JSON.stringify(data),before);
});
test('Directed curves terminate before target nodes and handle coincident positions',()=>{
 assert.equal(directedCurve({x:0,y:0},{x:100,y:0},10,20,15),'M10,0 Q45,15 80,0');
 assert.match(directedCurve({x:0,y:0},{x:0,y:0}),/ C/);
 assert.ok(!directedCurve({x:0,y:0},{x:0,y:100},10,10,20).includes('NaN'));
});
