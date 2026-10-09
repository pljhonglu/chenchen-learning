/* Daily study plans. Selection never brings future reviews forward to fill a group. */
(function (global) {
  "use strict";
  const CONFIG = Object.freeze({
    poem:{title:"古诗",count:5,unit:"首",newCount:0}, math:{title:"加减法",count:10,unit:"题",newCount:0},
    decomp:{title:"分解组合",count:10,unit:"题",newCount:0}, pinyin:{title:"拼音",count:10,unit:"个",newCount:4},
    write:{title:"汉字",count:5,unit:"个字",newCount:2}, english:{title:"英语",count:5,unit:"个词",newCount:2},
  });
  function day(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
  }
  function pending(state,type) {
    return Object.values(state.studySessions || {}).filter(group=>group.type===type).sort((a,b)=>(a.createdAt || "").localeCompare(b.createdAt || "") || a.id.localeCompare(b.id))[0] || null;
  }
  function mathDue(item,today) {
    const knowledge = Object.values(item?.mathKnowledge || {});
    return knowledge.length ? knowledge.some(point=>point.nextReview && point.nextReview<=today) : !!item?.nextReview && item.nextReview<=today;
  }
  function select(catalog, state, type, mode, today) {
    const config = CONFIG[type];
    if (!config) return null;
    const math = type === "math" || type === "decomp";
    const items = state.items || {};
    const draft = pending(state,type);
    if (draft) {
      const copy = JSON.parse(JSON.stringify(draft));
      const savedAt=new Date(copy.updatedAt || copy.createdAt);
      const resumeExposure=!Number.isFinite(savedAt.getTime()) || day(savedAt)===today;
      return {...config,...copy,count:math ? (copy.progress?.practice?.questions?.length || 10) : copy.items.length,index:copy.entries.length,
        practice:copy.progress?.practice, resumed:true,resumeExposure,dueCount:copy.items.filter(item=>item.phase==="review").length};
    }
    let available = [...new Map(catalog.filter(item=>item.type===type && !state.hiddenCourses?.[item.id]).map(item=>[item.id,item])).values()];
    const completed = new Set(Object.values(state.garden?.groups || {}).filter(group=>group.day===today).flatMap(group=>group.contentIds || []));
    const lastDay = id => items[id]?.reviewDay || "";
    const doneToday = id => lastDay(id) ? lastDay(id)===today : completed.has(id);
    const known = item => type==="poem" || !!items[item.id]?.learned;
    const dueDate = item => items[item.id]?.nextReview || today;
    if (math) {
      const item = available[0];
      if (!item) return null;
      const stored = items[item.id];
      const hasKnowledge = Object.keys(stored?.mathKnowledge || {}).length>0;
      if (!hasKnowledge && doneToday(item.id)) return null;
      const due=mathDue(stored,today);
      const unseen=global.ChenchenMath?.pool(type==="decomp" ? "decomp" : "addsub").some(question=>!stored?.mathKnowledge?.[question.knowledgeId]);
      const introduce=mode!=="review" && !completed.has(item.id) && (unseen || !stored);
      if (!due && !introduce) return null;
      return {...config,type,mode:due ? "review" : "learn",items:[{...item,phase:due ? "review" : "learn"}],dueCount:due ? 1 : 0};
    }
    available = available.filter(item=>!doneToday(item.id));
    const due = available.filter(item=>known(item) && dueDate(item)<=today).sort((a,b)=>
      dueDate(a).localeCompare(dueDate(b)) || lastDay(a.id).localeCompare(lastDay(b.id)) || a.id.localeCompare(b.id));
    const selected = due.slice(0,config.count).map(item=>({...item,phase:"review"}));
    if (mode!=="review" && config.newCount) {
      const fresh = available.filter(item=>!known(item) && (type!=="english" || item.source==="classroom"));
      selected.push(...fresh.slice(0,Math.min(config.newCount,config.count-selected.length)).map(item=>({...item,phase:"learn"})));
    }
    if (!selected.length) return null;
    return {...config,type,mode:selected.every(item=>item.phase==="review") ? "review" : "learn",
      count:selected.length,items:selected,dueCount:selected.filter(item=>item.phase==="review").length};
  }
  function reviews(catalog,state,today) {
    return Object.keys(CONFIG).map(type=>select(catalog,state,type,"review",today)).filter(Boolean).sort((a,b)=>{
      if (!!a.resumed!==!!b.resumed) return a.resumed ? -1 : 1;
      const first = group=>group.items.map(item=>state.items?.[item.id]?.nextReview || today).sort()[0];
      return first(a).localeCompare(first(b));
    });
  }
  global.ChenchenStudyGroups = {CONFIG,day,select,reviews,pending,mathDue};
})(typeof window!=="undefined" ? window : globalThis);
