#!/usr/bin/env node
// Heimdallr — extracción del tablero (fase 1).
//
// Uso: node scripts/actualizar.mjs [--owner X] [--project N] [--config ruta] [--estricto]
//
// Lee un tablero de GitHub Projects con la sesión de `gh` ya iniciada y escribe
// web/data.js (window.HEIMDALLR_DATA = {…};) y web/data.json.
//
// SOLO LECTURA: este script únicamente ejecuta consultas de gh (project item-list,
// project field-list, issue view y api graphql con consultas `query`). Nunca escribe
// en GitHub, no imprime ni guarda credenciales y no consulta el token de gh.

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizarConfig, validarConfig, construirModelo, dependenciasFueraDelTablero, serializarDataJs, serializarDataJson } from './lib/modelo.mjs';
import { fechaEnZona } from './lib/columnas.mjs';
import { comprobarSoloLectura } from './lib/solo-lectura.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_POR_DEFECTO = path.join(RAIZ, 'heimdallr.config.json');

class ErrorHeimdallr extends Error {
  constructor(mensaje, codigo = 1) {
    super(mensaje);
    this.codigo = codigo;
  }
}

// ---------------------------------------------------------------------------
// Argumentos

function leerArgumentos(argv) {
  const args = { estricto: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valor = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ErrorHeimdallr(`Falta el valor de ${a}.`);
      return v;
    };
    if (a === '--owner') args.owner = valor();
    else if (a === '--project') args.project = valor();
    else if (a === '--config') args.config = valor();
    else if (a === '--estricto') args.estricto = true;
    else if (a === '--ayuda' || a === '--help' || a === '-h') args.ayuda = true;
    else throw new ErrorHeimdallr(`Argumento desconocido: ${a}. Usa --ayuda para ver las opciones.`);
  }
  return args;
}

const AYUDA = `Uso: node scripts/actualizar.mjs [opciones]

  --owner X      Dueño del tablero (usuario u organización). Por defecto, el del config.
  --project N    Número del tablero. Por defecto, el del config.
  --config ruta  Archivo de configuración (por defecto heimdallr.config.json).
  --estricto     Avisa de toda línea con otro formato en «Depende de».
  --ayuda        Muestra esta ayuda.`;

// ---------------------------------------------------------------------------
// Llamadas a gh (sin shell, con lista blanca de subcomandos de lectura)

function ejecutarGh(args) {
  try {
    comprobarSoloLectura(args);
  } catch (e) {
    return Promise.reject(new ErrorHeimdallr(e.message));
  }
  return new Promise((resolve, reject) => {
    // En Windows, execFile encuentra gh.exe en el PATH sin necesidad de shell.
    execFile('gh', args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || '');
        reject(error);
      } else resolve(stdout);
    });
  });
}

/** Traduce los errores de gh a mensajes claros. */
function explicarErrorGh(error, contexto) {
  if (error instanceof ErrorHeimdallr) return error;
  if (error.code === 'ENOENT') {
    return new ErrorHeimdallr('No se encontró el programa gh. Instálalo desde https://cli.github.com/ y luego ejecuta: gh auth login', 2);
  }
  const salida = (error.stderr || error.message || '').trim();
  const texto = salida.toLowerCase();
  if (/not logged|gh auth login|authentication required|http 401|bad credentials/.test(texto)) {
    return new ErrorHeimdallr(`gh no tiene una sesión válida (${contexto}). Ejecuta: gh auth login\ny después: gh auth refresh -s project`, 2);
  }
  if (/scope|read:project|insufficient|not been granted|resource not accessible/.test(texto)) {
    return new ErrorHeimdallr(`A la sesión de gh le falta el permiso «project» (${contexto}). Ejecuta: gh auth refresh -s project`, 2);
  }
  if (/unknown owner type/.test(texto)) {
    return new ErrorHeimdallr(`No existe el usuario u organización indicado como dueño (${contexto}). Revisa --owner o «dueno» en la configuración.`);
  }
  if (/could not resolve to a projectv2/.test(texto)) {
    return new ErrorHeimdallr(`No existe ese número de proyecto o la sesión de gh no puede verlo (${contexto}). Revisa --project; si el tablero es privado, ejecuta: gh auth refresh -s project`, 2);
  }
  const primeras = salida.split(/\r?\n/).slice(0, 5).join('\n');
  return new ErrorHeimdallr(`Falló gh (${contexto}):\n${primeras}`);
}

async function ghJson(args, contexto) {
  try {
    return JSON.parse(await ejecutarGh(args));
  } catch (e) {
    if (e instanceof SyntaxError) throw new ErrorHeimdallr(`gh devolvió una respuesta que no es JSON (${contexto}).`);
    throw explicarErrorGh(e, contexto);
  }
}

// ---------------------------------------------------------------------------
// Consultas GraphQL de solo lectura

const CONSULTA_PROYECTO = `query($login: String!, $numero: Int!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $numero) {
        title
        url
        fields(first: 100) {
          nodes {
            ... on ProjectV2IterationField {
              name
              configuration {
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
        }
      }
    }
  }
}`;

const CONSULTA_BLOCKED_BY = `query($login: String!, $numero: Int!, $cursor: String) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $numero) {
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            content {
              ... on Issue {
                number
                repository { nameWithOwner }
                blockedBy(first: 50) { nodes { number repository { nameWithOwner } } }
              }
            }
          }
        }
      }
    }
  }
}`;

async function leerBlockedBy(dueno, numero) {
  const resultado = {};
  let cursor = null;
  do {
    const args = ['api', 'graphql', '-f', `query=${CONSULTA_BLOCKED_BY}`, '-f', `login=${dueno}`, '-F', `numero=${numero}`];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const r = await ghJson(args, 'lectura de «blocked by» nativo');
    const items = r?.data?.repositoryOwner?.projectV2?.items;
    if (!items) break;
    for (const nodo of items.nodes || []) {
      const c = nodo?.content;
      if (!c?.number || !c.repository) continue;
      const lista = (c.blockedBy?.nodes || []).map((b) => `${b.repository.nameWithOwner}#${b.number}`);
      if (lista.length) resultado[`${c.repository.nameWithOwner}#${c.number}`] = lista;
    }
    cursor = items.pageInfo?.hasNextPage ? items.pageInfo.endCursor : null;
  } while (cursor);
  return resultado;
}

// ---------------------------------------------------------------------------
// Programa principal

async function principal() {
  const args = leerArgumentos(process.argv.slice(2));
  if (args.ayuda) {
    console.log(AYUDA);
    return;
  }

  const rutaConfig = args.config ? path.resolve(process.cwd(), args.config) : CONFIG_POR_DEFECTO;
  let cruda;
  try {
    cruda = JSON.parse(await readFile(rutaConfig, 'utf8'));
  } catch (e) {
    throw new ErrorHeimdallr(`No se pudo leer la configuración ${rutaConfig}: ${e.message}`);
  }
  const config = normalizarConfig(cruda);
  const erroresConfig = validarConfig(config);
  if (erroresConfig.length) {
    throw new ErrorHeimdallr(`La configuración ${rutaConfig} no es válida:\n  - ${erroresConfig.join('\n  - ')}`);
  }
  if (args.owner) config.dueno = args.owner;
  if (args.project) config.proyecto = Number(args.project);
  const estricto = args.estricto || config.modoEstricto;
  if (!config.dueno) throw new ErrorHeimdallr('Falta el dueño del tablero: usa --owner o «dueno» en la configuración.');
  if (!Number.isInteger(config.proyecto) || config.proyecto <= 0) throw new ErrorHeimdallr('Falta un número de proyecto válido: usa --project o «proyecto» en la configuración.');

  const { dueno, proyecto, limite } = config;
  const avisosPrevios = [];
  console.log(`Leyendo el tablero #${proyecto} de ${dueno}…`);

  // (1) Tarjetas. gh pagina internamente (de 100 en 100) hasta --limit.
  const itemList = await ghJson(['project', 'item-list', String(proyecto), '--owner', dueno, '--limit', String(limite), '--format', 'json'], 'project item-list');
  const nItems = itemList.items?.length ?? 0;
  if (nItems >= limite || (Number.isInteger(itemList.totalCount) && itemList.totalCount > nItems)) {
    avisosPrevios.push(`Se alcanzó el límite de ${limite} tarjetas (el tablero tiene ${itemList.totalCount ?? 'más'}); puede haber tarjetas sin leer. Sube «limite» en la configuración.`);
  }

  // (2) Campos y opciones; iteraciones (incluidas las que no tienen tarjetas) por GraphQL.
  const fieldList = await ghJson(['project', 'field-list', String(proyecto), '--owner', dueno, '--limit', '200', '--format', 'json'], 'project field-list');
  const proyectoGraphql = await ghJson(['api', 'graphql', '-f', `query=${CONSULTA_PROYECTO}`, '-f', `login=${dueno}`, '-F', `numero=${proyecto}`], 'lectura de iteraciones');
  if (!proyectoGraphql?.data?.repositoryOwner?.projectV2) {
    throw new ErrorHeimdallr(`No se encontró el proyecto #${proyecto} de ${dueno}, o la sesión de gh no puede leerlo. Si es privado, ejecuta: gh auth refresh -s project`, 2);
  }

  // (3) «Blocked by» nativo (opcional, desactivado por defecto).
  const blockedBy = config.usarBlockedByNativo ? await leerBlockedBy(dueno, proyecto) : {};

  // (4) Dependencias fuera del tablero, con caché en memoria.
  const cache = new Map();
  const externos = {};
  for (const { repo, numero, clave } of dependenciasFueraDelTablero(itemList, { blockedBy })) {
    if (!cache.has(clave)) {
      try {
        const issue = JSON.parse(await ejecutarGh(['issue', 'view', String(numero), '--repo', repo, '--json', 'number,title,state,url']));
        cache.set(clave, { number: issue.number, title: issue.title, state: issue.state, url: issue.url });
      } catch (e) {
        if (e instanceof ErrorHeimdallr) throw e;
        const texto = String(e.stderr || e.message || '');
        // Solo un «no existe» confirmado por GitHub descarta la dependencia; cualquier otro
        // fallo (red, límite de la API…) la deja sin resolver y el modelo la conserva.
        if (/could not resolve to an issue/i.test(texto)) cache.set(clave, null);
        else {
          const err = explicarErrorGh(e, `issue view ${clave}`);
          if (err.codigo === 2) throw err;
          cache.set(clave, undefined);
        }
      }
    }
    externos[clave] = cache.get(clave);
  }

  // (5) Modelo y validaciones.
  const modelo = construirModelo({
    itemList,
    fieldList,
    proyectoGraphql,
    config,
    externos,
    blockedBy,
    hoy: fechaEnZona(new Date(), config.zonaHoraria),
    generado: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    estricto,
    avisosPrevios,
  });

  // (6) Escritura.
  const dirSalida = path.resolve(RAIZ, config.salida);
  const archivos = [
    ['data.js', serializarDataJs(modelo)],
    ['data.json', serializarDataJson(modelo)],
  ];
  try {
    await mkdir(dirSalida, { recursive: true });
    for (const [nombre, contenido] of archivos) await writeFile(path.join(dirSalida, nombre), contenido, 'utf8');
  } catch (e) {
    throw new ErrorHeimdallr(`No se pudo escribir la salida en ${dirSalida}: ${e.message}`);
  }

  imprimirResumen(modelo, dirSalida);
}

function imprimirResumen(modelo, dirSalida) {
  const enTablero = modelo.tarjetas.filter((t) => !t.fueraDelTablero);
  const contar = (lista, f) => lista.reduce((m, t) => ((m[f(t)] = (m[f(t)] || 0) + 1), m), {});
  const porEstado = contar(enTablero, (t) => t.estado ?? '(sin estado)');
  const porColumna = contar(enTablero, (t) => t.columna);
  console.log(`\n«${modelo.fuente.titulo}»: ${enTablero.length} tarjetas, ${modelo.tarjetas.length - enTablero.length} fuera del tablero.`);
  console.log('Por estado: ' + Object.entries(porEstado).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('Por columna: ' + modelo.columnas.map((c) => `${c.titulo}${c.actual ? '*' : ''} ${porColumna[c.id] || 0}`).join(' · '));
  console.log(`Con dependencias: ${enTablero.filter((t) => t.dependeDe.length > 0).length}`);
  if (modelo.avisos.length) {
    console.log(`\nAvisos (${modelo.avisos.length}):`);
    for (const a of modelo.avisos) console.log(`  - ${a}`);
  } else console.log('\nSin avisos.');
  console.log(`\nEscrito: ${path.join(dirSalida, 'data.js')} y data.json`);
}

principal().catch((e) => {
  // Los errores de gh ya llegan aquí como ErrorHeimdallr (ghJson y ejecutarGh los traducen).
  // Cualquier otro es un fallo interno de Heimdallr, no de gh.
  if (e instanceof ErrorHeimdallr) {
    console.error(`\nError: ${e.message}`);
    process.exitCode = e.codigo || 1;
  } else {
    console.error(`\nError interno de Heimdallr (no de gh): ${e?.message ?? e}`);
    if (e?.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    process.exitCode = 1;
  }
});
