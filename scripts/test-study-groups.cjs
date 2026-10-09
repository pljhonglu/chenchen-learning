const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const context = {Intl,Date};
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/study-groups.js','utf8'),context);
const Model = context.ChenchenStudyGroups;
const today = '2026-10-05';
const fresh = () => ({items:{},activity:{},garden:{groups:{}},hiddenCourses:{},studySessions:{}});
const catalog = (type,n=15) => Array.from({length:n},(_,i)=>({id:type+'-'+String(i+1).padStart(2,'0'),type,title:type+' '+(i+1),source:type==='english' ? 'classroom' : undefined}));
const ids = group => group ? Array.from(group.items,item=>item.id) : null;
test('new lessons stay small and never duplicate an item',()=>{
  for(const type of ['pinyin','write','english']) {
    const plan=Model.select(catalog(type),fresh(),type,'learn',today);
    assert.equal(plan.count,Model.CONFIG[type].newCount);
    assert.equal(new Set(ids(plan)).size,plan.count);
    assert(plan.items.every(item=>item.phase==='learn'));
  }
});
test('poems are always review material even without a learned flag',()=>{
  const state=fresh(),cards=catalog('poem');
  state.items[cards[0].id]={learned:false,nextReview:'2026-10-20'};
  const plan=Model.select(cards,state,'poem','learn',today);
  assert.equal(plan.mode,'review');
  assert(plan.items.every(item=>item.phase==='review'));
  assert(!ids(plan).includes(cards[0].id));
  assert.equal(plan.count,5);
});
test('next day learning does not repeat future items or starve untouched lessons',()=>{
  const state=fresh(),cards=catalog('write');
  for(const item of cards.slice(0,5)) state.items[item.id]={learned:true,nextReview:'2026-10-10'};
  state.garden.groups.yesterday={day:'2026-10-04',contentIds:cards.slice(0,5).map(item=>item.id)};
  assert.deepEqual(ids(Model.select(cards,state,'write','learn',today)),['write-06','write-07']);
  assert.equal(Model.select(cards,state,'write','review',today),null);
});
test('overdue items take priority in both entry points, followed by a little new material',()=>{
  const state=fresh(),cards=catalog('write');
  state.items['write-01']={learned:true,nextReview:'2026-10-20'};
  state.items['write-15']={learned:true,nextReview:'2026-10-01'};
  state.items['write-14']={learned:true,nextReview:today};
  const review=Model.select(cards,state,'write','review',today);
  assert.deepEqual(ids(review),['write-15','write-14']);
  assert.equal(review.count,2);
  const learn=Model.select(cards,state,'write','learn',today);
  assert.deepEqual(ids(learn),['write-15','write-14','write-02','write-03']);
  assert.deepEqual(Array.from(learn.items,item=>item.phase),['review','review','learn','learn']);
});
test('one due item forms a short review without future filler',()=>{
  const state=fresh(),cards=catalog('pinyin');
  state.items[cards[0].id]={learned:true,nextReview:today};
  for(const item of cards.slice(1)) state.items[item.id]={learned:true,nextReview:'2026-10-20'};
  const before=JSON.stringify(state);
  const plan=Model.select(cards,state,'pinyin','review',today);
  assert.equal(plan.count,1);
  assert.equal(plan.dueCount,1);
  assert.equal(JSON.stringify(state),before);
  state.hiddenCourses[cards[0].id]=true;
  assert.equal(Model.select(cards,state,'pinyin','review',today),null);
});
test('today completed items are excluded, but other overdue items remain available',()=>{
  const state=fresh(),cards=catalog('poem');
  state.garden.groups.a={day:today,contentIds:['poem-01','poem-02']};
  state.items['poem-03']={reviewDay:today,nextReview:today};
  assert.equal(ids(Model.select(cards,state,'poem','learn',today))[0],'poem-04');
});
test('an unassessed classroom extension is never enrolled automatically',()=>{
  const state=fresh(),cards=catalog('english',1).map(item=>({...item,source:'extension'}));
  assert.equal(Model.select(cards,state,'english','learn',today),null);
  state.items[cards[0].id]={learned:true,nextReview:today};
  assert.equal(Model.select(cards,state,'english','review',today).count,1);
});
test('resume restores saved prefix and math practice across dates without mutating the snapshot',()=>{
  const state=fresh();
  state.studySessions.a={id:'a',type:'write',mode:'learn',items:catalog('write',2).map(item=>({...item,phase:'learn'})),entries:[{id:'write-01',result:'supported'}],createdAt:'2026-10-04'};
  const plan=Model.select(catalog('write'),state,'write','review',today);
  assert.equal(plan.id,'a');assert.equal(plan.index,1);assert.equal(plan.count,2);assert.equal(plan.resumed,true);
  plan.entries[0].result='again';assert.equal(state.studySessions.a.entries[0].result,'supported');
  assert.equal(Model.reviews(catalog('write'),state,today)[0].id,'a');
});
test('mathematics follows each knowledge point date instead of an aggregate date',()=>{
  const cards=[{id:'math-addsub-10',type:'math',title:'加减法'}],state=fresh();
  state.items[cards[0].id]={learned:true,nextReview:'2026-10-20',mathKnowledge:{addition:{nextReview:today},subtraction:{nextReview:'2026-10-12'}}};
  assert.equal(Model.select(cards,state,'math','review',today).count,10);
  state.items[cards[0].id].mathKnowledge.addition.nextReview='2026-10-15';
  state.items[cards[0].id].nextReview=today;
  assert.equal(Model.select(cards,state,'math','learn',today),null);
  state.items[cards[0].id].mathKnowledge.addition.nextReview=today;
  state.garden.groups.a={day:today,contentIds:[cards[0].id]};
  assert(Model.select(cards,state,'math','learn',today),'Other due knowledge points stay available after one group');
});
test('all due poems remain reachable over multiple days',()=>{
  const state=fresh(),cards=catalog('poem',15),seen=new Set();
  for(const date of ['2026-10-05','2026-10-06','2026-10-07']) {
    const plan=Model.select(cards,state,'poem','learn',date);
    for(const item of plan.items) {seen.add(item.id);state.items[item.id]={nextReview:'2026-11-01',reviewDay:date};}
  }
  assert.equal(seen.size,15);
});
test('Beijing midnight controls both queues consistently',()=>{
  assert.equal(Model.day(new Date('2026-10-04T16:00:00Z')),today);
  assert.equal(Model.day(new Date('2026-10-04T15:59:59Z')),'2026-10-04');
});

test('a group completed today does not hide a yesterday answer which is due again today',()=>{
  const state=fresh(),cards=catalog('pinyin',1);
  state.items[cards[0].id]={learned:true,reviewDay:'2026-10-04',nextReview:today};
  state.garden.groups.overnight={day:today,contentIds:[cards[0].id]};
  assert.equal(Model.select(cards,state,'pinyin','review',today).count,1);
});
test('resume distinguishes same-day possible exposure from a genuinely later day',()=>{
  const state=fresh();
  state.studySessions.a={id:'a',type:'poem',mode:'review',items:catalog('poem',1),entries:[],updatedAt:'2026-10-04T15:00:00Z'};
  assert.equal(Model.select([],state,'poem','review',today).resumeExposure,false);
  state.studySessions.a.updatedAt='2026-10-04T16:00:00Z';
  assert.equal(Model.select([],state,'poem','review',today).resumeExposure,true);
});
test('new mathematical knowledge remains reachable on a day with no due reviews',()=>{
  vm.runInContext(fs.readFileSync('public/math-model.js','utf8'),context);
  const state=fresh(),cards=[{id:'math-addsub-10',type:'math',title:'加减法'}];
  state.items[cards[0].id]={learned:true,reviewDay:'2026-10-04',nextReview:'2026-10-10',mathKnowledge:{'add-total-0':{nextReview:'2026-10-10'}}};
  assert.equal(Model.select(cards,state,'math','review',today),null);
  const plan=Model.select(cards,state,'math','learn',today);
  assert.equal(plan.mode,'learn');assert.equal(plan.items[0].phase,'learn');
  state.garden.groups.today={day:today,contentIds:[cards[0].id]};
  assert.equal(Model.select(cards,state,'math','learn',today),null);
});
