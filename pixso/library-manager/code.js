const triplexNames = [
  "[W] LIB-DSN 01 Components DCB Next v.1.50.0",
  "[W] LIB-DSN 02 Components DCB Next v.1.50.0",
  "[M] LIB-DSN 01 Components DCB Next v.4.05.0",
  "[M] LIB-DSN 02 Components DCB Next v.4.05.0",
  "[W] LIB-DSN 03 Components DCB Next v.1.50.0",
  "[W] LIB-DSN+ Product Components Next v.1.50.0",
  "[M] LIB-DSN+ Product components Next v.4.05.0",
  "[S] LIB-COR Styles Infographics DCB Next v.1.1.0",
  "[S] LIB-DSN Infographics DCB Next v.1.2.0",
  "LIB-DSN Icons DCB Next v.1.48.0",
  "LIB-DSN Skeletons DCB Next v.1.1.0",
  "LIB-COR Styles Next v.1.1.0"
];

function normalize(name) {
  return name.trim().replace(/^W\]/i, "[W]").replace(/\s+/g, " ").toLowerCase();
}

const triplex = new Set(triplexNames.map(normalize));
async function within(promise, milliseconds, description) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(description)), milliseconds);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readLibraries() {
  if (typeof pixso.getLibraryListAsync !== "function") {
    throw new Error("Эта версия Pixso не предоставляет список библиотек.");
  }
  const response = await within(pixso.getLibraryListAsync(), 12000, "Pixso не вернул список библиотек за 12 секунд.");
  const items = Array.isArray(response) ? response : [response];
  const libraries = new Map();
  const ownKey = pixso.fileKey;
  for (const item of items) {
    if (!item || typeof item.key !== "string" || !item.key ||
        typeof item.name !== "string" || typeof item.subscribed !== "boolean") {
      throw new Error("Pixso вернул неизвестный формат списка библиотек.");
    }
    if (item.key === ownKey) continue;
    libraries.set(item.key, {
      key: item.key, name: item.name, team: item.teamName || "",
      subscribed: item.subscribed, triplex: triplex.has(normalize(item.name))
    });
  }
  return libraries;
}

let snapshot = new Map();
let busy = false;
let lastRequest = 0;
let initialResult;
let initialLoad;
let linked = false;
function hello(via) {
  pixso.ui.postMessage({ type: "hello", pluginId: pixso.pluginId, via });
}
async function handleMessage(message) {
  if (!message) return;
  if (message.type === "ready") {
    linked = true;
    hello(message.via);
    if (!lastRequest && initialResult) pixso.ui.postMessage(initialResult);
    return;
  }
  if (!["scan", "apply"].includes(message.type) || !Number.isSafeInteger(message.id) || message.id <= lastRequest) return;
  lastRequest = message.id;
  const reply = data => pixso.ui.postMessage({ ...data, id: message.id });
  if (busy) {
    reply({ type: "error", detail: "Предыдущая операция ещё выполняется." });
    return;
  }
  busy = true;
  try {
    reply({ type: "progress" });
    let current = initialLoad ? await initialLoad : await readLibraries();
    const errors = [];
    if (message.type === "apply") {
      for (const { key, target } of message.changes) {
        const original = snapshot.get(key);
        if (!original || typeof target !== "boolean" || original.subscribed === target) continue;
        const library = current.get(key);
        if (!library || library.name !== original.name) {
          errors.push(original.name + " — библиотека исчезла или переименована.");
          continue;
        }
        if (library.subscribed === target) continue;
        try {
          reply({ type: "progress", library: library.name });
          const operation = target ? pixso.subscribeLibraryAsync(key) : pixso.unsubscribeLibraryAsync(key);
          await within(operation, 15000, "Pixso не подтвердил изменение за 15 секунд.");
        } catch (error) {
          errors.push(library.name + " — " + (error.message || String(error)));
        }
      }
      current = await readLibraries();
    }
    snapshot = current;
    reply({ type: message.type, libraries: Array.from(current.values()), errors });
  } catch (error) {
    reply({ type: "error", detail: error.message || String(error) });
  } finally {
    busy = false;
  }
}

pixso.ui.onmessage = handleMessage;
pixso.showUI(__html__, { width: 520, height: 580 });
pixso.ui.onmessage = handleMessage;
if (typeof pixso.ui.on === "function") pixso.ui.on("message", handleMessage);
// Read on startup, as in the local Pixso example. Replay if the UI loaded later.
initialLoad = readLibraries();
initialLoad.then(libraries => {
  snapshot = libraries;
  initialResult = { type: "initial", libraries: Array.from(libraries.values()), errors: [] };
}, error => {
  initialResult = { type: "initial", detail: error.message || String(error) };
}).then(() => {
  initialLoad = null;
  if (!lastRequest) pixso.ui.postMessage(initialResult);
});
function announce(attempt) {
  if (linked) return;
  hello();
  if (initialResult && !lastRequest) pixso.ui.postMessage(initialResult);
  if (attempt < 4) setTimeout(() => announce(attempt + 1), 400 * (attempt + 1));
}
announce(0);
