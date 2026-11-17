// Pruebas de seguridad: el código de scripts/ es de solo lectura y los archivos
// generados no contienen tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { construirModelo, normalizarConfig, serializarDataJs } from '../scripts/lib/modelo.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function archivosDe(dir) {
  return readdirSync(dir).flatMap((f) => {
    const ruta = path.join(dir, f);
    return statSync(ruta).isDirectory() ? archivosDe(ruta) : /\.(m?js|cjs)$/.test(f) ? [ruta] : [];
  });
}

const PATRON_MUTATION = /\bmutation\b/i;

// Única excepción explícita: el filtro de solo lectura nombra la operación de escritura
// GraphQL para rechazarla. Solo se le exceptúa ese patrón, y solo en esa línea.
const EXCEPCION_MUTATION = path.join('scripts', 'lib', 'solo-lectura.mjs');

const PROHIBIDOS = [
  [/item-edit/i, 'gh project item-edit'],
  [/issue\s+edit/i, 'gh issue edit'],
  [/['"]issue['"]\s*,\s*['"]edit['"]/i, "gh issue edit (como argumentos)"],
  [/-X\s*['"]?\s*(POST|PUT|PATCH|DELETE)\b/i, 'gh api -X con método de escritura'],
  [/['"]-X['"]\s*,\s*['"](POST|PUT|PATCH|DELETE)['"]/i, 'gh api -X (como argumentos)'],
  [/--method[\s=]*['"]?\s*(POST|PUT|PATCH|DELETE)\b/i, 'gh api --method de escritura'],
  [/['"]--method['"]\s*,\s*['"](POST|PUT|PATCH|DELETE)['"]/i, 'gh api --method (como argumentos)'],
  [PATRON_MUTATION, 'GraphQL mutation'],
  [/auth\s+token/i, 'gh auth token'],
  [/['"]auth['"]\s*,\s*['"]token['"]/i, 'gh auth token (como argumentos)'],
];

test('el código de scripts/ no contiene verbos de escritura ni lectura del token', () => {
  const archivos = archivosDe(path.join(RAIZ, 'scripts'));
  assert.ok(archivos.length >= 2, 'no se encontraron scripts');
  const hallazgos = [];
  for (const archivo of archivos) {
    const texto = readFileSync(archivo, 'utf8');
    const relativo = path.relative(RAIZ, archivo);
    for (const [patron, nombre] of PROHIBIDOS) {
      if (patron === PATRON_MUTATION && relativo === EXCEPCION_MUTATION) continue;
      if (patron.test(texto)) hallazgos.push(`${relativo}: ${nombre}`);
    }
  }
  assert.deepEqual(hallazgos, []);
});

test('la excepción de «mutation» es solo el filtro y solo en su lista de rechazo', () => {
  const archivos = archivosDe(path.join(RAIZ, 'scripts')).map((a) => path.relative(RAIZ, a));
  assert.ok(archivos.includes(EXCEPCION_MUTATION), 'falta el filtro de solo lectura');
  assert.ok(archivos.includes(path.join('scripts', 'actualizar.mjs')), 'la prueba no cubre actualizar.mjs');
  assert.ok(archivos.includes(path.join('scripts', 'lib', 'modelo.mjs')), 'la prueba no cubre scripts/lib');
  const lineas = readFileSync(path.join(RAIZ, EXCEPCION_MUTATION), 'utf8')
    .split(/\r?\n/)
    .filter((l) => PATRON_MUTATION.test(l));
  assert.equal(lineas.length, 1);
  assert.match(lineas[0], /^const OPERACION_ESCRITURA = new RegExp\(/);
});

const PATRON_TOKEN = /\b(gho_|ghp_|github_pat_|ghs_|ghu_)[A-Za-z0-9_]{10,}/;

test('el patrón de token detecta tokens (control de la prueba)', () => {
  assert.ok(PATRON_TOKEN.test('x ghp_' + 'a'.repeat(36)));
  assert.ok(!PATRON_TOKEN.test('ghp_ corto'));
});

test('web/data.js y web/data.json generados no contienen tokens', (t) => {
  const rutas = ['data.js', 'data.json'].map((f) => path.join(RAIZ, 'web', f)).filter(existsSync);
  if (rutas.length === 0) {
    t.skip('Aún no se ha generado web/data.js (ejecuta node scripts/actualizar.mjs).');
    return;
  }
  for (const ruta of rutas) {
    const texto = readFileSync(ruta, 'utf8');
    for (const prefijo of ['gho_', 'ghp_', 'github_pat_', 'ghs_', 'ghu_']) {
      assert.ok(!texto.includes(prefijo), `${path.basename(ruta)} contiene «${prefijo}»`);
    }
  }
});

test('el data.js serializado desde la captura no contiene tokens', () => {
  const captura = JSON.parse(readFileSync(path.join(RAIZ, 'tests', 'fixtures', 'tablero-3.json'), 'utf8'));
  const config = normalizarConfig(JSON.parse(readFileSync(path.join(RAIZ, 'heimdallr.config.json'), 'utf8')));
  const js = serializarDataJs(
    construirModelo({ ...captura, config, externos: captura.issuesExternos, hoy: captura.hoy, generado: '2026-11-17T00:00:00Z' }),
  );
  assert.ok(!PATRON_TOKEN.test(js));
  assert.ok(!/(gho_|ghp_|github_pat_|ghs_|ghu_)/.test(js));
});
