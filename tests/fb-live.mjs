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
//
// Sign-in: the phone starts signed in as Ant unless the fixture says
// `user: null` (a visitor). Signing in is remembered across a reload, like the
// real thing. With `rules: 'locked'` it enforces what firestore.rules says —
// anyone can read the shared data, only Ant and Amy can write, and only they
// can read the private notes and photos. Without it everything is allowed,
// which is how the project was set up before the rules went in.

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

export const ACCOUNTS = {
  'ant@test.example': { password: 'walk-walk', uid: 'uid-ant' },
  'amy@test.example': { password: 'walk-walk', uid: 'uid-amy' },
  'someone@test.example': { password: 'walk-walk', uid: 'uid-someone' }
};
const ALLOWED = ['uid-ant', 'uid-amy'];
const editor = (email) => ({ uid: ACCOUNTS[email].uid, email, isAnonymous: false });

if (!('user' in state)) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('__fb_user') || 'null'); } catch (e) { /* none */ }
  const fx = window.__fixture || {};
  state.user = saved || ('user' in fx ? fx.user : editor('ant@test.example'));
  state.authSubs = [];
}
const locked = () => (window.__fixture || {}).rules === 'locked';
const isUs = () => !!state.user && ALLOWED.includes(state.user.uid);
const isPrivate = (path) => /\/private\//.test(path);
function denied() { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; }
function canWrite() { if (locked() && !isUs()) throw denied(); }
const canRead = (path) => !(locked() && isPrivate(path) && !isUs());

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
  } else if (/challengePrivate$/.test(path)) {
    Object.entries(fx.private || {}).forEach(([id, d]) => m.set(id, { ...d }));
  }
  state.cols[path] = m;
  return m;
}

const snapDoc = (ref) => {
  const m = seed(ref.col);
  const data = m.get(ref.id);
  return { id: ref.id, ref, exists: () => data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
};

// Like the real thing: a collection listener hears every change in it, a
// document listener only changes to its own document.
function fire(path, ids) {
  state.subs.forEach((s) => {
    if (s.path !== path) return;
    if (s.id == null) s.cb(snapCol(path));
    else if (!ids || ids.has(s.id)) s.cb(snapDoc({ col: path, id: s.id }));
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

const DELETE = { __deleteField: true };
const dropDeleted = (o) => { Object.keys(o).forEach((k) => { if (o[k] && o[k].__deleteField) delete o[k]; }); return o; };

function write(ref, data, mode) {
  const m = seed(ref.col);
  if (mode === 'delete') m.delete(ref.id);
  else if (mode === 'update') {
    if (!m.has(ref.id)) throw new Error('No document to update: ' + ref.col + '/' + ref.id);
    m.set(ref.id, dropDeleted({ ...m.get(ref.id), ...data }));
  } else if (mode === 'merge') m.set(ref.id, dropDeleted({ ...(m.get(ref.id) || {}), ...data }));
  else m.set(ref.id, dropDeleted({ ...data }));
  state.writes.push({ mode, path: ref.col, id: ref.id, data });
}

// --- app / auth / storage --------------------------------------------------
export const initializeApp = () => ({});
const authObj = { get currentUser() { return state.user; }, authStateReady: async () => {} };
export const getAuth = () => authObj;
function setUser(u, { remember = true } = {}) {
  state.user = u;
  if (remember) { try { localStorage.setItem('__fb_user', JSON.stringify(u)); } catch (e) { /* ignore */ } }
  state.authSubs.forEach((cb) => cb(u));
}
export const signInAnonymously = async () => {
  if ((window.__fixture || {}).anonymousOff) { const e = new Error('admin-restricted-operation'); e.code = 'auth/admin-restricted-operation'; throw e; }
  setUser({ uid: 'anon-' + (++state.seq), isAnonymous: true }, { remember: false }); return { user: state.user };
};
export const signInWithCustomToken = async () => ({ user: state.user });
export async function signInWithEmailAndPassword(_auth, email, password) {
  const a = ACCOUNTS[String(email).trim().toLowerCase()];
  if (state.authFailNext) { const e = state.authFailNext; state.authFailNext = null; throw e; }
  if (!a || a.password !== password) { const e = new Error('Firebase: Error (auth/invalid-credential).'); e.code = 'auth/invalid-credential'; throw e; }
  setUser(editor(String(email).trim().toLowerCase()));
  return { user: state.user };
}
export async function signOut() { setUser(null); }
export function onAuthStateChanged(_auth, cb) {
  state.authSubs.push(cb);
  setTimeout(() => cb(state.user), 0);
  return () => { state.authSubs = state.authSubs.filter((c) => c !== cb); };
}
export const getStorage = () => ({});
export const ref = (_s, path) => ({ fullPath: path });
export const uploadBytes = async () => { canWrite(); return {}; };
export const getDownloadURL = async (r) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#ccc"/></svg>`);
export const deleteObject = async () => { canWrite(); };

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
export const deleteField = () => DELETE;
export const getDoc = async (r) => { if (!canRead(r.col)) throw denied(); return snapDoc(r); };
export const setDoc = async (r, data, opts) => { maybeFail(); canWrite(); write(r, data, opts && opts.merge ? 'merge' : 'set'); fire(r.col, new Set([r.id])); };
export const updateDoc = async (r, data) => { maybeFail(); canWrite(); write(r, data, 'update'); fire(r.col, new Set([r.id])); };
export const deleteDoc = async (r) => { maybeFail(); canWrite(); write(r, null, 'delete'); fire(r.col, new Set([r.id])); };

// All or nothing, like the real batch: nothing is written if any of it is refused.
export function writeBatch() {
  const ops = [];
  const b = {
    set: (r, d, opts) => { ops.push([r, d, opts && opts.merge ? 'merge' : 'set']); return b; },
    update: (r, d) => { ops.push([r, d, 'update']); return b; },
    delete: (r) => { ops.push([r, null, 'delete']); return b; },
    commit: async () => {
      maybeFail(); canWrite();
      const touched = new Map();
      ops.forEach(([r, d, mode]) => { write(r, d, mode); if (!touched.has(r.col)) touched.set(r.col, new Set()); touched.get(r.col).add(r.id); });
      touched.forEach((ids, col) => fire(col, ids));
    }
  };
  return b;
}

export async function runTransaction(_db, fn) {
  maybeFail(); canWrite();
  const ops = [];
  const t = {
    get: async (r) => snapDoc(r),
    set: (r, d) => { ops.push([r, d, 'set']); return t; },
    update: (r, d) => { ops.push([r, d, 'update']); return t; },
    delete: (r) => { ops.push([r, null, 'delete']); return t; }
  };
  const result = await fn(t);
  const touched = new Map();
  ops.forEach(([r, d, mode]) => { write(r, d, mode); if (!touched.has(r.col)) touched.set(r.col, new Set()); touched.get(r.col).add(r.id); });
  touched.forEach((ids, col) => fire(col, ids));
  return result;
}

export function onSnapshot(target, cb, onError) {
  const sub = target.__col ? { path: target.__col, id: null, cb } : { path: target.col, id: target.id, cb };
  // A refused listener reports once and never delivers, as in the real thing.
  if (!canRead(sub.path)) { setTimeout(() => onError && onError(denied()), 5); return () => {}; }
  state.subs.push(sub);
  // First delivery is async, as in the real thing.
  setTimeout(() => {
    if (!state.subs.includes(sub)) return;
    if (sub.id == null) cb(snapCol(sub.path));
    else cb(snapDoc({ col: sub.path, id: sub.id }));
  }, 5);
  return () => { state.subs = state.subs.filter((s) => s !== sub); };
}
