// Regression tests for the dependency-free browser app's state and sync logic.
process.env.TZ = 'Asia/Shanghai';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const sourcePath = require('path').join(__dirname, '../public/app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
// Test-only in-memory instrumentation: insert exports before the IIFE closes.
// The repository file is never changed and no production hooks are required.
const instrumented = source.replace(/\}\)\(\);\s*$/, `
globalThis.subject = {
 loadState, saveState, upsertItem, getItem, markLearned, reviewResult, todayStr,
 addDays, mergeProgressPayloads, syncNow, pushProgress, completePractice,
 navigate, bindSessionExit, openReviewItem,
 setView: value => currentView=value,
 setSession: value => reviewSession=value,
 getSession: () => reviewSession,
 getSync: () => ({syncBusy, syncPending, syncStatus}),
 setPoems: value => { POEMS=value; poemsLoadPromise=Promise.resolve(value); }
};
})();`);
assert.notEqual(instrumented, source);

function environment() {
  let now = new Date('2026-10-01T01:30:00+08:00').getTime();
  let timerId = 0;
  const storage = new Map();
  const timers = new Map();
  const requests = [];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, style:{}, dataset:{}, textContent:'', innerHTML:'', disabled:false,
      classList:{toggle:()=>false,add:()=>{},remove:()=>{}},
      querySelectorAll:()=>[], querySelector:()=>null,
      setAttribute:()=>{}, removeAttribute:()=>{}, addEventListener:()=>{},
      getContext:()=>({}), getBoundingClientRect:()=>({left:0,top:0,width:600,height:600}),
    });
    return elements.get(id);
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length?args:[now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    Date:FakeDate, Math, console,
    localStorage: {getItem:key=>storage.get(key)||null, setItem:(key,value)=>storage.set(key,String(value))},
    document:{getElementById:element, querySelectorAll:()=>[], querySelector:element,
      addEventListener:()=>{}, createElement:()=>element(`new${elements.size}`),body:{appendChild:()=>{}}},
    window:{scrollTo:()=>{},addEventListener:()=>{}},
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,
      respond:data=>resolve({ok:true,status:200,json:async()=>data})})),
  });
  vm.runInContext(instrumented,context,{filename:sourcePath});
  context.subject.setView('poems');
  context.subject.setPoems([]);
  return {subject:context.subject,requests,timers,storage,elements,element,
    tick:ms=>now+=ms,
    runTimer:delay=>{
      const found=[...timers].find(([,value])=>value.delay===delay);
      assert.ok(found,`Expected timer with delay ${delay}`);
      timers.delete(found[0]);return found[1].fn();
    }};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=request=>{
  const body=JSON.parse(request.options.body);
  return {ok:true,kept:'client',payload:body.payload,updatedAt:body.clientUpdatedAt};
};

async function main() {
  {
    const e=environment(),t=e.subject;
    assert.equal(t.todayStr(),'2026-10-01');
    assert.equal(t.addDays('2026-12-31',1),'2027-01-01');
    assert.equal(t.addDays('2024-02-28',1),'2024-02-29');
    t.markLearned('a',{type:'poem',title:'a'});
    const first=t.reviewResult('a','remember',{type:'poem'});
    const repeated=t.reviewResult('a','remember',{type:'poem'});
    assert.equal(first.stage,1);assert.equal(repeated.stage,1);
    assert.equal(first.nextReview,repeated.nextReview);
    const corrected=t.reviewResult('a','forgot',{type:'poem'});
    assert.equal(corrected.stage,0);
    assert.equal(t.reviewResult('a','remember',{type:'poem'}).stage,1);
    e.tick(86400000);
    assert.equal(t.reviewResult('a','remember',{type:'poem'}).stage,2);
    const saved=t.getItem('a');t.markLearned('a',{type:'poem'});
    assert.equal(t.getItem('a').stage,saved.stage);
    console.log('PASS local date/year and leap-day arithmetic; same-day ratings correctable without repeated promotion; re-enrollment preserves learned stage');
  }
  {
    const e=environment(),t=e.subject;
    t.markLearned('a',{type:'poem',title:'before'});
    const pending=t.syncNow('push');
    assert.equal(e.requests.length,1);
    e.tick(2000);
    t.upsertItem('a',{title:'after'});
    t.markLearned('b',{type:'pinyin',title:'new during request'});
    await t.syncNow('push');
    assert.equal(e.requests.length,1);
    e.requests[0].respond(response(e.requests[0]));
    await pending;
    assert.equal(t.getItem('a').title,'after');
    assert.ok(t.getItem('b'));
    e.runTimer(50);await flush();
    assert.equal(e.requests.length,2);
    const saved=JSON.parse(e.requests[1].options.body).payload;
    assert.equal(saved.items.a.title,'after');assert.ok(saved.items.b);
    e.requests[1].respond(response(e.requests[1]));await flush();
    assert.equal(t.getSync().syncBusy,false);
    console.log('PASS slow PUT preserves later edits and new items; busy request is queued and sends the latest state');
  }
  {
    const e=environment(),t=e.subject;
    t.markLearned('a',{type:'poem',title:'before'});
    const pending=t.syncNow('push');
    const remote=response(e.requests[0]);
    remote.kept='server';remote.payload.items.remote={id:'remote',type:'write',learned:true,updatedAt:'2026-09-30T12:00:00Z'};
    e.tick(1000);t.upsertItem('a',{title:'new local'});
    e.requests[0].respond(remote);await pending;
    assert.equal(t.getItem('a').title,'new local');assert.ok(t.getItem('remote'));
    e.runTimer(50);await flush();
    assert.equal(e.requests.length,2);
    e.requests[1].respond(response(e.requests[1]));await flush();
    console.log('PASS kept=server response merges later local edits and schedules the merged retry');
  }
  {
    const e=environment(),t=e.subject;
    t.setSession({items:[{id:'a',type:'poem'}],index:0});
    t.navigate('home');await flush();
    assert.equal(t.getSession(),null);
    t.setSession({items:[{id:'a',type:'poem'}],index:0});
    t.bindSessionExit();e.element('session-exit').onclick();await flush();
    assert.equal(t.getSession(),null);
    console.log('PASS navigation home and explicit rest clear the review session');
  }
  {
    const e=environment(),t=e.subject;
    const items=[{id:'a',type:'poem',title:'a'},
      {id:'pinyin-basic',type:'pinyin',title:'pinyin'},
      {id:'write-basic',type:'write',title:'writing'}];
    items.forEach(item=>t.markLearned(item.id,item));
    t.setSession({items,index:0});
    t.completePractice('not-current','remember',{type:'poem'});
    assert.equal(t.getSession().index,0);
    items.forEach((item,index)=>{
      e.tick(10);
      assert.equal(t.completePractice(item.id,'remember',item),true);
      assert.equal(t.getItem(item.id).stage,1);
      if(index<2) assert.equal(t.getSession().index,index+1);
    });
    assert.equal(t.getSession(),null);
    const celebration=e.element('home-content').innerHTML;
    assert.match(celebration,/你的小花开啦/);
    const pending=t.syncNow('push');
    e.requests[0].respond(response(e.requests[0]));await pending;await flush();
    assert.equal(e.element('home-content').innerHTML,celebration);
    e.element('done-home').onclick();await flush();
    assert.match(e.element('home-content').innerHTML,/id="start-review"/);
    console.log('PASS wrong item cannot advance session; poem/pinyin/writing complete in order; background save preserves celebration; done button returns home');
  }
  {
    const e=environment(),t=e.subject;
    t.markLearned('a',{type:'poem',title:'initial'});
    const pending=t.syncNow('push');
    const remote=response(e.requests[0]);
    remote.kept='server';
    remote.updatedAt=remote.updatedAt+86400000;
    // The API validates clientUpdatedAt independently of payload.updatedAt,
    // so an older client may legitimately leave these different in SQLite.
    e.requests[0].respond(remote);await pending;
    e.runTimer(50);await flush();
    const retry=JSON.parse(e.requests[1].options.body);
    assert.ok(retry.clientUpdatedAt>=remote.updatedAt);
    e.requests[1].respond(response(e.requests[1]));await flush();
    assert.equal([...e.timers.values()].some(timer=>timer.delay===50),false);
    console.log('PASS server-envelope timestamp ahead of payload converges on one retry without a 50 ms retry loop');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
