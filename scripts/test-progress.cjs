// Browser-logic regressions use the actual app source and simulate only HTTP.
// SQLite transactions have separate Go tests. No production test hooks needed.
process.env.TZ = 'Asia/Shanghai';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const sourcePath = path.join(__dirname, '../public/app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const instrumented = source.replace(/\}\)\(\);\s*$/, `
globalThis.subject = {
 loadState, getItem, markLearned, removeClassroomItem, reviewPatch, recordPractice,
 todayStr, addDays, dueItems, syncNow, commitOperations, completePractice,
 navigate, bindSessionExit, openReviewItem, startReview, renderHome,
 writingCharacters, openParent, initializePage, customPoemFromForm,
 setView: value => currentView=value,
 setSession: value => reviewSession=value,
 getSession: () => reviewSession,
 getView: () => currentView,
 getWritingId: () => selectedWriteId,
 isReady: () => stateReady,
 setPoems: value => { BUILTIN_POEMS=value; POEMS=value; poemsLoadPromise=Promise.resolve(value); }
};
})();`);
assert.notEqual(instrumented, source, 'App must still be an IIFE for in-memory exports');
assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/,
  'Course content and progress must never be persisted in the browser');
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const emptyState = () => ({items:{},activity:{},customPoems:{},customCharacters:{},hiddenCourses:{}});
const course = (id,type='poem',extra={}) => ({id,type,title:id,learned:true,stage:0,nextReview:'2026-10-01',
  createdAt:'2026-09-30T12:00:00Z',updatedAt:'2026-09-30T12:00:00Z',...extra});

function environment(initial = {}) {
  let now = new Date('2026-10-01T01:30:00+08:00').getTime();
  let database = {...emptyState(),...copy(initial)};
  let holdRequests = false;
  let timerId = 0;
  const requests = [], timers = new Map(), elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id,style:{},dataset:{},textContent:'',innerHTML:'',value:'',disabled:false,open:false,
      classList:{toggle:()=>false,add:()=>{},remove:()=>{}},
      querySelectorAll:()=>[],querySelector:selector=>element(selector),
      setAttribute:()=>{},removeAttribute:()=>{},addEventListener:()=>{},
      showModal(){this.open=true;},close(){this.open=false;},reset(){this.value='';},
      getContext:()=>({}),getBoundingClientRect:()=>({left:0,top:0,width:600,height:600}),
    });
    return elements.get(id);
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length?args:[now])); }
    static now() { return now; }
  }
  // Only the documented API contract is modeled: atomic entry operations,
  // merge cannot recreate deletions, deleting a course cascades its activity.
  function serverResponse(request) {
    if (request.method==='GET') return {status:200,data:{found:true,payload:copy(database),updatedAt:database.updatedAt||0}};
    assert.equal(request.method,'PATCH','Never PUT a whole stale browser snapshot');
    const {operations,...other}=request.body;
    assert.deepEqual(other,{});
    if(!Array.isArray(operations)||!operations.length||operations.length>100) return {status:400,data:{error:'invalid_operations'}};
    const next=copy(database);
    for(const operation of operations) {
      const entries=next[operation.collection]||={};
      if(operation.op==='merge') {
        if(!Object.hasOwn(entries,operation.key)) return {status:409,data:{error:'entry_not_found',payload:copy(database),updatedAt:database.updatedAt||0}};
        entries[operation.key]={...entries[operation.key],...copy(operation.value)};
      } else if(operation.op==='create') {
        if(!Object.hasOwn(entries,operation.key)) entries[operation.key]=copy(operation.value);
      } else if(operation.op==='set') entries[operation.key]=copy(operation.value);
      else if(operation.op==='delete') {
        delete entries[operation.key];
        if(operation.collection==='items') {
          for(const [key,event] of Object.entries(next.activity)) if(event.id===operation.key) delete next.activity[key];
        }
      } else assert.fail(`Unknown operation ${operation.op}`);
    }
    next.updatedAt=Math.max(now,(database.updatedAt||0)+1);database=next;
    return {status:200,data:{ok:true,payload:copy(database),updatedAt:database.updatedAt}};
  }
  const context=vm.createContext({
    Date:FakeDate,Math,console,AbortController,crypto:require('crypto').webcrypto,
    document:{getElementById:element,querySelectorAll:()=>[],querySelector:element,
      addEventListener:()=>{},createElement:()=>element(`new${elements.size}`),body:{appendChild:()=>{}}},
    window:{scrollTo:()=>{},addEventListener:()=>{},confirm:()=>true},confirm:()=>true,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:(url,options={})=>new Promise((resolve,reject)=>{
      const request={url,options,method:options.method||'GET',settled:false,body:options.body?JSON.parse(options.body):null,
        reply(override) { assert.equal(this.settled,false);this.settled=true;const result=override||serverResponse(this);
          resolve({ok:result.status>=200&&result.status<300,status:result.status,json:async()=>{
            if(result.jsonError) throw new SyntaxError('Unexpected token <');return copy(result.data);
          }}); },
        fail(){this.settled=true;reject(new Error('network unavailable'));},
        commitThenLoseResponse(){this.settled=true;serverResponse(this);reject(new Error('response lost'));},
      };
      assert.equal(url,'/api/progress');requests.push(request);
      if(!holdRequests) queueMicrotask(()=>request.reply());
    }),
  });
  for(const name of ['localStorage','sessionStorage','indexedDB']) {
    Object.defineProperty(context,name,{get(){throw new Error(`${name} must not be used`);}});
  }
  vm.runInContext(instrumented,context,{filename:sourcePath});
  context.subject.setView('poems');context.subject.setPoems([]);
  return {subject:context.subject,requests,timers,elements,element,db:()=>copy(database),
    alterServer:change=>change(database),hold:value=>{holdRequests=value;},
    at:date=>{now=new Date(`${date}T01:30:00+08:00`).getTime();},connect:()=>context.subject.syncNow(),
    async nextRequest(){await flush();const request=requests.find(request=>!request.settled);assert.ok(request,'Expected pending request');return request;},
  };
}
const tests=[];
function test(name,run){tests.push({name,run});}

test('server is sole source; GET-only loading and a fresh page read current server data',async()=>{
  const e=environment({items:{a:course('a')}}),t=e.subject;
  assert.equal(t.isReady(),false);assert.deepEqual(copy(t.loadState().items),{});
  assert.equal(await e.connect(),true);assert.equal(t.getItem('a').title,'a');
  assert.equal(e.requests.length,1);assert.equal(e.requests[0].method,'GET');
  e.alterServer(state=>{delete state.items.a;state.items.b=course('b');});await t.syncNow();
  assert.equal(t.getItem('a'),null);assert.ok(t.getItem('b'));assert.ok(e.requests.every(r=>r.method==='GET'));
  const other=environment(e.db());await other.connect();assert.equal(other.subject.getItem('a'),null);assert.ok(other.subject.getItem('b'));
});

test('local dates and intervals 1, 2, 4, 7, 15, 30; same-day and early practice never advance again',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  assert.equal(t.todayStr(),'2026-10-01');assert.equal(t.addDays('2026-12-31',1),'2027-01-01');assert.equal(t.addDays('2024-02-28',1),'2024-02-29');
  await t.markLearned('a',{type:'poem',title:'课堂古诗'});assert.equal(t.getItem('a').nextReview,'2026-10-01');
  const schedule=[['2026-10-01','2026-10-02'],['2026-10-02','2026-10-04'],['2026-10-04','2026-10-08'],
    ['2026-10-08','2026-10-15'],['2026-10-15','2026-10-30'],['2026-10-30','2026-11-29'],['2026-11-29','2026-12-29']];
  for(const [day,next] of schedule) {
    e.at(day);await t.recordPractice('a','poem','remember');assert.equal(t.getItem('a').nextReview,next,`After ${day}`);
    const before=copy(t.getItem('a'));await t.recordPractice('a','poem','remember');
    assert.deepEqual(copy(t.getItem('a')),before,'Same-day/free practice must not advance the interval');
  }
  const before=copy(t.getItem('a'));await t.markLearned('a',{type:'poem',title:'again'});assert.deepEqual(copy(t.getItem('a')),before);
  e.at('2026-12-29');await t.recordPractice('a','poem','forgot');assert.equal(t.getItem('a').stage,0);assert.equal(t.getItem('a').nextReview,'2026-12-30');
  const sameDay=t.reviewPatch({...course('x'),stage:4,reviewDay:'2026-12-29',reviewStartStage:2},'remember');
  assert.equal(sameDay.stage,3);assert.equal(sameDay.nextReview,'2027-01-02');
});

test('today shows due items oldest first; no due items never falls back to all learned content',async()=>{
  const e=environment({items:{future:course('future','pinyin',{nextReview:'2026-10-04'})}}),t=e.subject;await e.connect();await t.renderHome();
  assert.equal(t.dueItems().length,0);assert.doesNotMatch(e.element('home-content').innerHTML,/data-review="future"/);
  assert.match(e.element('home-content').innerHTML,/id="start-review"[^>]*disabled/);await t.startReview();assert.equal(t.getSession(),null);
  e.alterServer(state=>{state.items.today=course('today','pinyin');state.items.overdue=course('overdue','pinyin',{nextReview:'2026-09-28'});state.items.inactive=course('inactive','pinyin',{learned:false});});
  await t.syncNow();assert.deepEqual(copy(t.dueItems().map(item=>item.id)),['overdue','today']);
  await t.startReview();assert.deepEqual(copy(t.getSession().items.map(item=>item.id)),['overdue','today']);
});

test('pending/failed save never updates progress, flowers or session; retry succeeds',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});e.hold(true);const operation=t.completePractice(item.id,'remember',item);const request=await e.nextRequest();
  assert.equal(request.method,'PATCH');assert.equal(t.getItem(item.id).stage,0);assert.equal(Object.keys(t.loadState().activity).length,0);assert.equal(t.getSession().index,0);
  request.fail();await operation;assert.equal(t.getItem(item.id).stage,0);assert.equal(t.getSession().index,0);assert.equal(Object.keys(t.loadState().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  const retry=t.completePractice(item.id,'remember',item);(await e.nextRequest()).reply();await retry;
  assert.equal(t.getItem(item.id).nextReview,'2026-10-02');assert.equal(Object.keys(t.loadState().activity).length,1);assert.equal(t.getSession(),null);
  assert.match(e.element('home-content').innerHTML,/你的小花开啦/);
});

test('queued PATCHes address only changed entries and preserve independent server additions',async()=>{
  const e=environment(),t=e.subject;await e.connect();e.hold(true);
  const a=t.markLearned('a',{type:'poem',title:'a'}),first=await e.nextRequest();const b=t.markLearned('b',{type:'write',title:'b'});await flush();
  assert.equal(e.requests.filter(r=>!r.settled).length,1);assert.equal(t.getItem('a'),null);assert.equal(t.getItem('b'),null);
  e.alterServer(state=>{state.items.remote=course('remote');});first.reply();await a;const second=await e.nextRequest();
  assert.ok(first.body.operations.every(op=>op.key==='a'));assert.ok(second.body.operations.every(op=>op.key==='b'));
  second.reply();await b;assert.deepEqual(Object.keys(t.loadState().items).sort(),['a','b','remote']);
});

test('stale enrollment uses insert-if-absent and cannot reset another device\'s course progress',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  const advanced=course('a','poem',{stage:4,nextReview:'2026-10-15',lastResult:'remember'});
  e.alterServer(state=>{state.items.a=copy(advanced);});
  await t.markLearned('a',{type:'poem',title:'a'});
  assert.deepEqual(copy(t.getItem('a')),advanced);
});

test('legacy paused courses resume without losing their stage or next review date',async()=>{
  const paused=course('paused','poem',{learned:false,stage:3,nextReview:'2026-10-08'});
  const missingDate=course('missing-date','write',{learned:false,stage:2,nextReview:null});
  const e=environment({items:{paused,'missing-date':missingDate}}),t=e.subject;
  await e.connect();assert.equal(t.dueItems().length,0);
  await t.markLearned('paused',{type:'poem',title:'paused'});
  assert.equal(t.getItem('paused').learned,true);
  assert.equal(t.getItem('paused').stage,3);
  assert.equal(t.getItem('paused').nextReview,'2026-10-08');
  assert.equal(t.dueItems().length,0,'Resuming must not make a future review due immediately');
  await t.markLearned('missing-date',{type:'write',title:'missing-date'});
  assert.equal(t.getItem('missing-date').learned,true);
  assert.equal(t.getItem('missing-date').stage,2);
  assert.equal(t.getItem('missing-date').nextReview,'2026-10-01');
  assert.deepEqual(copy(t.dueItems().map(item=>item.id)),['missing-date']);
});

test('HTML or malformed JSON with HTTP 200 cannot be mistaken for a successful save',async()=>{
  for(const response of [{status:200,jsonError:true},{status:200,data:{}},{status:200,data:{ok:true,payload:{items:[]}}}]) {
    const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
    t.setSession({items:[item],index:0});e.hold(true);const attempt=t.completePractice(item.id,'remember',item);
    (await e.nextRequest()).reply(response);await attempt;
    assert.equal(t.getItem(item.id).stage,0);assert.equal(t.getSession().index,0);
    assert.equal(Object.keys(t.loadState().activity).length,0);assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  }
});

test('a lost completion acknowledgement can be retried without a second flower or interval advance',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});e.hold(true);const initial=t.completePractice(item.id,'remember',item);
  const first=await e.nextRequest();first.commitThenLoseResponse();await initial;
  assert.equal(Object.keys(e.db().activity).length,1);assert.equal(Object.keys(t.loadState().activity).length,0);assert.equal(t.getSession().index,0);
  const retry=t.completePractice(item.id,'remember',item),second=await e.nextRequest();
  assert.equal(first.body.operations.find(op=>op.collection==='activity').key,second.body.operations.find(op=>op.collection==='activity').key);
  second.reply();await retry;assert.equal(Object.keys(e.db().activity).length,1);assert.equal(t.getItem(item.id).stage,1);
});

test('remote deletion conflicts cannot recreate a course or award a flower',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});e.alterServer(state=>{delete state.items[item.id];});await t.completePractice(item.id,'remember',item);
  assert.equal(t.getItem(item.id),null);assert.equal(e.db().items[item.id],undefined);assert.equal(Object.keys(e.db().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  // Retrying after the 409 refresh must not degrade into activity-only success.
  await t.completePractice(item.id,'remember',item);assert.equal(Object.keys(e.db().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
});

test('custom course enrollment persists together with content and routes to the exact character',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  const poem={id:'custom-poem-class',title:'课堂小诗',titlePy:[],author:'老师',authorPy:[],dynasty:'',dynastyPy:[],lines:[{text:'春天来啦',chars:[{c:'春',p:''}]}]};
  const character={id:'custom-char-ming',c:'明',strokes:'8画',tip:'左日右月'};
  await t.markLearned(poem.id,{type:'poem',title:poem.title},[{op:'set',collection:'customPoems',key:poem.id,value:poem}]);
  await t.markLearned(character.id,{type:'write',title:'汉字·明'},[{op:'set',collection:'customCharacters',key:character.id,value:character}]);
  assert.ok(t.getItem(poem.id));assert.ok(t.getItem(character.id));assert.equal(e.requests.filter(r=>r.method==='PATCH').length,2);
  const fresh=environment(e.db());await fresh.connect();assert.equal(fresh.subject.loadState().customPoems[poem.id].title,poem.title);
  fresh.subject.setSession({items:[fresh.subject.getItem(character.id)],index:0});fresh.subject.openReviewItem(character.id,'write');
  assert.equal(fresh.subject.getWritingId(),character.id);assert.match(fresh.element('write-content').innerHTML,/明 字描红画布/);
  await fresh.element('write-paper').onclick();assert.equal(fresh.subject.getItem(character.id).nextReview,'2026-10-02');
  assert.equal(fresh.subject.getItem('write-basic'),null);assert.equal(fresh.subject.getItem(poem.id).nextReview,'2026-10-01');
});

test('parent poem form validates syllables and keeps one ID after a lost save acknowledgement',async()=>{
  const e=environment(),t=e.subject;await e.connect();await t.openParent();
  const form=e.element('custom-poem-form');
  form.elements={title:{value:'春晓'},author:{value:'孟浩然'},body:{value:'春眠不觉晓，\n处处闻啼鸟。'},pinyin:{value:'chūn mián bù jué xiǎo\nchù chù wén tí niǎo'}};
  const parsed=t.customPoemFromForm(form);assert.equal(parsed.lines[0].chars[0].p,'chūn');
  assert.equal(parsed.lines[0].chars.at(-1).p,'');
  form.elements.pinyin.value='chūn\nchù';assert.throws(()=>t.customPoemFromForm(form),/音节/);
  form.elements.pinyin.value='';e.hold(true);
  const event={preventDefault(){},currentTarget:form};
  const initial=form.onsubmit(event),first=await e.nextRequest();first.commitThenLoseResponse();await initial;
  assert.equal(Object.keys(e.db().customPoems).length,1);assert.equal(Object.keys(t.loadState().customPoems).length,0);
  e.at('2026-10-02');const retry=form.onsubmit(event),second=await e.nextRequest();
  assert.equal(first.body.operations.find(op=>op.collection==='customPoems').key,second.body.operations.find(op=>op.collection==='customPoems').key);
  second.reply();await retry;assert.equal(Object.keys(t.loadState().customPoems).length,1);assert.equal(Object.keys(t.loadState().items).length,1);
});

test('parent character form rejects non-single Han input and updates built-in hints without duplicate cards',async()=>{
  const e=environment(),t=e.subject;await e.connect();await t.openParent();const form=e.element('custom-character-form');
  form.elements={character:{value:'春天'},strokes:{value:''},tip:{value:''}};
  const event={preventDefault(){},currentTarget:form},initialRequests=e.requests.length;
  await form.onsubmit(event);assert.equal(e.requests.length,initialRequests);assert.match(e.element('character-form-error').textContent,/一个汉字/);
  form.elements.character.value='A';await form.onsubmit(event);assert.equal(e.requests.length,initialRequests);
  form.elements.character.value='木';form.elements.tip.value='老师说：横短竖长';await form.onsubmit(event);
  const cards=t.writingCharacters().filter(ch=>ch.c==='木');assert.equal(cards.length,1);assert.equal(cards[0].tip,'老师说：横短竖长');
  assert.ok(t.getItem(cards[0].id));assert.equal(t.getItem('write-basic'),null);
});

test('course deletion removes custom data and 120 history entries without exceeding PATCH limits',async()=>{
  const id='custom-char-ming',activity=Object.fromEntries(Array.from({length:120},(_,i)=>[`event-${i}`,{day:'2026-09-30',id,type:'write'}]));
  activity.unrelated={day:'2026-09-30',id:'other',type:'poem'};
  const e=environment({items:{[id]:course(id,'write'),other:course('other')},activity,customCharacters:{[id]:{id,c:'明'}}}),t=e.subject;
  await e.connect();await t.removeClassroomItem(id);assert.equal(t.getItem(id),null);assert.equal(t.loadState().customCharacters[id],undefined);
  assert.equal(Object.values(t.loadState().activity).filter(event=>event.id===id).length,0);assert.ok(t.getItem('other'));assert.ok(t.loadState().activity.unrelated);
  assert.ok(e.requests.find(r=>r.method==='PATCH').body.operations.length<=100);await t.syncNow();assert.equal(t.getItem(id),null);
});

test('home/rest cancel sessions; delayed completion cannot advance a newly started session',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});t.navigate('home');await flush();assert.equal(t.getSession(),null);
  t.setSession({items:[item],index:0});t.bindSessionExit();e.element('session-exit').onclick();await flush();assert.equal(t.getSession(),null);
  t.setSession({items:[item],index:0});e.hold(true);const saved=t.completePractice(item.id,'remember',item),request=await e.nextRequest();
  t.navigate('home');await flush();
  // The home review tile can start a different session while its predecessor saves.
  t.setSession({items:[item],index:0});t.openReviewItem(item.id,item.type);
  const newSession=t.getSession();assert.ok(newSession);request.reply();await saved;
  assert.equal(t.getSession(),newSession,'Completion belongs to its original session');assert.equal(newSession.index,0);
});

test('initial connection failure has a retry and cannot report successful practice',async()=>{
  const e=environment(),t=e.subject;e.hold(true);const initialization=t.initializePage();(await e.nextRequest()).fail();await initialization;
  assert.equal(t.isReady(),false);assert.match(e.element('home-content').innerHTML,/id="retry-connection"/);
  const view=t.getView();t.navigate('pinyin');assert.equal(t.getView(),view);
  await t.completePractice('pinyin-basic','remember',{type:'pinyin'});assert.equal(Object.keys(t.loadState().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  const retry=e.element('retry-connection').onclick();(await e.nextRequest()).reply();await retry;assert.equal(t.isReady(),true);
});

async function main(){
  for(const {name,run} of tests){
    let timer;
    try {await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Timed out: ${name}`)),5000);})]);}
    finally {clearTimeout(timer);}
    console.log(`PASS ${name}`);
  }
  console.log(`${tests.length} progress regression groups passed`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
