// Cálculo de columnas (sprints) del tablero. Módulo puro.

export const ID_SIN_SPRINT = 'sin-sprint';

/** Suma días a una fecha `AAAA-MM-DD` (en UTC, sin efectos de horario de verano). */
export function sumarDias(fecha, dias) {
  const [a, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

export const ZONA_POR_DEFECTO = 'America/Lima';

/**
 * Fecha `AAAA-MM-DD` de un instante en una zona horaria IANA, sin depender de la zona del
 * equipo (en un runner UTC de la fase 2 la fecha local se adelantaría).
 * @param {Date} fecha
 * @param {string} [zonaHoraria] Por ejemplo «America/Lima». Lanza RangeError si no es válida.
 */
export function fechaEnZona(fecha = new Date(), zonaHoraria = ZONA_POR_DEFECTO) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha);
  const v = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** true si la zona horaria es un identificador IANA que el motor reconoce. */
export function zonaHorariaValida(zona) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return typeof zona === 'string' && zona !== '';
  } catch {
    return false;
  }
}

/**
 * Extrae las iteraciones de un campo de iteración de la respuesta GraphQL del proyecto
 * (`configuration.iterations` + `configuration.completedIterations`).
 * @param {object} respuesta Respuesta de `gh api graphql` (con `data.repositoryOwner.projectV2`).
 * @param {string} nombreCampo Nombre del campo en el tablero (p. ej. «Sprint»).
 * @returns {{ id: string, titulo: string, inicio: string, duracion: number }[] | null}
 *   null si el campo no existe o no es de iteración.
 */
export function iteracionesDesdeGraphql(respuesta, nombreCampo) {
  const nodos = respuesta?.data?.repositoryOwner?.projectV2?.fields?.nodes || [];
  const campo = nodos.find((n) => n && n.name === nombreCampo && n.configuration);
  if (!campo) return null;
  const todas = [...(campo.configuration.iterations || []), ...(campo.configuration.completedIterations || [])];
  return todas.map((it) => ({ id: it.id, titulo: it.title, inicio: it.startDate, duracion: it.duration }));
}

/**
 * Construye la lista de columnas.
 * @param {{ id?: string, titulo: string, inicio?: string|null, duracion?: number|null }[]} iteraciones
 *   Todas las iteraciones del campo, tengan o no tarjetas.
 * @param {{ hoy: string, patronPorDefecto?: string, haySinSprint?: boolean, tituloSinSprint?: string }} opciones
 * @returns {{ id: string, titulo: string, inicio: string|null, fin: string|null, actual: boolean, antiguo: boolean }[]}
 *   Ordenadas por fecha de inicio; «Sin sprint» al final si hace falta.
 */
export function calcularColumnas(iteraciones, opciones) {
  const { hoy, patronPorDefecto, haySinSprint = false, tituloSinSprint = 'Sin sprint' } = opciones;
  const patron = patronPorDefecto ? new RegExp(patronPorDefecto) : null;
  const vistas = new Set();
  const columnas = [];
  for (const it of iteraciones) {
    if (vistas.has(it.titulo)) continue;
    vistas.add(it.titulo);
    const inicio = it.inicio || null;
    const fin = inicio && Number.isFinite(it.duracion) && it.duracion > 0 ? sumarDias(inicio, it.duracion - 1) : null;
    columnas.push({
      id: it.titulo,
      titulo: it.titulo,
      inicio,
      fin,
      actual: Boolean(inicio && fin && hoy >= inicio && hoy <= fin),
      antiguo: patron ? !patron.test(it.titulo) : false,
    });
  }
  columnas.sort((a, b) => {
    if (a.inicio && b.inicio) return a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0;
    if (a.inicio) return -1;
    if (b.inicio) return 1;
    return 0;
  });
  if (haySinSprint) {
    columnas.push({ id: ID_SIN_SPRINT, titulo: tituloSinSprint, inicio: null, fin: null, actual: false, antiguo: false });
  }
  return columnas;
}
