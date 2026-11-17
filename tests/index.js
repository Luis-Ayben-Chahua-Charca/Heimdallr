// Punto de entrada para `node --test tests/`.
// En Node 24, `node --test` con una carpeta la carga como módulo (este index.js), así que
// aquí se importan todas las pruebas `*.test.mjs` de la carpeta. Con `node --test` sin
// argumentos, Node encuentra los `*.test.mjs` por sí mismo y este archivo no se ejecuta.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const archivos = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

(async () => {
  for (const f of archivos) await import(pathToFileURL(path.join(__dirname, f)).href);
})();
