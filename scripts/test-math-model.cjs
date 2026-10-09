"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),test=require("node:test");
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync("public/math-model.js","utf8"),context);
const Model=context.ChenchenMath;
const copy=value=>JSON.parse(JSON.stringify(value));
const rng=()=>{let seed=17;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
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
  assert.equal(Model.plan("addsub",state,day).questions.length,0);
  state.items["math-addsub-10"].mathKnowledge["add-total-0"].nextReview=day;
  const p=Model.plan("addsub",state,day);
  assert.equal(p.questions.length,1);assert.equal(p.questions[0].key,"0+0");
  assert.ok(Model.restore(p,"addsub"));
});
test("recent question surfaces are deferred when another variant is available",()=>{
  const state=known("addsub"),points=state.items["math-addsub-10"].mathKnowledge;
  points["add-total-10"].nextReview=day;
  const first=Model.plan("addsub",state,day,10,rng());
  state.activity.previous={id:"math-addsub-10",at:"2026-10-04T10:00:00Z",details:{questionKeys:first.questions.map(q=>q.key)}};
  const next=Model.plan("addsub",state,day,10,rng());
  assert.ok(!state.activity.previous.details.questionKeys.includes(next.questions[0].key));
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
