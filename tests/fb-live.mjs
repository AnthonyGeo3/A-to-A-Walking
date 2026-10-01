// A stand-in for the four Firebase modules the app imports (app, auth,
// firestore, storage). Every one of those URLs is answered with this file, so
// it only has to export the right names.
//
// Unlike a canned stub it actually holds the data: a log added through the form
// lands in the collection and every listener fires again, which is the chain
// most of the app's behaviour hangs off. Writes fire listeners synchronously —
// the worst-case ordering real Firestore can produce, so races show up here
// rather than on a phone.
//
// The fixture comes from window.__fixture, set by tests/boot.mjs before the page
// loads. State lives on window.__fb so all four module instances share it and
// tests can read what was written.

const ts = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  return { toDate: () => new Date(date), toMillis: () => date.getTime(), seconds: Math.floor(date.getTime() / 1000), __ts: true };
};

const state = (window.__fb = window.__fb || {
  cols: {},          // path -> Map(id -> data)
  subs: [],          // { path, id|null, cb }
  writes: [],        // every write, for assertions
  seq: 0,
  failNext: null     // set to an Error to make the next write throw
});

function revive(data) {
  const out = { ...data };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === 'string' && k === 'date') out[k] = ts(v);
  }
  return out;
}

function seed(path) {
  if (state.cols[path]) return state.cols[path];
  const fx = window.__fixture || {};
  const m = new Map();
  if (/challengeLogs$/.test(path)) {
    (fx.logs || []).forEach((l) => m.set(l.id, revive(l)));
  } else if (/challengeData$/.test(path)) {
    const users = fx.users || {};
    const sum = (uid) => (fx.logs || []).filter((l) => l.userId === uid).reduce((a, l) => a + (l.steps || 0), 0);
    m.set('user1', { name: 'Ant', steps: sum('user1'), ...(users.user1 || {}) });
    m.set('user2', { name: 'Amy', steps: sum('user2'), ...(users.user2 || {}) });
    Object.entries(fx.docs || {}).forEach(([id, d]) => m.set(id, { ...d }));
  }
  state.cols[path] = m;
  return m;
}

const snapDoc = (ref) => {
  const m = seed(ref.col);
  const data = m.get(ref.id);
  return { id: ref.id, ref, exists: () => data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
};

function fire(path) {
  state.subs.forEach((s) => {
    if (s.path !== path) return;
    if (s.id == null) s.cb(snapCol(path));
    else s.cb(snapDoc({ col: path, id: s.id }));
  });
}

function snapCol(path) {
  const m = seed(path);
  let docs = [...m.entries()].map(([id, data]) => ({ id, data: () => ({ ...data }) }));
  // The app queries logs with orderBy('date', 'desc'); keep that order.
  if (/challengeLogs$/.test(path)) {
    docs.sort((a, b) => {
      const da = a.data().date, db = b.data().date;
      return (db ? db.toMillis() : 0) - (da ? da.toMillis() : 0);
    });
  }
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (f) => docs.forEach(f) };
}

function maybeFail() {
  if (state.failNext) { const e = state.failNext; state.failNext = null; throw e; }
}

function write(ref, data, mode) {
  const m = seed(ref.col);
  if (mode === 'delete') m.delete(ref.id);
  else if (mode === 'update') {
    if (!m.has(ref.id)) throw new Error('No document to update: ' + ref.col + '/' + ref.id);
    m.set(ref.id, { ...m.get(ref.id), ...data });
  } else if (mode === 'merge') m.set(ref.id, { ...(m.get(ref.id) || {}), ...data });
  else m.set(ref.id, { ...data });
  state.writes.push({ mode, path: ref.col, id: ref.id, data });
}

// --- app / auth / storage --------------------------------------------------
export const initializeApp = () => ({});
export const getAuth = () => ({ currentUser: { uid: 'test' } });
export const signInAnonymously = async () => ({ user: { uid: 'test' } });
export const signInWithCustomToken = async () => ({ user: { uid: 'test' } });
export const getStorage = () => ({});
export const ref = (_s, path) => ({ fullPath: path });
export const uploadBytes = async () => ({});
export const getDownloadURL = async (r) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#ccc"/></svg>`);
export const deleteObject = async () => {};

// --- firestore -------------------------------------------------------------
export const getFirestore = () => ({});
export const Timestamp = { fromDate: (d) => ts(d), now: () => ts(new Date()) };
export const collection = (_db, ...segs) => ({ __col: segs.join('/') });
export const query = (c) => c;
export const orderBy = () => ({});
export function doc(parent, ...segs) {
  const col = parent.__col;
  const id = segs.length ? segs.join('/') : 'auto-' + (++state.seq);
  return { col, id };
}
export const getDoc = async (r) => snapDoc(r);
export const setDoc = async (r, data, opts) => { maybeFail(); write(r, data, opts && opts.merge ? 'merge' : 'set'); fire(r.col); };
export const updateDoc = async (r, data) => { maybeFail(); write(r, data, 'update'); fire(r.col); };
export const deleteDoc = async (r) => { maybeFail(); write(r, null, 'delete'); fire(r.col); };

export async function runTransaction(_db, fn) {
  maybeFail();
  const ops = [];
  const t = {
    get: async (r) => snapDoc(r),
    set: (r, d) => { ops.push([r, d, 'set']); return t; },
    update: (r, d) => { ops.push([r, d, 'update']); return t; },
    delete: (r) => { ops.push([r, null, 'delete']); return t; }
  };
  const result = await fn(t);
  const touched = new Set();
  ops.forEach(([r, d, mode]) => { write(r, d, mode); touched.add(r.col); });
  touched.forEach(fire);
  return result;
}

export function onSnapshot(target, cb) {
  const sub = target.__col ? { path: target.__col, id: null, cb } : { path: target.col, id: target.id, cb };
  state.subs.push(sub);
  // First delivery is async, as in the real thing.
  setTimeout(() => {
    if (sub.id == null) cb(snapCol(sub.path));
    else cb(snapDoc({ col: sub.path, id: sub.id }));
  }, 5);
  return () => { state.subs = state.subs.filter((s) => s !== sub); };
}
