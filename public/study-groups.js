/* Fixed learning groups. Pure selection rules shared by UI and tests. */
(function (global) {
  "use strict";
  const CONFIG = Object.freeze({
    poem:{title:"古诗",count:5,unit:"首"}, math:{title:"加减法",count:10,unit:"题"},
    decomp:{title:"分解组合",count:10,unit:"题"}, pinyin:{title:"拼音",count:10,unit:"个"},
    write:{title:"汉字",count:5,unit:"个字"}, english:{title:"英语",count:5,unit:"个词"},
  });
  function day(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
  }
  function select(catalog, state, type, mode, today) {
    const config = CONFIG[type];
    if (!config) return null;
    const math = type === "math" || type === "decomp";
    const items = state.items || {};
    let available = catalog.filter(item => item.type === type && !state.hiddenCourses?.[item.id]);
    const unique = new Map(available.map(item=>[item.id,item]));
    available = [...unique.values()];
    const completed = new Set(Object.values(state.garden?.groups || {}).filter(group=>group.day===today).flatMap(group=>group.contentIds || []));
    if (mode === "review") {
      available = available.filter(item=>items[item.id]?.learned);
      const due = available.filter(item=>items[item.id].nextReview && items[item.id].nextReview<=today);
      if (!due.length || available.length < (math ? 1 : config.count)) return null;
      available.sort((a,b)=>{
        const aDue = !!items[a.id].nextReview && items[a.id].nextReview<=today;
        const bDue = !!items[b.id].nextReview && items[b.id].nextReview<=today;
        return Number(bDue)-Number(aDue) || (items[a.id].nextReview || "9999").localeCompare(items[b.id].nextReview || "9999");
      });
      const selected = available.slice(0,math ? 1 : config.count).map(item=>({...item,afterPractice:items[item.id].nextReview>today}));
      return {type,...config,mode,items:selected,dueCount:selected.filter(item=>!item.afterPractice).length};
    }
    // Extension vocabulary is opt-in: only classroom or already enrolled words.
    available = available.filter(item=>type!=="english" || item.source==="classroom" || items[item.id]?.learned);
    if (available.length < (math ? 1 : config.count)) return null;
    available.sort((a,b)=>Number(completed.has(a.id))-Number(completed.has(b.id)) || Number(!!items[b.id]?.learned)-Number(!!items[a.id]?.learned) || Number(b.source==="classroom")-Number(a.source==="classroom"));
    return {type,...config,mode,items:available.slice(0,math ? 1 : config.count),dueCount:0};
  }
  function reviews(catalog,state,today) {
    return Object.keys(CONFIG).map(type=>select(catalog,state,type,"review",today)).filter(Boolean).sort((a,b)=>{
      const first = group=>group.items.map(item=>state.items[item.id]?.nextReview || "9999").sort()[0];
      return first(a).localeCompare(first(b));
    });
  }
  global.ChenchenStudyGroups = {CONFIG,day,select,reviews};
})(typeof window!=="undefined" ? window : globalThis);
