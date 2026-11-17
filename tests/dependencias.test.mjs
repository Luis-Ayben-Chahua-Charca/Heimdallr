// Pruebas del lector de «Depende de» y de las validaciones de dependencias.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leerDependencias, extraerSeccion, recortarCuerpo } from '../scripts/lib/dependencias.mjs';
import { detectarCiclos } from '../scripts/lib/ciclos.mjs';
import { construirModelo, normalizarConfig } from '../scripts/lib/modelo.mjs';

const PIE = '---\r\nRol: R7 Alertas y procesos · Sprint: S1 · Estimación: 1 días\r\n';

test('una dependencia «- #53»', () => {
  const r = leerDependencias('## Depende de\n\n- #53\n');
  assert.deepEqual(r, { tieneSeccion: true, numeros: [53], lineasNoReconocidas: [] });
});

test('varias líneas, en orden y sin repetir', () => {
  const r = leerDependencias('## Depende de\n\n- #53\n- #71\n- #53\n- #9\n');
  assert.deepEqual(r.numeros, [53, 71, 9]);
});

test('sección ausente', () => {
  const r = leerDependencias('## Objetivo\n\nAlgo.\n\n## Criterios\n- [ ] x\n');
  assert.equal(r.tieneSeccion, false);
  assert.deepEqual(r.numeros, []);
  assert.deepEqual(leerDependencias('').numeros, []);
  assert.deepEqual(leerDependencias(undefined).numeros, []);
});

test('cuerpo real con \\r\\n: termina en «---» y no lee el pie', () => {
  const cuerpo = '## Objetivo\r\n\r\nImplementar.\r\n\r\n## Depende de\r\n\r\n- #53\r\n- #71\r\n\r\n' + PIE + '- #99\r\n';
  const r = leerDependencias(cuerpo);
  assert.deepEqual(r.numeros, [53, 71]);
  assert.deepEqual(r.lineasNoReconocidas, []);
});

test('la sección termina en el siguiente encabezado «## »', () => {
  const r = leerDependencias('## Depende de\n- #1\n## Notas\n- #2\n');
  assert.deepEqual(r.numeros, [1]);
});

test('texto libre se ignora fuera del modo estricto', () => {
  const cuerpo = '## Depende de\r\n\r\n- Corregir el diccionario de datos y el catálogo según la auditoría\r\n- #10\r\n\r\n' + PIE;
  const r = leerDependencias(cuerpo);
  assert.deepEqual(r.numeros, [10]);
  assert.deepEqual(r.lineasNoReconocidas, []);
});

test('modo estricto: avisa de las líneas con otro formato', () => {
  const cuerpo = '## Depende de\n\n- Corregir el diccionario\n- #10\n* #11\n- #12 y algo más\n\n---\n';
  const r = leerDependencias(cuerpo, { estricto: true });
  assert.deepEqual(r.numeros, [10, 11]);
  assert.deepEqual(r.lineasNoReconocidas, ['- Corregir el diccionario', '- #12 y algo más']);
});

test('fuera del modo estricto avisa solo de líneas que parecen referencias', () => {
  const r = leerDependencias('## Depende de\n- #12, #13\n- texto\n');
  assert.deepEqual(r.numeros, []);
  assert.deepEqual(r.lineasNoReconocidas, ['- #12, #13']);
});

test('la sección termina en cualquier encabezado y en ***, ___ o ---', () => {
  assert.deepEqual(leerDependencias('## Depende de\n- #1\n# Otro\n- #2\n').numeros, [1]);
  assert.deepEqual(leerDependencias('## Depende de\n- #1\n### Notas\n- #2\n').numeros, [1]);
  assert.deepEqual(leerDependencias('## Depende de\n- #1\n***\n- #2\n').numeros, [1]);
  assert.deepEqual(leerDependencias('## Depende de\n- #1\n___\n- #2\n').numeros, [1]);
  assert.deepEqual(leerDependencias('## Depende de\n- #1\n- - -\n- #2\n').numeros, [1]);
  // «#53» sin espacio no es un encabezado: no corta la sección.
  assert.deepEqual(leerDependencias('## Depende de\n#53\n- #2\n').numeros, [2]);
});

test('encabezado tolerante: mayúsculas, espacios múltiples, «:» y «##» de cierre', () => {
  for (const enc of ['## depende de', '##   Depende   de', '## DEPENDE DE:', '## Depende de ##', '## Depende  de  #', '  ## Depende de  ']) {
    assert.deepEqual(leerDependencias(`${enc}\r\n- #4\r\n`).numeros, [4], enc);
  }
  assert.equal(leerDependencias('## Dependencias\n- #4\n').tieneSeccion, false);
  assert.equal(leerDependencias('### Depende de\n- #4\n').tieneSeccion, false);
});

test('dependencias mal escritas: aviso también fuera del modo estricto, sin convertirlas', () => {
  const cuerpo = '## Depende de\n- # 53\n- https://github.com/duena/repo/issues/54\n- https://github.com/duena/repo/pull/55\n-#56\n- #57\n';
  const r = leerDependencias(cuerpo);
  assert.deepEqual(r.numeros, [57]);
  assert.deepEqual(r.lineasNoReconocidas, ['- # 53', '- https://github.com/duena/repo/issues/54', '- https://github.com/duena/repo/pull/55', '-#56']);
});

test('extraerSeccion y recortarCuerpo conservan solo la sección', () => {
  const cuerpo = '## Objetivo\r\nx\r\n## Depende de\r\n\r\n- #53\r\n\r\n' + PIE;
  assert.deepEqual(extraerSeccion(cuerpo), ['', '- #53', '']);
  assert.equal(recortarCuerpo(cuerpo), '## Depende de\r\n\r\n- #53\r\n\r\n');
  assert.equal(recortarCuerpo('## Objetivo\nnada'), '');
});

test('detectarCiclos: ciclo, autociclo y grafo sin ciclos', () => {
  const g = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a']],
    ['d', ['d']],
    ['e', ['a', 'x']], // «x» no es nodo del grafo: se ignora
  ]);
  assert.deepEqual(detectarCiclos(g), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(detectarCiclos(new Map([['a', ['b']], ['b', []]])), []);
});

// --- Validaciones dentro del modelo (sin red) ---

const REPO = 'duena/repo';
const item = (numero, cuerpo, extra = {}) => ({
  id: `PVTI_${numero}`,
  title: `Issue ${numero}`,
  status: 'Todo',
  sprint: { title: 'S1', startDate: '2026-11-08', duration: 7, iterationId: 'x1' },
  content: { type: 'Issue', number: numero, title: `Issue ${numero}`, url: `https://github.com/${REPO}/issues/${numero}`, repository: REPO, body: cuerpo },
  ...extra,
});
const fieldList = {
  fields: [
    { name: 'Status', type: 'ProjectV2SingleSelectField', options: [{ name: 'Todo' }, { name: 'In Progress' }, { name: 'Done' }] },
    { name: 'Sprint', type: 'ProjectV2IterationField' },
  ],
};
const config = normalizarConfig({ dueno: 'duena', proyecto: 1, campos: { Status: 'estado', Sprint: 'columna' }, columnas: { patronPorDefecto: '^S\\d+$' } });
const construir = (items, externos = {}, extra = {}) =>
  construirModelo({ itemList: { items }, fieldList, config, externos, hoy: '2026-11-10', generado: '2026-11-10T00:00:00Z', ...extra });

test('referencia a un issue inexistente: aviso y se descarta', () => {
  const m = construir([item(1, '## Depende de\n- #2\n- #999\n'), item(2, '')], { [`${REPO}#999`]: null });
  const t1 = m.tarjetas.find((t) => t.id === 1);
  assert.deepEqual(t1.dependeDe, [2]);
  assert.ok(m.avisos.some((a) => a.includes('#999') && a.includes('no existe')));
});

test('referencia a un issue fuera del tablero: nodo con estado Open/Closed', () => {
  const m = construir([item(1, '## Depende de\n- #50\n- #51\n')], {
    [`${REPO}#50`]: { number: 50, title: 'Fuera', state: 'CLOSED', url: 'u50' },
    [`${REPO}#51`]: { number: 51, title: 'Abierto', state: 'OPEN', url: 'u51' },
  });
  const fuera = m.tarjetas.filter((t) => t.fueraDelTablero);
  assert.deepEqual(fuera.map((t) => [t.id, t.estado]), [[50, 'Closed'], [51, 'Open']]);
  assert.deepEqual(m.tarjetas.find((t) => t.id === 1).dependeDe, [50, 51]);
});

test('dependencia fuera del tablero que no se pudo consultar: se conserva y se avisa', () => {
  // `undefined` en externos = fallo de red o de límite (no un «no existe» confirmado).
  const m = construir([item(1, '## Depende de\n- #60\n')], { [`${REPO}#60`]: undefined });
  assert.deepEqual(m.tarjetas.find((t) => t.id === 1).dependeDe, [60]);
  assert.equal(m.tarjetas.some((t) => t.id === 60), false); // sin nodo: la página lo trata como no terminado
  assert.ok(m.avisos.some((a) => a.includes('#60') && a.includes('no se pudo consultar')));
  const sinEntrada = construir([item(1, '## Depende de\n- #61\n')]);
  assert.deepEqual(sinEntrada.tarjetas[0].dependeDe, [61]);
});

test('un PR fusionado (state MERGED) fuera del tablero cuenta como Closed', () => {
  const m = construir([item(1, '## Depende de\n- #70\n')], { [`${REPO}#70`]: { number: 70, title: 'PR', state: 'MERGED', url: 'u70' } });
  assert.equal(m.tarjetas.find((t) => t.id === 70).estado, 'Closed');
});

test('ciclo entre tarjetas: aviso y marca enCiclo, sin romper el modelo', () => {
  const m = construir([item(1, '## Depende de\n- #2\n'), item(2, '## Depende de\n- #3\n'), item(3, '## Depende de\n- #1\n'), item(4, '## Depende de\n- #1\n')]);
  assert.deepEqual(m.tarjetas.filter((t) => t.enCiclo).map((t) => t.id), [1, 2, 3]);
  assert.ok(m.avisos.includes('Referencia circular entre los issues #1, #2, #3.'));
  assert.deepEqual(m.tarjetas.find((t) => t.id === 4).dependeDe, [1]);
});

test('modo estricto en el modelo: avisa con el número del issue', () => {
  const m = construir([item(7, '## Depende de\n- Corregir algo\n')], {}, { estricto: true });
  assert.deepEqual(m.avisos, ['El issue #7 declara una dependencia con formato no reconocido: «- Corregir algo»']);
});

test('tarjeta sin sprint: columna «Sin sprint» y aviso', () => {
  const sinSprint = item(5, '');
  delete sinSprint.sprint;
  const m = construir([item(1, ''), sinSprint]);
  assert.equal(m.tarjetas.find((t) => t.id === 5).columna, 'sin-sprint');
  assert.equal(m.columnas.at(-1).titulo, 'Sin sprint');
  assert.ok(m.avisos.some((a) => a.includes('sin sprint') && a.includes('#5')));
});
