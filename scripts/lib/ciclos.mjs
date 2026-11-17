// Detección de referencias circulares en el grafo de dependencias.
// Módulo puro (algoritmo de Tarjan, iterativo para no agotar la pila).

/**
 * @param {Map<string, string[]>} grafo nodo → nodos de los que depende.
 * @returns {string[][]} Cada ciclo es la lista de nodos de una componente fuertemente
 *   conexa con más de un nodo, o un nodo que depende de sí mismo. Los nodos de cada
 *   ciclo salen en el orden de inserción del grafo.
 */
export function detectarCiclos(grafo) {
  const orden = new Map([...grafo.keys()].map((k, i) => [k, i]));
  const indice = new Map();
  const bajo = new Map();
  const enPila = new Set();
  const pila = [];
  const ciclos = [];
  let contador = 0;

  const vecinos = (n) => (grafo.get(n) || []).filter((v) => grafo.has(v));

  for (const raiz of grafo.keys()) {
    if (indice.has(raiz)) continue;
    const trabajo = [{ nodo: raiz, i: 0 }];
    indice.set(raiz, contador);
    bajo.set(raiz, contador);
    contador++;
    pila.push(raiz);
    enPila.add(raiz);

    while (trabajo.length > 0) {
      const marco = trabajo[trabajo.length - 1];
      const lista = vecinos(marco.nodo);
      if (marco.i < lista.length) {
        const w = lista[marco.i++];
        if (!indice.has(w)) {
          indice.set(w, contador);
          bajo.set(w, contador);
          contador++;
          pila.push(w);
          enPila.add(w);
          trabajo.push({ nodo: w, i: 0 });
        } else if (enPila.has(w)) {
          bajo.set(marco.nodo, Math.min(bajo.get(marco.nodo), indice.get(w)));
        }
        continue;
      }
      trabajo.pop();
      if (trabajo.length > 0) {
        const padre = trabajo[trabajo.length - 1].nodo;
        bajo.set(padre, Math.min(bajo.get(padre), bajo.get(marco.nodo)));
      }
      if (bajo.get(marco.nodo) === indice.get(marco.nodo)) {
        const componente = [];
        let w;
        do {
          w = pila.pop();
          enPila.delete(w);
          componente.push(w);
        } while (w !== marco.nodo);
        const autoCiclo = componente.length === 1 && (grafo.get(componente[0]) || []).includes(componente[0]);
        if (componente.length > 1 || autoCiclo) {
          componente.sort((a, b) => orden.get(a) - orden.get(b));
          ciclos.push(componente);
        }
      }
    }
  }
  ciclos.sort((a, b) => orden.get(a[0]) - orden.get(b[0]));
  return ciclos;
}
