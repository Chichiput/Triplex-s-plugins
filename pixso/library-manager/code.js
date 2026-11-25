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
async function readLibraries() {
  const response = await pixso.getLibraryListAsync();
  const items = Array.isArray(response) ? response : [response];
  const libraries = new Map();
  for (const item of items) {
    if (!item || typeof item.key !== "string" || !item.key ||
        typeof item.name !== "string" || typeof item.subscribed !== "boolean") {
      throw new Error("Pixso вернул неизвестный формат списка библиотек.");
    }
    if (item.key === pixso.fileKey) continue;
    libraries.set(item.key, {
      key: item.key, name: item.name, team: item.teamName || "",
      subscribed: item.subscribed, triplex: triplex.has(normalize(item.name))
    });
  }
  return libraries;
}

let snapshot = new Map();
let busy = false;
pixso.showUI(__html__, { width: 520, height: 580 });
pixso.ui.onmessage = async (message) => {
  if (busy || !message || !["scan", "apply"].includes(message.type)) return;
  busy = true;
  try {
    let current = await readLibraries();
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
          if (target) await pixso.subscribeLibraryAsync(key);
          else await pixso.unsubscribeLibraryAsync(key);
        } catch (error) {
          errors.push(library.name + " — " + (error.message || String(error)));
        }
      }
      current = await readLibraries();
    }
    snapshot = current;
    pixso.ui.postMessage({ type: message.type, libraries: Array.from(current.values()), errors });
  } catch (error) {
    pixso.ui.postMessage({ type: "error", detail: error.message || String(error) });
  } finally {
    busy = false;
  }
};
