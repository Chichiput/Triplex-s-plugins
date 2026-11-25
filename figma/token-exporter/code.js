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

// Read quoted spreadsheet cells, including escaped quotes and embedded newlines.
function parseTable(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const header = text.split('\n')[0].replace(/"(?:[^"]|"")*"/g, '');
  const delimiter = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === undefined) throw new Error('В таблице есть незакрытая кавычка.');
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (ch === delimiter || ch === '\n' || ch === undefined) {
      row.push(cell.trim());
      cell = '';
      closed = false;
      if (ch !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (closed || ch === '"') throw new Error('Проверь кавычки в таблице.');
    else cell += ch;
  }
  return rows;
}

function importComponentTable(header, rows) {
  const modes = [];
  const root = group();
  for (let i = 3; i < header.length; i++) {
    if (header[i]) modes.push({ name: header[i], column: i });
  }
  if (!modes.length) throw new Error('Укажи хотя бы один режим после type.');
  for (const mode of modes) {
    mode.section = modes.length === 1 ? root : insert(root, mode.name, group());
  }
  for (const [index, row] of rows.entries()) {
    const [component, property, type] = row;
    if (!component || !property || !['ref', 'value'].includes((type || '').toLowerCase()) ||
        !modes.some(mode => row[mode.column])) {
      throw new Error('Проверь компонент, свойство, тип и значения в строке ' + (index + 2));
    }
    for (const mode of modes) {
      const value = row[mode.column];
      if (!value) continue;
      const leaf = type.toLowerCase() === 'ref' ? { ref: value } : { Value: value };
      writeToken(mode.section, component + '/' + property, leaf);
    }
  }
  return root;
}

function parseCollection(text) {
  const [header, ...rows] = parseTable(text);
  if (!header || header.length < 2 || !rows.length)
    throw new Error('Нужны заголовки и хотя бы одна строка с токеном и значением.');
  if (header.slice(0, 3).map(key => key.toLowerCase()).join(',') === 'component,property,type') {
    return importComponentTable(header, rows);
  }
  const modes = header.slice(1);
  if (modes.some(mode => !mode) || new Set(modes).size !== modes.length)
    throw new Error('Укажи уникальное название каждого столбца значений.');
  const root = group();
  const sections = modes.map(mode => modes.length === 1 ? root : insert(root, mode, group()));
  for (const [index, row] of rows.entries()) {
    if (row.length !== header.length || row[0].split('/').some(part => !part.trim()) || !row.slice(1).some(Boolean))
      throw new Error('Проверь путь, значения и количество ячеек в строке ' + (index + 2));
    row.slice(1).forEach((value, i) => {
      if (!value) return;
      const ref = /^\{(.+)\}$/.exec(value);
      const literal = /^(?:true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?)$/.test(value) ? JSON.parse(value) : value;
      writeToken(sections[i], row[0], ref ? { ref: ref[1] } : { Value: literal });
    });
  }
  return root;
}

let architecture;
let importedComponents;
figma.showUI(__html__, { width: 520, height: 590 });
figma.ui.onmessage = async message => {
  if (!message) return;
  if (message.type === 'import' && architecture) {
    try {
      if (!importedComponents && owns(architecture, 'Components'))
        throw new Error('В файле Figma уже есть коллекция Components.');
      importedComponents = parseCollection(message.text);
      architecture.Components = importedComponents;
      figma.ui.postMessage({ json: JSON.stringify(architecture, null, 2), added: 'Components' });
    } catch (error) {
      figma.ui.postMessage({ importError: error.message });
    }
    return;
  }
  if (message.type !== 'scan') return;
  figma.ui.postMessage({ status: "Читаю переменные файла…" });
  try {
    const fresh = await exportTokens(figma.variables);
    if (importedComponents) insert(fresh, 'Components', importedComponents);
    architecture = fresh;
    figma.ui.postMessage({ json: JSON.stringify(architecture, null, 2) });
  } catch (error) {
    figma.ui.postMessage({ error: error.message || String(error) });
  }
};
