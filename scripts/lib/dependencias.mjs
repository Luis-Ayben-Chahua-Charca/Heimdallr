// Lector de la sección «Depende de» del cuerpo de un issue.
// Módulo puro: no usa gh, fs ni red (se compartirá con la función serverless de la fase 3).
//
// Regla (PROPUESTA.md, 3.4):
// - La sección empieza en la línea `## Depende de` (sin distinguir mayúsculas, con espacios
//   múltiples, `:` final y `##` de cierre opcionales) y termina en la siguiente regla
//   horizontal (`---`, `***`, `___`) o en cualquier encabezado (`# `, `## `, `### `…).
// - Cada dependencia es una línea `- #N` (también se aceptan las viñetas `*` y `+`).
// - Las líneas sin `#` son texto libre y se ignoran.
// - Tolera finales de línea `\r\n`.
// - En modo estricto se devuelven avisos de las líneas no vacías con otro formato.
// - Fuera del modo estricto se avisa de las líneas que parecen una dependencia mal escrita
//   (`- #12, #13`, `- # 53`, `- https://github.com/dueño/repo/issues/53`), para no perder
//   dependencias en silencio. Esas líneas NO se convierten en dependencias.

const ENCABEZADO = /^##\s+Depende\s+de\s*:?\s*(?:#+\s*)?$/i;
const ENCABEZADO_CUALQUIERA = /^#{1,6}(?:\s|$)/;
const REGLA_HORIZONTAL = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const LINEA_DEPENDENCIA = /^[-*+]\s+#(\d+)\s*$/;
const PARECE_REFERENCIA = /#\s*\d+|\/(?:issues|pull)\/\d+/i;

const esFinDeSeccion = (linea) => REGLA_HORIZONTAL.test(linea) || ENCABEZADO_CUALQUIERA.test(linea);

/**
 * Devuelve las líneas (sin recortar) de la sección «Depende de», o null si no existe.
 * @param {string} cuerpo
 * @returns {string[] | null}
 */
export function extraerSeccion(cuerpo) {
  if (typeof cuerpo !== 'string' || cuerpo === '') return null;
  const lineas = cuerpo.split(/\r?\n|\r/);
  const inicio = lineas.findIndex((l) => ENCABEZADO.test(l.trim()));
  if (inicio === -1) return null;
  const seccion = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esFinDeSeccion(linea.trim())) break;
    seccion.push(linea);
  }
  return seccion;
}

/**
 * Lee las dependencias declaradas en el cuerpo de un issue.
 * @param {string} cuerpo Cuerpo del issue en Markdown.
 * @param {{ estricto?: boolean }} [opciones]
 * @returns {{ tieneSeccion: boolean, numeros: number[], lineasNoReconocidas: string[] }}
 *   `numeros` sin repetir y en el orden en que aparecen; `lineasNoReconocidas` son las
 *   líneas (recortadas) de las que hay que avisar.
 */
export function leerDependencias(cuerpo, opciones = {}) {
  const estricto = Boolean(opciones.estricto);
  const seccion = extraerSeccion(cuerpo);
  if (seccion === null) return { tieneSeccion: false, numeros: [], lineasNoReconocidas: [] };

  const numeros = [];
  const lineasNoReconocidas = [];
  for (const bruta of seccion) {
    const linea = bruta.trim();
    if (linea === '') continue;
    const m = LINEA_DEPENDENCIA.exec(linea);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && !numeros.includes(n)) numeros.push(n);
      continue;
    }
    if (estricto || PARECE_REFERENCIA.test(linea)) lineasNoReconocidas.push(linea);
  }
  return { tieneSeccion: true, numeros, lineasNoReconocidas };
}

/**
 * Recorta un cuerpo dejando solo la sección «Depende de» (encabezado incluido), con sus
 * finales de línea originales. Sirve para guardar capturas de prueba sin datos de más.
 * @param {string} cuerpo
 * @returns {string}
 */
export function recortarCuerpo(cuerpo) {
  if (typeof cuerpo !== 'string' || cuerpo === '') return '';
  const fin = cuerpo.includes('\r\n') ? '\r\n' : '\n';
  const lineas = cuerpo.split(/\r?\n|\r/);
  const inicio = lineas.findIndex((l) => ENCABEZADO.test(l.trim()));
  if (inicio === -1) return '';
  const salida = [lineas[inicio]];
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (esFinDeSeccion(lineas[i].trim())) break;
    salida.push(lineas[i]);
  }
  return salida.join(fin) + fin;
}
