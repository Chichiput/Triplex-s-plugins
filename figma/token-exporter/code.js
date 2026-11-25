const group = () => Object.create(null);
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function insert(object, key, value) {
  if (owns(object, key)) throw new Error('Совпадают имена в одном разделе: ' + key);
  object[key] = value;
  return value;
}

function writeToken(root, name, leaf) {
  const path = name.split('/');
  const last = path.pop();
  let parent = root;
  for (const folder of path) {
    if (!owns(parent, folder)) parent[folder] = group();
    parent = parent[folder];
    if (Object.getPrototypeOf(parent) !== null) {
      throw new Error('Имя токена совпадает с путём папки: ' + name);
    }
  }
  insert(parent, last, leaf);
}

function toHex(color) {
  const channels = [color.r, color.g, color.b];
  if (color.a !== undefined && color.a < 1) channels.push(color.a);
  return '#' + channels.map(x => ('0' + Math.round(x * 255).toString(16)).slice(-2)).join('').toUpperCase();
}

async function exportTokens(api) {
  const [collections, variables] = await Promise.all([
    api.getLocalVariableCollectionsAsync(), api.getLocalVariablesAsync()
  ]);
  const byId = new Map(variables.map(v => [v.id, v]));
  const byCollection = new Map(collections.map(c => [c.id, c]));
  const result = group();

  async function tokenValue(value, type) {
    if (value && value.type === 'VARIABLE_ALIAS') {
      if (!byId.has(value.id)) byId.set(value.id, await api.getVariableByIdAsync(value.id));
      const target = byId.get(value.id);
      if (!target) throw new Error('Недоступен токен по ссылке ' + value.id);
      const id = target.variableCollectionId;
      if (!byCollection.has(id)) byCollection.set(id, await api.getVariableCollectionByIdAsync(id));
      const collection = byCollection.get(id);
      if (!collection) throw new Error('Недоступна коллекция токена ' + target.name);
      return { ref: collection.name + '/' + target.name };
    }
    return { Value: type === 'COLOR' ? toHex(value) : value };
  }

  for (const collection of collections) {
    const root = insert(result, collection.name, group());
    for (const mode of collection.modes) {
      const section = collection.modes.length === 1 ? root : insert(root, mode.name, group());
      for (const id of collection.variableIds) {
        const variable = byId.get(id);
        if (!variable) throw new Error('Недоступна переменная ' + id);
        const value = variable.valuesByMode[mode.modeId];
        if (value !== undefined) writeToken(section, variable.name, await tokenValue(value, variable.resolvedType));
      }
    }
  }
  return result;
}

async function run() {
  figma.showUI(__html__, { width: 460, height: 380 });
  try {
    const result = await exportTokens(figma.variables);
    figma.ui.postMessage({ json: JSON.stringify(result, null, 2) });
  } catch (error) {
    figma.ui.postMessage({ error: error.message || String(error) });
  }
}
run();
