// Pruebas del modelo construido desde la captura real del tablero #3 (sin red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { construirModelo, normalizarConfig, validarConfig, dependenciasFueraDelTablero, serializarDataJs } from '../scripts/lib/modelo.mjs';
import { calcularColumnas, sumarDias, fechaEnZona } from '../scripts/lib/columnas.mjs';
import { colorPorIndice, PALETA } from '../scripts/lib/colores.mjs';

const captura = JSON.parse(readFileSync(new URL('./fixtures/tablero-3.json', import.meta.url), 'utf8'));
const configCruda = JSON.parse(readFileSync(new URL('../heimdallr.config.json', import.meta.url), 'utf8'));
const config = normalizarConfig(configCruda);

const construir = (extra = {}) =>
  construirModelo({
    itemList: captura.itemList,
    fieldList: captura.fieldList,
    proyectoGraphql: captura.proyectoGraphql,
    config,
    externos: captura.issuesExternos,
    hoy: captura.hoy,
    generado: '2026-11-17T00:00:00Z',
    ...extra,
  });

const modelo = construir();
const enTablero = modelo.tarjetas.filter((t) => !t.fueraDelTablero);
const contar = (f) => enTablero.reduce((m, t) => ((m[f(t)] = (m[f(t)] || 0) + 1), m), {});

test('la captura no guarda más que la sección «Depende de» de cada cuerpo', () => {
  for (const it of captura.itemList.items) {
    const b = it.content.body;
    assert.ok(b === '' || /^## Depende de/.test(b), `#${it.content.number} tiene cuerpo sin recortar`);
    assert.ok(!/\n---/.test(b), `#${it.content.number} conserva el pie`);
  }
});

test('116 tarjetas, todas issues, con el esquema y la fuente', () => {
  assert.equal(modelo.esquema, 1);
  assert.equal(enTablero.length, 116);
  assert.deepEqual(modelo.fuente, {
    dueno: 'Luis-Ayben-Chahua-Charca',
    proyecto: 3,
    titulo: 'Farmasil Scrum for Planning and Deployment',
    url: 'https://github.com/users/Luis-Ayben-Chahua-Charca/projects/3',
    zonaHoraria: 'America/Lima',
  });
});

test('conteo por estado: 56 Done, 4 In Progress, 56 Todo', () => {
  assert.deepEqual(contar((t) => t.estado), { Done: 56, 'In Progress': 4, Todo: 56 });
  assert.deepEqual(modelo.estados, ['Todo', 'In Progress', 'Done']);
});

test('72 issues con sección «Depende de»; 71 con al menos una dependencia', () => {
  const conSeccion = captura.itemList.items.filter((i) => i.content.body !== '').length;
  assert.equal(conSeccion, 72);
  assert.equal(enTablero.filter((t) => t.dependeDe.length > 0).length, 71);
  // El #142 solo tiene texto libre en su sección.
  assert.deepEqual(enTablero.find((t) => t.id === 142).dependeDe, []);
});

test('#87 depende de #53 y #71', () => {
  const t = enTablero.find((x) => x.id === 87);
  assert.deepEqual(t.dependeDe, [53, 71]);
  assert.equal(t.categoria, 'ALV');
  assert.equal(t.columna, 'S1');
  assert.deepEqual(t.prs, [{ numero: 181, url: 'https://github.com/Luis-Ayben-Chahua-Charca/Farmasil_App/pull/181' }]);
  assert.ok(enTablero.some((x) => x.id === 53) && enTablero.some((x) => x.id === 71));
});

test('columnas: Sprint 1-5 antiguas, S1-S6 por defecto, S2 actual el 17/11', () => {
  const resumen = modelo.columnas.map((c) => [c.id, c.antiguo, c.actual]);
  assert.deepEqual(resumen, [
    ['Sprint 1', true, false],
    ['Sprint 2', true, false],
    ['Sprint 3', true, false],
    ['Sprint 4', true, false],
    ['Sprint 5', true, false],
    ['S1', false, false],
    ['S2', false, true],
    ['S3', false, false],
    ['S4', false, false],
    ['S5', false, false],
    ['S6', false, false],
  ]);
  const s1 = modelo.columnas.find((c) => c.id === 'S1');
  assert.equal(s1.inicio, '2026-11-08');
  assert.equal(s1.fin, '2026-11-14');
  assert.equal(modelo.columnas.find((c) => c.id === 'S6').fin, '2026-12-19');
});

test('conteo por columna', () => {
  assert.deepEqual(contar((t) => t.columna), {
    'Sprint 1': 11,
    'Sprint 2': 10,
    'Sprint 3': 6,
    'Sprint 4': 2,
    'Sprint 5': 2,
    S1: 32,
    S2: 12,
    S3: 13,
    S4: 10,
    S5: 9,
    S6: 9,
  });
});

test('categorías del campo Modulo, en su orden, con nombre de la opción y color fijo', () => {
  assert.deepEqual(Object.keys(modelo.categorias), ['USR', 'PRV', 'INV', 'LOT', 'PAG', 'VEN', 'RES', 'ALV', 'DOC', 'DEV', 'REP', 'REA', 'COT', 'Transversal']);
  assert.deepEqual(modelo.categorias.ALV, { nombre: 'ALV', color: colorPorIndice(7) });
  assert.equal(colorPorIndice(PALETA.length), PALETA[0]);
  assert.deepEqual(construir().categorias, modelo.categorias);
});

test('sin dependencias fuera del tablero ni avisos en modo normal; el modo estricto avisa del #142', () => {
  assert.deepEqual(dependenciasFueraDelTablero(captura.itemList), []);
  assert.equal(modelo.tarjetas.filter((t) => t.fueraDelTablero).length, 0);
  assert.deepEqual(modelo.avisos, []);
  const estricto = construir({ estricto: true });
  assert.equal(estricto.avisos.length, 1);
  assert.match(estricto.avisos[0], /^El issue #142 declara una dependencia con formato no reconocido/);
});

test('el modelo no contiene cuerpos de issue', () => {
  const texto = JSON.stringify(modelo);
  assert.ok(!texto.includes('"body"'));
  assert.ok(!texto.includes('## Depende de'));
  for (const t of modelo.tarjetas) assert.ok(!('cuerpo' in t) && !('body' in t));
});

test('campo configurado inexistente: se avisa por nombre y se sigue', () => {
  const otra = normalizarConfig({ ...configCruda, campos: { ...configCruda.campos, Puntos: 'puntos' } });
  const m = construir({ config: otra });
  assert.ok(m.avisos.includes('El campo «Puntos» configurado (→ puntos) no existe en el tablero; se deja vacío.'));
  assert.equal(m.tarjetas.length, 116);
});

test('estados extra se conservan o se mapean según la configuración', () => {
  const items = structuredClone(captura.itemList);
  items.items[0].status = 'Backlog';
  const sinMapa = construir({ itemList: items });
  assert.ok(sinMapa.estados.includes('Backlog'));
  const conMapa = construir({ itemList: items, config: { ...config, estadosExtra: { Backlog: 'Todo' } } });
  assert.ok(!conMapa.estados.includes('Backlog'));
  assert.equal(conMapa.tarjetas.find((t) => t.id === items.items[0].content.number).estadoOriginal, 'Backlog');
});

test('cálculo de columnas: fin = inicio + duración − 1 y cambio de mes', () => {
  assert.equal(sumarDias('2026-11-29', 6), '2026-12-05');
  const cols = calcularColumnas([{ titulo: 'S9', inicio: '2026-12-27', duracion: 7 }], { hoy: '2027-01-02', patronPorDefecto: '^S\\d+$' });
  assert.deepEqual(cols, [{ id: 'S9', titulo: 'S9', inicio: '2026-12-27', fin: '2027-01-02', actual: true, antiguo: false }]);
});

test('data.js se serializa como window.HEIMDALLR_DATA', () => {
  const js = serializarDataJs(modelo);
  assert.match(js, /^\/\/ .*\nwindow\.HEIMDALLR_DATA = \{/);
  assert.ok(js.trimEnd().endsWith('};'));
  const datos = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1));
  assert.equal(datos.tarjetas.length, 116);
});

test('«hoy» se calcula en la zona horaria configurada, no en la del equipo', () => {
  // 17/11/2026 03:00 UTC es todavía 16/11 en Lima (UTC−5).
  const instante = new Date('2026-11-17T03:00:00Z');
  assert.equal(fechaEnZona(instante, 'America/Lima'), '2026-11-16');
  assert.equal(fechaEnZona(instante, 'UTC'), '2026-11-17');
  assert.equal(normalizarConfig({}).zonaHoraria, 'America/Lima');
  assert.throws(() => fechaEnZona(instante, 'Lima/Peru'), RangeError);
});

test('validarConfig: patrón y zona horaria no válidos', () => {
  assert.deepEqual(validarConfig(config), []);
  const mal = normalizarConfig({ ...configCruda, columnas: { patronPorDefecto: '^S(' }, zonaHoraria: 'Lima/Peru' });
  const errores = validarConfig(mal);
  assert.equal(errores.length, 2);
  assert.match(errores[0], /patronPorDefecto/);
  assert.match(errores[1], /zonaHoraria/);
});
