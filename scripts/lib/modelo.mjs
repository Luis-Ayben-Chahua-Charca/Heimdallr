// Constructor del modelo de datos intermedio (PROPUESTA.md, sección 4).
// Módulo puro: recibe las respuestas ya obtenidas de GitHub y devuelve el modelo.
// No llama a gh, no lee archivos ni usa la red, para poder reutilizarse en la fase 3.

import { leerDependencias } from './dependencias.mjs';
import { detectarCiclos } from './ciclos.mjs';
import { colorPorIndice } from './colores.mjs';
import { calcularColumnas, iteracionesDesdeGraphql, ID_SIN_SPRINT, ZONA_POR_DEFECTO, zonaHorariaValida } from './columnas.mjs';

export const ESQUEMA = 1;

/** Campos del modelo con tratamiento propio; los demás se copian tal cual a la tarjeta. */
const CAMPOS_CONOCIDOS = ['estado', 'columna', 'categoria', 'rol', 'tipo', 'prioridad', 'estimacionDias'];

/** Normaliza un nombre de campo como lo hace `gh project item-list`: minúsculas y sin tildes. */
export function normalizarNombre(nombre) {
  return String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Valida y completa la configuración. Invierte el mapeo `campos` (tablero → modelo) a
 * modelo → tablero.
 */
export function normalizarConfig(cruda = {}) {
  const campos = cruda.campos && typeof cruda.campos === 'object' ? cruda.campos : {};
  const campoTablero = {};
  for (const [enTablero, enModelo] of Object.entries(campos)) {
    if (typeof enModelo === 'string' && enModelo) campoTablero[enModelo] = enTablero;
  }
  return {
    dueno: cruda.dueno || null,
    proyecto: cruda.proyecto != null ? Number(cruda.proyecto) : null,
    limite: Number.isInteger(cruda.limite) && cruda.limite > 0 ? cruda.limite : 1000,
    modoEstricto: Boolean(cruda.modoEstricto),
    usarBlockedByNativo: Boolean(cruda.usarBlockedByNativo),
    campoTablero,
    patronPorDefecto: cruda.columnas?.patronPorDefecto ?? null,
    tituloSinSprint: cruda.columnas?.tituloSinSprint || 'Sin sprint',
    estadosExtra: cruda.estadosExtra && typeof cruda.estadosExtra === 'object' ? cruda.estadosExtra : {},
    nombresCategorias: cruda.nombresCategorias && typeof cruda.nombresCategorias === 'object' ? cruda.nombresCategorias : {},
    salida: cruda.salida || 'web',
    zonaHoraria: cruda.zonaHoraria || ZONA_POR_DEFECTO,
  };
}

/**
 * Comprueba los valores de la configuración que harían fallar la ejecución más adelante.
 * @returns {string[]} Errores legibles; vacío si es válida.
 */
export function validarConfig(config) {
  const errores = [];
  if (config.patronPorDefecto != null) {
    try {
      new RegExp(config.patronPorDefecto);
    } catch (e) {
      errores.push(`«columnas.patronPorDefecto» no es una expresión regular válida (${config.patronPorDefecto}): ${e.message}`);
    }
  }
  if (!zonaHorariaValida(config.zonaHoraria)) {
    errores.push(`«zonaHoraria» no es una zona horaria IANA válida: «${config.zonaHoraria}» (ejemplo: America/Lima).`);
  }
  return errores;
}

const claveIssue = (repo, numero) => `${repo}#${numero}`;

function esIssue(item) {
  return item?.content?.type === 'Issue' && Number.isInteger(item.content.number);
}

/** Lee las dependencias de texto de todas las tarjetas del tablero. */
function leerTodas(items, estricto) {
  const porClave = new Map();
  for (const item of items) {
    if (!esIssue(item)) continue;
    const clave = claveIssue(item.content.repository, item.content.number);
    porClave.set(clave, leerDependencias(item.content.body || '', { estricto }));
  }
  return porClave;
}

/**
 * Lista las dependencias que apuntan a issues que no están en el tablero, para que quien
 * llame las resuelva (p. ej. con `gh issue view`).
 * @returns {{ repo: string, numero: number, clave: string }[]}
 */
export function dependenciasFueraDelTablero(itemList, opciones = {}) {
  const items = itemList?.items || [];
  const enTablero = new Set(items.filter(esIssue).map((i) => claveIssue(i.content.repository, i.content.number)));
  const lecturas = leerTodas(items, false);
  const extra = opciones.blockedBy || {};
  const fuera = new Map();
  for (const item of items) {
    if (!esIssue(item)) continue;
    const repo = item.content.repository;
    const clave = claveIssue(repo, item.content.number);
    const numeros = [...(lecturas.get(clave)?.numeros || []), ...((extra[clave] || []).filter((c) => c.startsWith(repo + '#')).map((c) => Number(c.split('#')[1])))];
    for (const n of numeros) {
      const k = claveIssue(repo, n);
      if (!enTablero.has(k) && !fuera.has(k)) fuera.set(k, { repo, numero: n, clave: k });
    }
  }
  return [...fuera.values()].sort((a, b) => (a.repo === b.repo ? a.numero - b.numero : a.repo < b.repo ? -1 : 1));
}

/** Busca el valor de un campo del tablero en un elemento de item-list (nombres normalizados). */
function valorCampo(item, nombreTablero) {
  if (!nombreTablero) return undefined;
  const buscado = normalizarNombre(nombreTablero);
  for (const [k, v] of Object.entries(item)) {
    if (k === 'content' || k === 'id') continue;
    if (normalizarNombre(k) === buscado) return v;
  }
  return undefined;
}

function aNumero(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function aTexto(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return v.title ?? v.name ?? null;
  return String(v);
}

function prsDe(item) {
  const urls = item['linked pull requests'] || [];
  return urls
    .map((url) => {
      const m = /\/pull\/(\d+)/.exec(url);
      return m ? { numero: Number(m[1]), url } : null;
    })
    .filter(Boolean);
}

const listaIssues = (nums) => nums.map((n) => `#${n}`).join(', ');

/**
 * Construye el modelo.
 * @param {object} entrada
 * @param {object} entrada.itemList Respuesta de `gh project item-list --format json`.
 * @param {object} entrada.fieldList Respuesta de `gh project field-list --format json`.
 * @param {object} [entrada.proyectoGraphql] Respuesta GraphQL con título, URL e iteraciones.
 * @param {object} entrada.config Configuración ya normalizada (`normalizarConfig`).
 * @param {Record<string, {number:number,title:string,state:string,url:string}|null>} [entrada.externos]
 *   Issues fuera del tablero por clave `dueño/repo#N`; null si no existen.
 * @param {Record<string, string[]>} [entrada.blockedBy] Dependencias nativas «blocked by» por clave.
 * @param {string} entrada.hoy Fecha `AAAA-MM-DD` para marcar la columna actual.
 * @param {string} entrada.generado Fecha ISO de generación.
 * @param {boolean} [entrada.estricto] Modo estricto del lector de dependencias.
 * @param {string[]} [entrada.avisosPrevios] Avisos de pasos anteriores (p. ej. límite alcanzado).
 */
export function construirModelo(entrada) {
  const { itemList, fieldList, proyectoGraphql, config, hoy, generado } = entrada;
  const externos = entrada.externos || {};
  const blockedBy = entrada.blockedBy || {};
  const estricto = entrada.estricto ?? config.modoEstricto;
  const avisos = [...(entrada.avisosPrevios || [])];

  const items = itemList?.items || [];
  const campos = fieldList?.fields || [];
  const campoPorNombre = new Map(campos.map((c) => [normalizarNombre(c.name), c]));

  // 1. Campos configurados que no existen en el tablero.
  const campoTablero = {};
  for (const [enModelo, enTablero] of Object.entries(config.campoTablero)) {
    if (campoPorNombre.has(normalizarNombre(enTablero))) {
      campoTablero[enModelo] = enTablero;
    } else {
      avisos.push(`El campo «${enTablero}» configurado (→ ${enModelo}) no existe en el tablero; se deja vacío.`);
    }
  }
  const opcionesDe = (enModelo) => campoPorNombre.get(normalizarNombre(campoTablero[enModelo] || ''))?.options?.map((o) => o.name) || [];

  // 2. Elementos que no son issues.
  const issues = [];
  for (const item of items) {
    if (esIssue(item)) issues.push(item);
    else avisos.push(`Se omite el elemento «${item?.title ?? item?.id}» del tablero: es de tipo ${item?.content?.type ?? 'desconocido'}, no un issue.`);
  }

  // 3. Números repetidos entre repositorios (las dependencias se guardan por número).
  const repoPorNumero = new Map();
  for (const item of issues) {
    const n = item.content.number;
    const r = item.content.repository;
    if (repoPorNumero.has(n) && repoPorNumero.get(n) !== r) {
      avisos.push(`El número #${n} existe en dos repositorios del tablero (${repoPorNumero.get(n)} y ${r}); sus dependencias pueden confundirse.`);
    } else repoPorNumero.set(n, r);
  }

  // 4. Estados.
  const mapearEstado = (e) => (e != null && Object.hasOwn(config.estadosExtra, e) ? config.estadosExtra[e] : e);
  const estados = [];
  for (const e of opcionesDe('estado').map(mapearEstado)) if (!estados.includes(e)) estados.push(e);

  // 5. Categorías (paleta indexada por el orden de las opciones del campo).
  const nombresCat = opcionesDe('categoria');
  const categorias = {};
  const agregarCategoria = (clave) => {
    if (clave == null || Object.hasOwn(categorias, clave)) return;
    const i = Object.keys(categorias).length;
    categorias[clave] = { nombre: config.nombresCategorias[clave] || clave, color: colorPorIndice(i) };
  };
  nombresCat.forEach(agregarCategoria);

  // 6. Tarjetas del tablero.
  const lecturas = leerTodas(issues, estricto);
  const enTablero = new Set(issues.map((i) => claveIssue(i.content.repository, i.content.number)));
  const iteracionesVistas = [];
  const tarjetas = [];
  const sinSprint = [];

  for (const item of issues) {
    const { number: numero, repository: repo } = item.content;
    const clave = claveIssue(repo, numero);
    const lectura = lecturas.get(clave);
    for (const linea of lectura.lineasNoReconocidas) {
      avisos.push(`El issue #${numero} declara una dependencia con formato no reconocido: «${linea}»`);
    }

    // Dependencias de texto + nativas (si se pidieron), sin repetir.
    const deps = [...lectura.numeros];
    for (const c of blockedBy[clave] || []) {
      if (!c.startsWith(repo + '#')) {
        avisos.push(`El issue #${numero} está bloqueado por ${c}, de otro repositorio; no se dibuja.`);
        continue;
      }
      const n = Number(c.split('#')[1]);
      if (!deps.includes(n)) deps.push(n);
    }
    const dependeDe = [];
    for (const n of deps) {
      const k = claveIssue(repo, n);
      if (enTablero.has(k)) dependeDe.push(n);
      else if (externos[k]) dependeDe.push(n);
      else if (externos[k] === null) avisos.push(`El issue #${numero} depende de #${n}, que no existe en ${repo}; se ignora esa dependencia.`);
      else {
        // No se pudo consultar (red, límite de la API…): se conserva el número para que la
        // página lo trate como no terminado (tarjeta «Bloqueada») en vez de darla por «Lista».
        dependeDe.push(n);
        avisos.push(`El issue #${numero} depende de #${n}, que no está en el tablero y no se pudo consultar; se trata como no terminada.`);
      }
    }

    // Columna.
    const valorColumna = valorCampo(item, campoTablero.columna);
    let columna = aTexto(valorColumna);
    if (valorColumna && typeof valorColumna === 'object' && valorColumna.title) {
      iteracionesVistas.push({ id: valorColumna.iterationId, titulo: valorColumna.title, inicio: valorColumna.startDate || null, duracion: valorColumna.duration ?? null });
    }
    if (!columna) {
      columna = ID_SIN_SPRINT;
      sinSprint.push(numero);
    }

    const categoria = aTexto(valorCampo(item, campoTablero.categoria));
    agregarCategoria(categoria);
    const estadoOriginal = aTexto(valorCampo(item, campoTablero.estado));
    const estado = mapearEstado(estadoOriginal);
    if (estado != null && !estados.includes(estado)) estados.push(estado);

    const tarjeta = {
      id: numero,
      repo,
      titulo: item.content.title ?? item.title,
      url: item.content.url,
      estado,
      columna,
      categoria,
      rol: aTexto(valorCampo(item, campoTablero.rol)),
      tipo: aTexto(valorCampo(item, campoTablero.tipo)),
      prioridad: aTexto(valorCampo(item, campoTablero.prioridad)),
      asignados: [...(item.assignees || [])],
      etiquetas: [...(item.labels || [])],
      estimacionDias: aNumero(valorCampo(item, campoTablero.estimacionDias)),
      prs: prsDe(item),
      dependeDe,
      fueraDelTablero: false,
      enCiclo: false,
    };
    if (estadoOriginal !== estado) tarjeta.estadoOriginal = estadoOriginal;
    // Campos adicionales configurados (no previstos en el modelo base).
    for (const [enModelo, enTablero] of Object.entries(campoTablero)) {
      if (!CAMPOS_CONOCIDOS.includes(enModelo)) tarjeta[enModelo] = aTexto(valorCampo(item, enTablero));
    }
    tarjetas.push(tarjeta);
    // El cuerpo del issue no pasa al modelo: solo se usó para leer las dependencias.
  }

  // 7. Nodos fuera del tablero que sí existen.
  const usados = new Set(tarjetas.flatMap((t) => t.dependeDe.map((n) => claveIssue(t.repo, n))));
  for (const [clave, issue] of Object.entries(externos)) {
    if (!issue || enTablero.has(clave) || !usados.has(clave)) continue;
    const repo = clave.slice(0, clave.lastIndexOf('#'));
    // gh issue view de un PR devuelve MERGED: cuenta como cerrado.
    const estadoIssue = ['CLOSED', 'MERGED'].includes(String(issue.state || '').toUpperCase()) ? 'Closed' : 'Open';
    tarjetas.push({
      id: issue.number,
      repo,
      titulo: issue.title,
      url: issue.url,
      estado: estadoIssue,
      columna: null,
      categoria: null,
      rol: null,
      tipo: null,
      prioridad: null,
      asignados: [],
      etiquetas: [],
      estimacionDias: null,
      prs: [],
      dependeDe: [],
      fueraDelTablero: true,
      enCiclo: false,
    });
  }
  tarjetas.sort((a, b) => (a.repo === b.repo ? a.id - b.id : a.repo < b.repo ? -1 : 1));

  // 8. Ciclos.
  const grafo = new Map(tarjetas.map((t) => [claveIssue(t.repo, t.id), t.dependeDe.map((n) => claveIssue(t.repo, n))]));
  const porClave = new Map(tarjetas.map((t) => [claveIssue(t.repo, t.id), t]));
  for (const ciclo of detectarCiclos(grafo)) {
    for (const c of ciclo) porClave.get(c).enCiclo = true;
    const nums = ciclo.map((c) => porClave.get(c).id);
    avisos.push(
      nums.length === 1
        ? `El issue #${nums[0]} depende de sí mismo (referencia circular).`
        : `Referencia circular entre los issues ${listaIssues(nums)}.`,
    );
  }

  // 9. Tarjetas sin sprint.
  if (sinSprint.length > 0) {
    sinSprint.sort((a, b) => a - b);
    avisos.push(`${sinSprint.length} tarjeta(s) sin sprint, en la columna «${config.tituloSinSprint}»: ${listaIssues(sinSprint)}.`);
  }

  // 10. Columnas: todas las iteraciones del campo (aunque no tengan tarjetas) y las vistas en tarjetas.
  let iteraciones = [];
  const nombreColumna = campoTablero.columna;
  const campoColumna = nombreColumna ? campoPorNombre.get(normalizarNombre(nombreColumna)) : null;
  if (campoColumna?.options) {
    iteraciones = campoColumna.options.map((o) => ({ id: o.id, titulo: o.name, inicio: null, duracion: null }));
  } else if (nombreColumna) {
    const desdeGraphql = proyectoGraphql ? iteracionesDesdeGraphql(proyectoGraphql, campoColumna?.name ?? nombreColumna) : null;
    if (desdeGraphql) iteraciones = desdeGraphql;
    else if (proyectoGraphql) avisos.push(`No se pudieron leer las iteraciones del campo «${nombreColumna}»; solo se muestran las que tienen tarjetas.`);
  }
  iteraciones = [...iteraciones, ...iteracionesVistas];
  const columnas = calcularColumnas(iteraciones, {
    hoy,
    patronPorDefecto: config.patronPorDefecto,
    haySinSprint: sinSprint.length > 0,
    tituloSinSprint: config.tituloSinSprint,
  });

  const meta = proyectoGraphql?.data?.repositoryOwner?.projectV2 || {};
  return {
    esquema: ESQUEMA,
    generado,
    fuente: {
      dueno: config.dueno,
      proyecto: config.proyecto,
      titulo: meta.title ?? null,
      url: meta.url ?? null,
      zonaHoraria: config.zonaHoraria,
    },
    columnas,
    estados,
    categorias,
    tarjetas,
    avisos,
  };
}

// Separadores de línea U+2028 y U+2029: se escapan para que data.js sea JavaScript válido en cualquier motor.
const LS = String.fromCharCode(0x2028);
const SEPARADORES = new RegExp(`[${LS}${String.fromCharCode(0x2029)}]`, "g");

/** Serializa el modelo como `data.js` para abrir la página con doble clic (sin fetch). */
export function serializarDataJs(modelo) {
  const json = JSON.stringify(modelo, null, 2).replace(SEPARADORES, (c) => '\\u' + c.charCodeAt(0).toString(16));
  return `// Generado por scripts/actualizar.mjs. No se edita a mano.\nwindow.HEIMDALLR_DATA = ${json};\n`;
}

/** Serializa el modelo como `data.json`. */
export function serializarDataJson(modelo) {
  return JSON.stringify(modelo, null, 2) + '\n';
}
