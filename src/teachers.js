/** Confirmed monday.com people-column identities, 2026-10-31. */
export const TEACHERS = Object.freeze([
  {name:'OLIVIA',id:62032468},
  {name:'ONYU',id:62421403},
  {name:'AYEONG',id:62032527},
  {name:'DOORI',id:62421627},
  {name:'HANNAH',id:97420822},
  {name:'JIMIN',id:66891148},
  {name:'JUNWON',id:98185652},
  {name:'RARA',id:79016580},
  {name:'SEONYE',id:62270353},
  {name:'SHU',id:62107579},
  {name:'SION',id:62107534},
  {name:'SYEON',id:62107617},
  {name:'ZOEY',id:62107542},
]);
export const teacherById = new Map(TEACHERS.map(t=>[t.id,t]));
export function isAllowedTeacher(id){ return teacherById.has(Number(id)); }
