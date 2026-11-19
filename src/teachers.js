/** Approved Monday people-column IDs. Display names follow current instructor aliases (2026-11-19). */
export const TEACHERS = Object.freeze([
  {name:'OLIVIA',id:62032468},
  {name:'ONYU',id:62421403},
  {name:'ELLIE',id:62032527},
  {name:'DOORI',id:62421627},
  {name:'HANNAH',id:97420822},
  {name:'MINJI',id:66891148},
  {name:'JUNWON',id:98185652},
  {name:'RARA',id:79016580},
  {name:'SEONYE',id:62270353},
  {name:'SELLY',id:62107579},
  {name:'SION',id:62107534},
  {name:'SARAH',id:62107617},
  {name:'ZOEY',id:62107542},
]);
export const teacherById = new Map(TEACHERS.map(t=>[t.id,t]));
export function isAllowedTeacher(id){ return teacherById.has(Number(id)); }

// Monday user names are mutable; instructor identity is the approved account ID.
// The MINJI channel currently uses the unchanged Monday account ID 66891148
// (whose monday.com profile name is still JIMIN).
export function matchesAllowedTeacherAccount(id, actualUsers){
  const approved=teacherById.get(Number(id));
  return Boolean(approved && Array.isArray(actualUsers) && actualUsers.length===1 &&
    String(actualUsers[0]?.id||'')===String(approved.id) &&
    Boolean(String(actualUsers[0]?.name||'').trim()));
}
