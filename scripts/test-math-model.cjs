"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),test=require("node:test");
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync("public/math-model.js","utf8"),context);
const Model=context.ChenchenMath;
const copy=value=>JSON.parse(JSON.stringify(value));
const rng=(seed=17)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const day="2026-10-05";
function known(mode){
  const id=mode==="decomp"?"math-decomp-10":"math-addsub-10";
  const mathKnowledge=Object.fromEntries(Model.pool(mode).map(q=>[q.knowledgeId,{stage:2,nextReview:"2026-10-20",lastResult:"remember",mistakes:0}]));
  return {items:{[id]:{learned:true,mathKnowledge}},activity:{}};
}
test("every number-bond prompt has exactly one blank and one possible answer",()=>{
  for(const q of Model.pool("decomp")){
    const slots=Object.keys(q.blanks).filter(slot=>q.blanks[slot]);
    assert.equal(slots.length,1,q.key);
    const solutions=Array.from({length:11},(_,i)=>i).filter(answer=>{
      const left=slots[0]==="left"?answer:q.left,right=slots[0]==="right"?answer:q.right,whole=slots[0]==="whole"?answer:q.n;
      return left+right===whole;
    });
    assert.deepEqual(solutions,[q.answer],q.key);
    assert.equal(q.mode==="compose",slots[0]==="whole");
  }
});
test("finite plans cover knowledge points and never repeat a question within one group",()=>{
  for(const mode of ["addsub","decomp"])for(let i=0;i<50;i++){
    const p=Model.plan(mode,{items:{}},day,10,rng());
    assert.equal(p.questions.length,10);
    assert.equal(new Set(p.questions.map(q=>q.key)).size,10);
    assert.ok(new Set(p.questions.map(q=>q.knowledgeId)).size>=8);
    assert.ok(p.questions.every(q=>q.reason==="new"));
    if(mode==="addsub")for(const q of p.questions){assert.equal(q.choices.length,4);assert.ok(q.choices.includes(q.answer));}
  }
});
test("server forgot/remember fixtures prioritize due weak knowledge and exclude future knowledge",()=>{
  const state=known("addsub"),points=state.items["math-addsub-10"].mathKnowledge;
  points["sub-whole-7"]={stage:0,nextReview:day,lastResult:"forgot",mistakes:3};
  points["add-total-8"]={stage:1,nextReview:"2026-10-04",lastResult:"remember",mistakes:0};
  const p=Model.plan("addsub",state,day,10,rng());
  assert.equal(p.questions[0].knowledgeId,"sub-whole-7");
  assert.ok(p.questions.some(q=>q.knowledgeId==="add-total-8"));
  assert.ok(p.questions.every(q=>["sub-whole-7","add-total-8"].includes(q.knowledgeId)));
  assert.ok(p.questions.filter(q=>q.knowledgeId==="sub-whole-7").length>1);
});
test("one due zero fact creates a one-question group without borrowing future facts",()=>{
  const state=known("addsub");
  assert.equal(Model.plan("addsub",state,day).questions.length,10);
  state.items["math-addsub-10"].mathKnowledge["add-total-0"].nextReview=day;
  const p=Model.plan("addsub",state,day);
  assert.equal(p.questions.length,1);assert.equal(p.questions[0].key,"0+0");
  assert.ok(Model.restore(p,"addsub"));
});

test("all-learned mathematics still creates restorable repeat rounds in both modes",()=>{
  for(const mode of ["addsub","decomp"]) {
    const state=known(mode),id=mode==="decomp"?"math-decomp-10":"math-addsub-10";
    for(const point of Object.values(state.items[id].mathKnowledge)) point.reviewDay=day;
    const before=JSON.stringify(state),first=Model.plan(mode,state,day,10,rng());
    assert.equal(first.questions.length,10);
    assert.equal(new Set(first.questions.map(q=>q.key)).size,10);
    assert.ok(Model.restore(first,mode));
    state.activity.last={id,at:day+'T10:00:00Z',details:{questionKeys:first.questions.map(q=>q.key)}};
    const next=Model.plan(mode,state,day,10,rng());
    assert.ok(next.questions.some(q=>!state.activity.last.details.questionKeys.includes(q.key)));
    delete state.activity.last;
    assert.equal(JSON.stringify(state),before);
  }
});
test("recent question surfaces are deferred when another substantial variant is available",()=>{
  const state=known("addsub"),points=state.items["math-addsub-10"].mathKnowledge;
  points["add-total-10"].nextReview=day;
  const first=Model.plan("addsub",state,day,10,rng());
  state.activity.previous={id:"math-addsub-10",at:"2026-10-04T10:00:00Z",details:{questionKeys:first.questions.slice(0,3).map(q=>q.key)}};
  const next=Model.plan("addsub",state,day,10,rng());
  assert.ok(!state.activity.previous.details.questionKeys.includes(next.questions[0].key));
});

const zero=q=>q.meta ? q.meta.op==='+' ? q.meta.a===0 || q.meta.b===0 : q.meta.b===0 : q.left===0 || q.right===0;
test("fresh and repeat rounds balance operations and favor substantial nonzero facts across random seeds",()=>{
  for(const mode of ['addsub','decomp'])for(const state of [{items:{}},known(mode)])for(let seed=1;seed<=100;seed++){
    const before=JSON.stringify(state),p=Model.plan(mode,state,day,10,rng(seed));
    assert.equal(p.questions.length,10);
    assert.equal(p.questions.filter(zero).length,0);
    assert.ok(Model.restore(p,mode));
    if(mode==='addsub'){
      assert.equal(p.questions.filter(q=>q.meta.op==='+').length,5);
      assert.equal(p.questions.filter(q=>q.meta.op==='-').length,5);
      assert.ok(p.questions.every(q=>q.meta.a>=2 && q.meta.b>=2 && (q.meta.op==='+' || q.meta.a!==q.meta.b)));
      assert.ok(p.questions.every(q=>q.meta.op==='+' ? q.answer>=6 : q.meta.a>=6));
    } else {
      assert.equal(p.questions.filter(q=>q.mode==='compose').length,5);
      assert.ok(p.questions.every(q=>q.left>=2 && q.right>=2 && q.n>=6));
    }
    assert.equal(JSON.stringify(state),before);
  }
});
test("every group caps zero facts even when elementary or weak knowledge is due",()=>{
  for(const mode of ['addsub','decomp'])for(let seed=1;seed<=100;seed++){
    const state=known(mode),id=mode==='addsub'?'math-addsub-10':'math-decomp-10';
    for(const point of Object.values(state.items[id].mathKnowledge))Object.assign(point,{nextReview:day,lastResult:'forgot'});
    const p=Model.plan(mode,state,day,10,rng(seed));
    assert.ok(p.questions.filter(zero).length<=1);
    assert.equal(new Set(p.questions.map(q=>q.key)).size,p.questions.length);
    assert.ok(Model.restore(p,mode));
  }
});
test("due skills use nonzero variants before previously unasked trivial facts",()=>{
  for(const mode of ['addsub','decomp']){
    const state=known(mode),id=mode==='addsub'?'math-addsub-10':'math-decomp-10',knowledgeId=mode==='addsub'?'add-total-10':'bond-part-10';
    state.items[id].mathKnowledge[knowledgeId].nextReview=day;
    state.activity.previous={id,at:day+'T10:00:00Z',details:{questionKeys:Model.pool(mode).filter(q=>q.knowledgeId===knowledgeId && !zero(q)).map(q=>q.key)}};
    const p=Model.plan(mode,state,day,1,rng());
    assert.equal(p.questions[0].knowledgeId,knowledgeId);
    assert.equal(zero(p.questions[0]),false);
  }
});
test("operation balance does not displace older overdue skills",()=>{
  const state=known('addsub'),points=state.items['math-addsub-10'].mathKnowledge;
  for(let n=3;n<=10;n++)points['sub-whole-'+n].nextReview='2026-10-01';
  for(let n=2;n<=10;n++)points['add-total-'+n].nextReview=day;
  const p=Model.plan('addsub',state,day,10,rng());
  assert.equal(p.questions.slice(0,8).filter(q=>q.meta.op==='-').length,8);
  assert.equal(p.questions.slice(8).filter(q=>q.meta.op==='+').length,2);
});
test("arithmetic options use the three closest distinct alternatives within zero to ten",()=>{
  const state=known('addsub');
  for(const point of Object.values(state.items['math-addsub-10'].mathKnowledge))point.nextReview=day;
  for(let seed=1;seed<=100;seed++)for(const q of Model.plan('addsub',state,day,10,rng(seed)).questions){
    assert.equal(new Set(q.choices).size,4);
    assert.ok(q.choices.includes(q.answer));
    const distances=q.choices.filter(n=>n!==q.answer).map(n=>Math.abs(n-q.answer)).sort((a,b)=>a-b);
    const nearest=Array.from({length:11},(_,n)=>n).filter(n=>n!==q.answer).map(n=>Math.abs(n-q.answer)).sort((a,b)=>a-b).slice(0,3);
    assert.deepEqual(copy(distances),nearest);
  }
});
test("old drafts with multiple zero facts and distant choices still restore unchanged",()=>{
  const questions=['0+0','5+0','8-0'].map(key=>({...copy(Model.pool('addsub').find(q=>q.key===key)),choices:[0,5,8,10],reason:'review'}));
  const old={kind:'math',version:1,mode:'addsub',questions,questionResults:[{key:'0+0',knowledgeId:'add-total-0',answer:5,correct:false}],index:1};
  assert.deepEqual(copy(Model.restore(old,'addsub')),old);
});
test("draft restoration preserves first answers, question order, options and continuation position",()=>{
  for(const mode of ["addsub","decomp"]){
    const p=Model.plan(mode,{items:{}},day,10,rng()),wrong=(p.questions[0].answer+1)%11;
    const first=Model.record(p,wrong);
    assert.equal(first.correct,false);
    assert.equal(Model.record(p,p.questions[0].answer),first,"Repeated input cannot overwrite the first answer");
    const restored=Model.restore(copy(p),mode);
    assert.deepEqual(copy(restored),copy(p));
    restored.index++;
    assert.ok(Model.restore(restored,mode));
    const invalid=copy(restored);invalid.questionResults[0].correct=true;
    assert.equal(Model.restore(invalid,mode),null);
    invalid.questionResults[0].correct=false;invalid.index=3;
    assert.equal(Model.restore(invalid,mode),null);
  }
});

test("crossing ten requires both split parts, ten, and the final answer",()=>{
  const examples = [
    {mode:"make10",key:"8+5",steps:[2,3,10],answer:13,count:20},
    {mode:"flat10",key:"13-6",steps:[3,3,10],answer:7,count:36},
    {mode:"flat10",key:"12-9",steps:[2,7,10],answer:3,count:36},
  ];
  for (const {mode,key,steps,answer,count} of examples) {
    const pool=Model.pool(mode);
    assert.equal(pool.length,count);
    const question=pool.find(q=>q.key===key);
    assert.deepEqual(copy(question.steps),steps);
    assert.equal(question.answer,answer);
    const plan={kind:"math",version:1,mode,questions:[question],index:0,questionResults:[]};
    assert.equal(Model.record(plan,answer),null);
    const wrong=[steps[0]+1,steps[1]-1,10];
    const first=Model.record(plan,answer,wrong);
    assert.equal(first.correct,false);
    assert.equal(Model.record(plan,answer,steps),first);
    assert.deepEqual(copy(Model.restore(copy(plan),mode)),copy(plan));
    const altered=copy(plan);
    altered.questionResults[0].correct=true;
    assert.equal(Model.restore(altered,mode),null);
    assert.equal(Model.answerResult(question,answer,steps).correct,true);
  }
});
