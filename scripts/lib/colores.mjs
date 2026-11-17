// Paleta fija para las categorías. El color de una categoría depende solo de la posición
// de su opción en el campo del tablero, así que no cambia entre ejecuciones.
// Colores pensados para el tema oscuro de la página.

export const PALETA = Object.freeze([
  '#3b82f6', // azul
  '#22c55e', // verde
  '#f59e0b', // ámbar
  '#ef4444', // rojo
  '#a855f7', // violeta
  '#06b6d4', // cian
  '#ec4899', // rosa
  '#84cc16', // lima
  '#f97316', // naranja
  '#14b8a6', // verde azulado
  '#6366f1', // índigo
  '#eab308', // amarillo
  '#d946ef', // fucsia
  '#0ea5e9', // celeste
  '#10b981', // esmeralda
  '#f43f5e', // carmín
]);

/**
 * @param {number} indice Posición de la opción en el campo (desde 0).
 * @returns {string} Color hexadecimal. Si hay más opciones que colores, la paleta se repite.
 */
export function colorPorIndice(indice) {
  const i = Number.isInteger(indice) && indice >= 0 ? indice : 0;
  return PALETA[i % PALETA.length];
}
