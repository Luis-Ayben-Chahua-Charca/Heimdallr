// Filtro de solo lectura para las llamadas a gh. Módulo puro (no ejecuta gh).
//
// Es una lista blanca estricta: cada subcomando permitido declara sus argumentos
// posicionales y sus flags exactos, con un validador para cada valor. Todo lo demás
// (flags desconocidos, formas `--flag=valor`, `--input`, cambio de método HTTP,
// `--hostname`, `operationName`, etc.) se rechaza.
//
// NOTA: este es el único archivo de scripts/ que nombra las operaciones GraphQL de
// escritura, porque las busca para rechazarlas. La prueba de solo lectura
// (tests/seguridad.test.mjs) lo exceptúa de forma explícita solo para esa palabra.

export class LlamadaNoPermitida extends Error {
  constructor(motivo) {
    super(`Llamada a gh no permitida (solo lectura): ${motivo}`);
    this.name = 'LlamadaNoPermitida';
  }
}

const NUMERO = /^[1-9]\d{0,9}$/;
const DUENO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const CAMPOS_JSON = /^[A-Za-z]+(?:,[A-Za-z]+)*$/;
const CURSOR = /^[A-Za-z0-9+/=_-]{1,200}$/;

// Operaciones GraphQL que no son de lectura (palabra completa, en cualquier parte).
const OPERACION_ESCRITURA = new RegExp('\\b(' + ['mutation', 'subscription'].join('|') + ')\\b', 'i');

/** Documento GraphQL aceptable: una sola operación `query` (o la forma corta `{…}`). */
function consultaValida(doc) {
  if (typeof doc !== 'string' || doc.trim() === '') return 'consulta GraphQL vacía';
  if (OPERACION_ESCRITURA.test(doc)) return 'la consulta GraphQL contiene una operación de escritura';
  const t = doc.trim();
  if (!/^query[\s({]/.test(t) && !t.startsWith('{')) return 'el documento GraphQL debe empezar por «query» o «{»';
  // Una sola operación: no puede haber otra definición `query` aparte de la primera.
  if ((t.match(/\bquery\b/g) || []).length > 1) return 'el documento GraphQL solo puede tener una operación';
  if (/\bfragment\b/.test(t)) return 'no se admiten fragmentos con nombre en el documento GraphQL';
  return null;
}

const SUBCOMANDOS = {
  'project item-list': { posicionales: [NUMERO], flags: { '--owner': DUENO, '--limit': NUMERO, '--format': /^json$/ } },
  'project field-list': { posicionales: [NUMERO], flags: { '--owner': DUENO, '--limit': NUMERO, '--format': /^json$/ } },
  'project view': { posicionales: [NUMERO], flags: { '--owner': DUENO, '--format': /^json$/ } },
  'issue view': { posicionales: [NUMERO], flags: { '--repo': REPO, '--json': CAMPOS_JSON } },
};

// gh api graphql: `-f clave=valor` (cadena) y `-F clave=valor` (tipado). Solo estas claves.
const CLAVES_F_CADENA = { query: null, login: DUENO, cursor: CURSOR };
const CLAVES_F_TIPADO = { numero: NUMERO };

function comprobarGraphql(resto) {
  const vistas = new Set();
  let hayConsulta = false;
  for (let i = 0; i < resto.length; i += 2) {
    const flag = resto[i];
    const valor = resto[i + 1];
    if (flag !== '-f' && flag !== '-F') throw new LlamadaNoPermitida(`argumento no permitido en gh api graphql: «${flag}»`);
    if (typeof valor !== 'string') throw new LlamadaNoPermitida(`falta el valor de ${flag}`);
    const igual = valor.indexOf('=');
    if (igual <= 0) throw new LlamadaNoPermitida(`valor de ${flag} sin «clave=»`);
    const clave = valor.slice(0, igual);
    const dato = valor.slice(igual + 1);
    const tabla = flag === '-f' ? CLAVES_F_CADENA : CLAVES_F_TIPADO;
    if (!Object.hasOwn(tabla, clave)) throw new LlamadaNoPermitida(`clave no permitida en ${flag}: «${clave}»`);
    if (vistas.has(clave)) throw new LlamadaNoPermitida(`clave repetida: «${clave}»`);
    vistas.add(clave);
    if (clave === 'query') {
      const motivo = consultaValida(dato);
      if (motivo) throw new LlamadaNoPermitida(motivo);
      hayConsulta = true;
    } else if (!tabla[clave].test(dato)) {
      throw new LlamadaNoPermitida(`valor no válido para «${clave}»`);
    }
  }
  if (!hayConsulta) throw new LlamadaNoPermitida('gh api graphql sin consulta');
}

/**
 * Lanza `LlamadaNoPermitida` si los argumentos de gh no son una lectura permitida.
 * @param {string[]} args Argumentos tal como se pasan a `execFile('gh', args)`.
 */
export function comprobarSoloLectura(args) {
  if (!Array.isArray(args) || args.length < 2 || !args.every((a) => typeof a === 'string')) {
    throw new LlamadaNoPermitida('argumentos con formato no válido');
  }
  const [a, b, ...resto] = args;
  if (a === 'api') {
    if (b !== 'graphql') throw new LlamadaNoPermitida(`gh api ${b}`);
    comprobarGraphql(resto);
    return;
  }
  const spec = SUBCOMANDOS[`${a} ${b}`];
  if (!spec) throw new LlamadaNoPermitida(`gh ${a} ${b}`);
  const posicionales = [];
  const vistas = new Set();
  for (let i = 0; i < resto.length; i++) {
    const x = resto[i];
    if (x.startsWith('-')) {
      if (!Object.hasOwn(spec.flags, x)) throw new LlamadaNoPermitida(`argumento no permitido en gh ${a} ${b}: «${x}»`);
      if (vistas.has(x)) throw new LlamadaNoPermitida(`argumento repetido: «${x}»`);
      vistas.add(x);
      const valor = resto[++i];
      if (typeof valor !== 'string' || !spec.flags[x].test(valor)) throw new LlamadaNoPermitida(`valor no válido para ${x}`);
    } else {
      posicionales.push(x);
    }
  }
  if (posicionales.length !== spec.posicionales.length || !posicionales.every((p, i) => spec.posicionales[i].test(p))) {
    throw new LlamadaNoPermitida(`argumentos posicionales no válidos en gh ${a} ${b}`);
  }
}
