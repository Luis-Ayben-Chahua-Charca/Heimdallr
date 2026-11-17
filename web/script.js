// Heimdallr — visor de tableros de GitHub Projects con dependencias (solo lectura).
// Consume window.HEIMDALLR_DATA (esquema 1, ver PROPUESTA.md §4), definido por data.js.
// Regla de seguridad: todo texto que venga de los datos se inserta con textContent
// o como atributo; nunca con innerHTML.
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  /** Crea un elemento. `hijos` acepta nodos o cadenas (que se insertan como texto). */
  function el(etiqueta, atributos, hijos) {
    const nodo = document.createElement(etiqueta);
    if (atributos) {
      for (const [clave, valor] of Object.entries(atributos)) {
        if (valor === undefined || valor === null || valor === false) continue;
        if (clave === 'class') nodo.className = valor;
        else if (clave === 'text') nodo.textContent = valor;
        else nodo.setAttribute(clave, valor === true ? '' : String(valor));
      }
    }
    if (hijos !== undefined && hijos !== null) {
      for (const h of Array.isArray(hijos) ? hijos : [hijos]) {
        if (h === undefined || h === null || h === false) continue;
        nodo.appendChild(typeof h === 'string' || typeof h === 'number' ? document.createTextNode(String(h)) : h);
      }
    }
    return nodo;
  }

  const texto = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

  /** Solo se aceptan enlaces http(s); cualquier otra cosa (javascript:, data:…) se descarta. */
  function urlSegura(v) {
    if (typeof v !== 'string') return '';
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  /** Solo colores hexadecimales; si no, gris neutro. */
  const colorSeguro = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : '#64748b');

  /** Minúsculas y sin tildes, para buscar. */
  const normalizar = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const compararTexto = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' });

  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  const formatoDias = (n) => {
    const r = Math.round(n * 10) / 10;
    return `${String(r).replace('.', ',')} ${r === 1 ? 'día' : 'días'}`;
  };

  const porcentaje = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

  /** «2026-11-08» → «08/11». Sin conversión de zona horaria. */
  function fechaCorta(iso) {
    const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}` : '';
  }

  /** Iniciales de un login de GitHub: «FrancoCalcinaFlores» → «FC», «beto-quispe» → «BQ». */
  function iniciales(login) {
    const partes = String(login)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+/)
      .filter(Boolean);
    if (partes.length === 0) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  /** Color estable por persona (sin cargar avatares remotos). */
  function colorPersona(login) {
    let h = 0;
    for (const c of String(login)) h = (h * 31 + c.codePointAt(0)) % 360;
    return `hsl(${h}, 45%, 34%)`;
  }

  // ---------------------------------------------------------------------------
  // Sin datos
  // ---------------------------------------------------------------------------

  const DATOS = window.HEIMDALLR_DATA;

  function mostrarSinDatos(detalle) {
    document.title = 'Heimdallr: sin datos';
    for (const id of ['barraControles', 'barraAvance', 'pie', 'lienzo']) {
      const n = $(id);
      if (n) n.hidden = true;
    }
    $('btnAvisos').hidden = true;
    $('btnConexiones').hidden = true;
    const msg = $('mensajeTablero');
    msg.hidden = false;
    msg.textContent = '';
    msg.appendChild(el('h2', { text: 'No hay datos que mostrar' }));
    msg.appendChild(el('p', null, [
      'No se encontró ',
      el('code', { text: 'web/data.js' }),
      ' o no define ',
      el('code', { text: 'window.HEIMDALLR_DATA' }),
      '. Ejecuta en la carpeta del proyecto:'
    ]));
    msg.appendChild(el('p', null, el('code', { text: 'node scripts/actualizar.mjs' })));
    msg.appendChild(el('p', { text: 'y vuelve a abrir (o recarga) esta página.' }));
    if (detalle) msg.appendChild(el('p', { class: 'sin-dato', text: detalle }));
  }

  if (!DATOS || typeof DATOS !== 'object' || !Array.isArray(DATOS.tarjetas)) {
    mostrarSinDatos(DATOS ? 'El archivo de datos no tiene la lista «tarjetas».' : '');
    return;
  }

  // ---------------------------------------------------------------------------
  // Modelo: normalización y reglas calculadas
  // ---------------------------------------------------------------------------

  const fuente = DATOS.fuente && typeof DATOS.fuente === 'object' ? DATOS.fuente : {};
  const categorias = DATOS.categorias && typeof DATOS.categorias === 'object' ? DATOS.categorias : {};
  const avisosDatos = Array.isArray(DATOS.avisos) ? DATOS.avisos.map(texto).filter(Boolean) : [];
  const avisosCalculados = [];

  if (DATOS.esquema !== 1) {
    avisosCalculados.push(`El archivo de datos usa el esquema ${texto(String(DATOS.esquema)) || 'desconocido'}; esta página espera el esquema 1. Algunos datos podrían no mostrarse.`);
  }

  const ID_FUERA = '__fuera';
  const ID_SIN = '__sin';
  const NADIE = '__nadie';
  const OTROS = '__otros';

  const ESTADOS = {
    'Todo': { texto: 'Por hacer', clase: 'todo' },
    'In Progress': { texto: 'En curso', clase: 'curso' },
    'Done': { texto: 'Terminada', clase: 'hecha' }
  };

  /**
   * Fecha de hoy como «AAAA-MM-DD» en la zona horaria del proyecto (`fuente.zonaHoraria`,
   * p. ej. «America/Lima») o, si no viene o no es válida, en la zona local del navegador.
   */
  function hoyISO() {
    const zona = texto(fuente.zonaHoraria);
    const opciones = { year: 'numeric', month: '2-digit', day: '2-digit' };
    let partes;
    try {
      partes = new Intl.DateTimeFormat('en-CA', zona ? { ...opciones, timeZone: zona } : opciones).formatToParts(new Date());
    } catch (e) {
      if (zona) avisosCalculados.push(`La zona horaria «${zona}» de los datos no es válida; se usa la del navegador para calcular el sprint actual.`);
      partes = new Intl.DateTimeFormat('en-CA', opciones).formatToParts(new Date());
    }
    const p = (tipo) => (partes.find((x) => x.type === tipo) || {}).value || '';
    return `${p('year')}-${p('month')}-${p('day')}`;
  }
  const HOY = hoyISO();
  const esFechaISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  /**
   * Columnas declaradas en los datos (en su orden). El sprint actual se recalcula con
   * inicio/fin y la fecha de hoy; solo si faltan las fechas se usa `actual` del dato.
   */
  const columnasDatos = (Array.isArray(DATOS.columnas) ? DATOS.columnas : [])
    .filter((c) => c && c.id !== undefined && c.id !== null)
    .map((c) => {
      const inicio = texto(c.inicio).slice(0, 10);
      const fin = texto(c.fin).slice(0, 10);
      const conFechas = esFechaISO(inicio) && esFechaISO(fin);
      return {
        id: String(c.id),
        titulo: texto(c.titulo) || String(c.id),
        inicio,
        fin,
        actual: conFechas ? inicio <= HOY && HOY <= fin : c.actual === true,
        antiguo: c.antiguo === true,
        tipo: 'sprint'
      };
    });
  const columnaPorId = new Map(columnasDatos.map((c) => [c.id, c]));

  /**
   * Identidad de una tarjeta: «repo#número». En tableros de organización el mismo número
   * puede existir en repositorios distintos, así que el número solo no basta.
   */
  const claveDe = (repo, numero) => `${repo}#${numero}`;

  /** Tarjetas normalizadas, indexadas por su clave «repo#número». */
  const tarjetas = [];
  const porClave = new Map();
  for (const bruta of DATOS.tarjetas) {
    if (!bruta || typeof bruta !== 'object') continue;
    const id = Number(bruta.id);
    if (!Number.isFinite(id)) continue;
    const repo = texto(bruta.repo);
    const clave = claveDe(repo, id);
    if (porClave.has(clave)) {
      avisosCalculados.push(`El issue ${repo ? repo : ''}#${id} aparece repetido en los datos; se muestra solo la primera tarjeta.`);
      continue;
    }
    const fuera = bruta.fueraDelTablero === true;
    const t = {
      id,
      clave,
      repo,
      titulo: texto(bruta.titulo) || '(sin título)',
      url: urlSegura(bruta.url),
      estado: texto(bruta.estado),
      columnaOriginal: bruta.columna === undefined || bruta.columna === null ? null : String(bruta.columna),
      categoria: texto(bruta.categoria),
      rol: texto(bruta.rol),
      tipo: texto(bruta.tipo),
      prioridad: texto(bruta.prioridad),
      asignados: Array.isArray(bruta.asignados) ? bruta.asignados.map(texto).filter(Boolean) : [],
      etiquetas: Array.isArray(bruta.etiquetas) ? bruta.etiquetas.map(texto).filter(Boolean) : [],
      estimacionDias: typeof bruta.estimacionDias === 'number' && Number.isFinite(bruta.estimacionDias) ? bruta.estimacionDias : null,
      prs: Array.isArray(bruta.prs)
        ? bruta.prs.filter((p) => p && typeof p === 'object').map((p) => ({ numero: Number(p.numero), url: urlSegura(p.url) }))
        : [],
      dependeDe: Array.isArray(bruta.dependeDe)
        ? [...new Set(bruta.dependeDe.map(Number).filter(Number.isFinite))]
        : [],
      fuera,
      // Calculados más abajo:
      columna: null,
      pred: [],
      suc: [],
      faltantes: [],
      bloqueada: false,
      lista: false,
      enCiclo: false,
      busqueda: ''
    };
    // Columna en la que se dibuja.
    if (fuera) t.columna = ID_FUERA;
    else if (t.columnaOriginal !== null && columnaPorId.has(t.columnaOriginal)) t.columna = t.columnaOriginal;
    else {
      t.columna = ID_SIN;
      if (t.columnaOriginal !== null) {
        avisosCalculados.push(`La tarjeta ${repo}#${id} está en la columna «${t.columnaOriginal}», que no figura en la lista de columnas; se muestra en «Sin sprint».`);
      }
    }
    tarjetas.push(t);
    porClave.set(clave, t);
  }

  /** ¿Hay tarjetas de más de un repositorio? Solo entonces se muestra el repo. */
  const repos = new Set(tarjetas.map((t) => t.repo));
  const variosRepos = repos.size > 1;
  /** Nombre corto del repositorio («dueño/app» → «app»). */
  const repoCorto = (repo) => repo.split('/').pop() || repo;
  /** Cómo se nombra una tarjeta en pantalla: «#87» o, con varios repos, «app#87». */
  const nombreNumero = (repo, numero) => (variosRepos && repo ? `${repoCorto(repo)}#${numero}` : `#${numero}`);
  const numeroDe = (t) => nombreNumero(t.repo, t.id);

  for (const t of tarjetas) {
    t.busqueda = normalizar(`#${t.id} ${variosRepos ? t.repo + ' ' + repoCorto(t.repo) + '#' + t.id : ''} ${t.titulo} ${t.asignados.join(' ')}`);
  }

  // Grafo: predecesoras (dependeDe) y sucesoras (a quién desbloquea).
  // «Depende de» siempre apunta al mismo repositorio de la tarjeta (PROPUESTA §3.4).
  for (const t of tarjetas) {
    for (const numero of t.dependeDe) {
      const d = claveDe(t.repo, numero);
      const dep = porClave.get(d);
      if (dep) {
        t.pred.push(d);
        dep.suc.push(t.clave);
      } else {
        t.faltantes.push(numero);
      }
    }
  }
  for (const t of tarjetas) {
    if (t.faltantes.length) {
      avisosCalculados.push(`La tarjeta ${numeroDe(t)} depende de ${t.faltantes.map((f) => nombreNumero(t.repo, f)).join(', ')}, que no está disponible en los datos (no llegó al modelo o no se pudo consultar). Se considera sin terminar.`);
    }
  }

  /** Orden estable: por número y, a igualdad, por repositorio. */
  const ordenTarjetas = (a, b) => a.id - b.id || compararTexto(a.repo, b.repo);

  /** Una dependencia cuenta como terminada si está Done (o Closed si está fuera del tablero). */
  const terminada = (t) => (t.fuera ? t.estado.toLowerCase() === 'closed' : t.estado === 'Done');

  for (const t of tarjetas) {
    if (t.fuera) continue;
    const pendientes = t.pred.some((c) => !terminada(porClave.get(c))) || t.faltantes.length > 0;
    t.bloqueada = t.estado !== 'Done' && pendientes;
    t.lista = t.estado === 'Todo' && !pendientes;
  }

  /**
   * Ciclos: componentes fuertemente conexas (Tarjan iterativo, sin recursión),
   * así un ciclo nunca provoca un bucle infinito ni desborda la pila.
   */
  function detectarCiclos() {
    let indice = 0;
    const idx = new Map();
    const bajo = new Map();
    const enPila = new Set();
    const pila = [];
    const ciclos = [];
    for (const inicio of tarjetas) {
      if (idx.has(inicio.clave)) continue;
      const llamadas = [[inicio.clave, 0]];
      idx.set(inicio.clave, indice);
      bajo.set(inicio.clave, indice++);
      pila.push(inicio.clave);
      enPila.add(inicio.clave);
      while (llamadas.length) {
        const marco = llamadas[llamadas.length - 1];
        const v = marco[0];
        const vecinos = porClave.get(v).pred;
        if (marco[1] < vecinos.length) {
          const w = vecinos[marco[1]++];
          if (!idx.has(w)) {
            idx.set(w, indice);
            bajo.set(w, indice++);
            pila.push(w);
            enPila.add(w);
            llamadas.push([w, 0]);
          } else if (enPila.has(w)) {
            bajo.set(v, Math.min(bajo.get(v), idx.get(w)));
          }
        } else {
          llamadas.pop();
          if (llamadas.length) {
            const u = llamadas[llamadas.length - 1][0];
            bajo.set(u, Math.min(bajo.get(u), bajo.get(v)));
          }
          if (bajo.get(v) === idx.get(v)) {
            const comp = [];
            let w;
            do {
              w = pila.pop();
              enPila.delete(w);
              comp.push(w);
            } while (w !== v);
            if (comp.length > 1 || porClave.get(v).pred.includes(v)) ciclos.push(comp);
          }
        }
      }
    }
    return ciclos;
  }

  for (const comp of detectarCiclos()) {
    const enCiclo = comp.map((c) => porClave.get(c)).sort(ordenTarjetas);
    for (const t of enCiclo) t.enCiclo = true;
    avisosCalculados.push(enCiclo.length === 1
      ? `La tarjeta ${numeroDe(enCiclo[0])} depende de sí misma.`
      : `Ciclo de dependencias entre ${enCiclo.map(numeroDe).join(', ')}.`);
  }

  /** Recorre el grafo en anchura con conjunto de visitados (seguro ante ciclos). */
  function alcanzables(clave, campo) {
    const vistos = new Set();
    const cola = porClave.get(clave)[campo].slice();
    while (cola.length) {
      const c = cola.pop();
      if (c === clave || vistos.has(c)) continue;
      vistos.add(c);
      for (const n of porClave.get(c)[campo]) if (!vistos.has(n)) cola.push(n);
    }
    return vistos;
  }

  /** Texto e insignia del estado. */
  function infoEstado(t) {
    if (t.fuera) {
      return t.estado.toLowerCase() === 'closed'
        ? { texto: 'Cerrado', clase: 'cerrado' }
        : { texto: t.estado.toLowerCase() === 'open' ? 'Abierto' : (t.estado || 'Sin estado'), clase: 'abierto' };
    }
    return ESTADOS[t.estado] || { texto: t.estado || 'Sin estado', clase: 'otro' };
  }

  const nombreCategoria = (k) => (categorias[k] && texto(categorias[k].nombre)) || k;
  const colorCategoria = (k) => colorSeguro(categorias[k] && categorias[k].color);

  // ---------------------------------------------------------------------------
  // Columnas visibles
  // ---------------------------------------------------------------------------

  const hayFuera = tarjetas.some((t) => t.columna === ID_FUERA);
  const haySin = tarjetas.some((t) => t.columna === ID_SIN);
  const columnas = [];
  // «Fuera del tablero» a la izquierda: casi siempre son predecesoras.
  if (hayFuera) columnas.push({ id: ID_FUERA, titulo: 'Fuera del tablero', tipo: 'fuera', actual: false, antiguo: false });
  columnas.push(...columnasDatos);
  if (haySin) columnas.push({ id: ID_SIN, titulo: 'Sin sprint', tipo: 'sin', actual: false, antiguo: false });
  const ordenColumna = new Map(columnas.map((c, i) => [c.id, i]));

  // ---------------------------------------------------------------------------
  // Estado de la interfaz y persistencia ligera (solo filtros y conexiones globales)
  // ---------------------------------------------------------------------------

  const CLAVE_LS = `heimdallr:v1:${texto(fuente.dueno)}/${texto(String(fuente.proyecto ?? ''))}`;

  const filtrosVacios = () => ({
    categoria: '',
    rol: '',
    asignado: '',
    estado: '',
    soloBloqueadas: false,
    soloListas: false,
    incluirAntiguos: false
  });

  let filtros = filtrosVacios();
  let busqueda = '';
  let conexionesGlobales = false;
  let seleccion = null; // clave fijada con clic
  let hover = null; // clave bajo el cursor o con el foco
  let desplegado = null; // id de la columna en vista desplegada (o null)
  let desplegadoGuardado = null; // el que venía en localStorage

  function leerPreferencias() {
    try {
      const v = JSON.parse(localStorage.getItem(CLAVE_LS) || 'null');
      return v && typeof v === 'object' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function guardarPreferencias() {
    try {
      localStorage.setItem(CLAVE_LS, JSON.stringify({ filtros, conexionesGlobales, desplegado }));
    } catch (e) {
      /* almacenamiento no disponible: se ignora */
    }
  }

  // ---------------------------------------------------------------------------
  // Referencias al DOM
  // ---------------------------------------------------------------------------

  const rejilla = $('rejilla');
  const lienzo = $('lienzo');
  const tablero = $('tablero');
  const svg = $('svgConexiones');
  const grupoLineas = $('grupoLineas');
  const buscador = $('buscador');
  const selCategoria = $('filtroCategoria');
  const selRol = $('filtroRol');
  const selAsignado = $('filtroAsignado');
  const selEstado = $('filtroEstado');
  const chkBloqueadas = $('filtroBloqueadas');
  const chkListas = $('filtroListas');
  const chkAntiguos = $('filtroAntiguos');
  const btnConexiones = $('btnConexiones');
  const btnAvisos = $('btnAvisos');
  const btnLimpiar = $('btnLimpiar');

  const elementoTarjeta = new Map(); // clave → elemento
  const elementoColumna = new Map(); // id de columna → { col, cuerpo, vacia }

  // ---------------------------------------------------------------------------
  // Cabecera
  // ---------------------------------------------------------------------------

  function pintarCabecera() {
    const titulo = texto(fuente.titulo) || 'Tablero sin título';
    $('tituloProyecto').textContent = titulo;
    document.title = `${titulo} · Heimdallr`;

    const fp = $('fuenteProyecto');
    fp.textContent = '';
    const dueno = texto(fuente.dueno);
    const proyecto = texto(String(fuente.proyecto ?? ''));
    const etiqueta = [dueno, proyecto ? `proyecto #${proyecto}` : ''].filter(Boolean).join(' · ');
    const url = urlSegura(fuente.url);
    if (etiqueta) {
      fp.appendChild(url
        ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: `${etiqueta} (GitHub)` })
        : document.createTextNode(etiqueta));
    }

    // Fecha de generación y aviso de datos viejos (> 24 h).
    const fd = $('fechaDatos');
    const fecha = new Date(texto(DATOS.generado));
    if (Number.isNaN(fecha.getTime())) {
      fd.textContent = 'Datos generados: fecha desconocida';
      fd.classList.add('desactualizada');
      return;
    }
    const horas = (Date.now() - fecha.getTime()) / 36e5;
    let hace;
    if (horas < 0) hace = 'fecha futura';
    else if (horas < 1) hace = 'hace menos de una hora';
    else if (horas < 48) hace = `hace ${plural(Math.floor(horas), 'hora', 'horas')}`;
    else hace = `hace ${plural(Math.floor(horas / 24), 'día', 'días')}`;
    let legible;
    try {
      legible = fecha.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      legible = fecha.toISOString();
    }
    fd.textContent = `Datos generados: ${legible} (${hace})`;
    if (horas > 24) {
      fd.classList.add('desactualizada');
      fd.textContent += ' · tienen más de 24 h: ejecuta node scripts/actualizar.mjs';
    }
  }

  function pintarBotonAvisos() {
    const n = avisosDatos.length + avisosCalculados.length;
    btnAvisos.textContent = n ? `Avisos (${n})` : 'Sin avisos';
    btnAvisos.setAttribute('aria-label', n ? `Ver ${plural(n, 'aviso', 'avisos')} de los datos` : 'No hay avisos; ver detalle');
    btnAvisos.classList.toggle('con-avisos', n > 0);
  }

  /** Avance global sobre todas las tarjetas del tablero (sin filtros ni nodos externos). */
  function pintarAvance() {
    const delTablero = tarjetas.filter((t) => !t.fuera);
    const hechas = delTablero.filter((t) => t.estado === 'Done');
    const pIssues = porcentaje(hechas.length, delTablero.length);
    $('avanceIssuesRelleno').style.width = pIssues + '%';
    $('avanceIssues').setAttribute('aria-valuenow', String(pIssues));
    $('avanceIssuesTexto').textContent = `${hechas.length} / ${delTablero.length} (${pIssues} %)`;

    const conEstimacion = delTablero.filter((t) => t.estimacionDias !== null);
    const diasTotal = conEstimacion.reduce((s, t) => s + t.estimacionDias, 0);
    const diasHechos = conEstimacion.filter((t) => t.estado === 'Done').reduce((s, t) => s + t.estimacionDias, 0);
    const pDias = porcentaje(diasHechos, diasTotal);
    $('avanceDiasRelleno').style.width = pDias + '%';
    $('avanceDias').setAttribute('aria-valuenow', String(pDias));
    $('avanceDiasTexto').textContent = conEstimacion.length
      ? `${formatoDias(diasHechos).replace(/ días?$/, '')} / ${formatoDias(diasTotal)} (${pDias} %)` +
        (conEstimacion.length < delTablero.length ? ` · ${delTablero.length - conEstimacion.length} sin estimación` : '')
      : 'sin estimaciones';
  }

  // ---------------------------------------------------------------------------
  // Filtros: opciones de los selectores
  // ---------------------------------------------------------------------------

  function opciones(select, primera, lista) {
    select.textContent = '';
    select.appendChild(el('option', { value: '', text: primera }));
    for (const [valor, etiqueta] of lista) select.appendChild(el('option', { value: valor, text: etiqueta }));
  }

  function poblarFiltros() {
    const tab = tarjetas.filter((t) => !t.fuera);

    const cats = Object.keys(categorias);
    for (const t of tab) if (t.categoria && !cats.includes(t.categoria)) cats.push(t.categoria);
    const listaCats = cats.map((k) => [k, nombreCategoria(k) === k ? k : `${k} · ${nombreCategoria(k)}`]);
    if (tab.some((t) => !t.categoria)) listaCats.push([NADIE, 'Sin categoría']);
    opciones(selCategoria, 'Todas las categorías', listaCats);

    const roles = [...new Set(tab.map((t) => t.rol).filter(Boolean))].sort(compararTexto);
    const listaRoles = roles.map((r) => [r, r]);
    if (tab.some((t) => !t.rol)) listaRoles.push([NADIE, 'Sin rol']);
    opciones(selRol, 'Todos los roles', listaRoles);

    const personas = [...new Set(tab.flatMap((t) => t.asignados))].sort(compararTexto);
    const listaPersonas = personas.map((p) => [p, p]);
    if (tab.some((t) => t.asignados.length === 0)) listaPersonas.push([NADIE, 'Sin asignar']);
    opciones(selAsignado, 'Todas las personas', listaPersonas);

    const listaEstados = [['Todo', 'Por hacer'], ['In Progress', 'En curso'], ['Done', 'Terminada']];
    const otros = [...new Set(tab.map((t) => t.estado).filter((e) => !ESTADOS[e]))];
    if (otros.length) listaEstados.push([OTROS, `Otros (${otros.map((e) => e || 'sin estado').join(', ')})`]);
    if (hayFuera) listaEstados.push([ID_FUERA, 'Fuera del tablero']);
    opciones(selEstado, 'Todos los estados', listaEstados);
  }

  /** Aplica a los controles los filtros guardados, descartando valores que ya no existen. */
  function restaurarPreferencias() {
    const guardado = leerPreferencias();
    if (!guardado) return;
    const f = guardado.filtros && typeof guardado.filtros === 'object' ? guardado.filtros : {};
    const valido = (select, v) => typeof v === 'string' && [...select.options].some((o) => o.value === v);
    filtros = {
      categoria: valido(selCategoria, f.categoria) ? f.categoria : '',
      rol: valido(selRol, f.rol) ? f.rol : '',
      asignado: valido(selAsignado, f.asignado) ? f.asignado : '',
      estado: valido(selEstado, f.estado) ? f.estado : '',
      soloBloqueadas: f.soloBloqueadas === true,
      soloListas: f.soloListas === true && f.soloBloqueadas !== true,
      incluirAntiguos: f.incluirAntiguos === true
    };
    conexionesGlobales = guardado.conexionesGlobales === true;
    desplegadoGuardado = typeof guardado.desplegado === 'string' ? guardado.desplegado : null;
  }

  function sincronizarControles() {
    selCategoria.value = filtros.categoria;
    selRol.value = filtros.rol;
    selAsignado.value = filtros.asignado;
    selEstado.value = filtros.estado;
    chkBloqueadas.checked = filtros.soloBloqueadas;
    chkListas.checked = filtros.soloListas;
    chkAntiguos.checked = filtros.incluirAntiguos;
    for (const s of [selCategoria, selRol, selAsignado, selEstado]) s.classList.toggle('activo', s.value !== '');
    buscador.classList.toggle('activo', busqueda !== '');
    btnConexiones.setAttribute('aria-pressed', String(conexionesGlobales));
    btnConexiones.textContent = conexionesGlobales ? 'Ocultar conexiones globales' : 'Mostrar conexiones globales';
    btnConexiones.setAttribute('aria-label', btnConexiones.textContent);
    pintarLeyenda();
  }

  // ---------------------------------------------------------------------------
  // Construcción del tablero (una sola vez; los filtros solo cambian clases)
  // ---------------------------------------------------------------------------

  function crearTarjeta(t) {
    const est = infoEstado(t);
    const clases = ['tarjeta', `estado-${est.clase}`];
    if (t.fuera) clases.push('fuera');

    const etiquetasAria = [numeroDe(t), variosRepos && t.repo ? `repositorio ${t.repo}` : null, t.titulo, est.texto];
    if (t.fuera) etiquetasAria.push('fuera del tablero');
    if (t.bloqueada) etiquetasAria.push('bloqueada');
    if (t.lista) etiquetasAria.push('lista para tomar');
    if (t.enCiclo) etiquetasAria.push('en un ciclo de dependencias');

    const nodo = el('div', {
      class: clases.join(' '),
      tabindex: '0',
      role: 'button',
      'aria-haspopup': 'dialog',
      'aria-label': etiquetasAria.filter(Boolean).join(', '),
      'data-clave': t.clave
    });

    const tira = el('span', { class: 'tarjeta-categoria', 'aria-hidden': 'true' });
    if (t.categoria) tira.style.backgroundColor = colorCategoria(t.categoria);
    nodo.appendChild(tira);

    nodo.appendChild(el('div', { class: 'tarjeta-cabecera' }, [
      el('span', { class: 'tarjeta-numero', text: numeroDe(t), title: t.repo || null }),
      t.categoria ? el('span', { class: 'tarjeta-codigo-categoria', text: t.categoria, title: nombreCategoria(t.categoria) }) : null,
      t.estimacionDias !== null
        ? el('span', { class: 'tarjeta-estimacion', text: `${String(t.estimacionDias).replace('.', ',')} d`, title: `Estimación: ${formatoDias(t.estimacionDias)}` })
        : null
    ]));

    nodo.appendChild(el('div', { class: 'tarjeta-titulo', title: t.titulo, text: t.titulo }));

    const pie = el('div', { class: 'tarjeta-pie' });
    pie.appendChild(el('span', { class: `insignia insignia-${est.clase}`, text: est.texto }));
    if (t.bloqueada) pie.appendChild(el('span', { class: 'insignia insignia-bloqueada', text: 'Bloqueada' }));
    if (t.lista) pie.appendChild(el('span', { class: 'insignia insignia-lista', text: 'Lista' }));
    if (t.enCiclo) pie.appendChild(el('span', { class: 'insignia insignia-ciclo', text: 'Ciclo', title: 'Forma parte de un ciclo de dependencias' }));
    if (t.pred.length || t.suc.length || t.faltantes.length) {
      pie.appendChild(el('span', {
        class: 'tarjeta-relaciones',
        title: `Depende de ${t.pred.length + t.faltantes.length} · desbloquea ${t.suc.length}`,
        text: `↤${t.pred.length + t.faltantes.length} ↦${t.suc.length}`
      }));
    }
    if (t.asignados.length) {
      const av = el('span', { class: 'avatares', title: t.asignados.join(', '), 'aria-hidden': 'true' });
      for (const p of t.asignados.slice(0, 2)) {
        const a = el('span', { class: 'avatar', text: iniciales(p) });
        a.style.backgroundColor = colorPersona(p);
        av.appendChild(a);
      }
      if (t.asignados.length > 2) av.appendChild(el('span', { class: 'avatar avatar-mas', text: `+${t.asignados.length - 2}` }));
      pie.appendChild(av);
    }
    nodo.appendChild(pie);
    return nodo;
  }

  function construirTablero() {
    rejilla.textContent = '';
    if (tarjetas.length === 0) {
      const msg = $('mensajeTablero');
      msg.hidden = false;
      msg.textContent = '';
      msg.appendChild(el('h2', { text: 'El tablero no tiene tarjetas' }));
      msg.appendChild(el('p', { text: 'Los datos se cargaron, pero la lista de tarjetas está vacía.' }));
    }

    const porColumna = new Map(columnas.map((c) => [c.id, []]));
    for (const t of tarjetas) porColumna.get(t.columna).push(t);

    for (const c of columnas) {
      const lista = porColumna.get(c.id).sort(ordenTarjetas);
      const clases = ['columna'];
      if (c.actual) clases.push('actual');
      if (c.antiguo) clases.push('antigua');
      if (c.tipo === 'fuera') clases.push('fuera');
      const col = el('section', { class: clases.join(' '), 'data-columna': c.id, 'aria-label': `Columna ${c.titulo}` });

      // Encabezado con avance del sprint.
      const cab = el('div', { class: 'columna-cabecera' });
      const titulo = el('h2', { class: 'columna-titulo', tabindex: '-1' }, [
        el('span', { class: 'columna-nombre', text: c.titulo }),
        c.actual ? el('span', { class: 'marca-actual', text: 'Sprint actual' }) : null,
        c.antiguo ? el('span', { class: 'marca-antigua', text: 'anterior' }) : null
      ]);
      // Botón «Desplegar» / «Contraer» de la vista desplegada.
      const boton = el('button', {
        type: 'button',
        class: 'boton-desplegar',
        'aria-expanded': 'false',
        'aria-label': `Desplegar sprint ${c.titulo}`
      }, [el('span', { class: 'icono', 'aria-hidden': 'true', text: '⤢' }), el('span', { class: 'boton-desplegar-texto', text: 'Desplegar' })]);
      boton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (desplegado === c.id) contraer();
        else desplegar(c.id);
      });
      cab.appendChild(el('div', { class: 'columna-cabecera-fila' }, [titulo, boton]));
      if (c.inicio || c.fin) {
        cab.appendChild(el('div', { class: 'columna-fechas', text: [fechaCorta(c.inicio), fechaCorta(c.fin)].filter(Boolean).join(' – ') }));
      }
      if (c.tipo === 'fuera') {
        const cerrados = lista.filter((t) => terminada(t)).length;
        cab.appendChild(el('div', { class: 'columna-avance', text: `${plural(lista.length, 'issue', 'issues')} · ${cerrados} cerrados` }));
      } else {
        const hechas = lista.filter((t) => t.estado === 'Done');
        const conDias = lista.filter((t) => t.estimacionDias !== null);
        const dTotal = conDias.reduce((s, t) => s + t.estimacionDias, 0);
        const dHechos = conDias.filter((t) => t.estado === 'Done').reduce((s, t) => s + t.estimacionDias, 0);
        const p = porcentaje(hechas.length, lista.length);
        cab.appendChild(el('div', { class: 'columna-avance', text: `${hechas.length}/${lista.length} terminadas` + (conDias.length ? ` · ${String(Math.round(dHechos * 10) / 10).replace('.', ',')}/${formatoDias(dTotal)}` : '') }));
        const barra = el('div', {
          class: 'columna-barra',
          role: 'progressbar',
          'aria-label': `Avance de ${c.titulo}`,
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(p)
        });
        const relleno = el('div');
        relleno.style.width = p + '%';
        barra.appendChild(relleno);
        cab.appendChild(barra);
      }
      col.appendChild(cab);

      // Franja que se muestra cuando otra columna está desplegada (clic = desplegar esta).
      const terminadas = lista.filter((t) => terminada(t)).length;
      const franja = el('button', {
        type: 'button',
        class: 'franja',
        'aria-label': `Desplegar ${c.tipo === 'sprint' ? 'sprint ' : ''}${c.titulo} (${terminadas} de ${lista.length} terminadas)`
      }, [
        el('span', { class: 'franja-nombre', text: c.titulo }),
        el('span', { class: 'franja-avance', text: `${terminadas}/${lista.length}` })
      ]);
      franja.addEventListener('click', (e) => {
        e.stopPropagation();
        desplegar(c.id);
      });
      col.appendChild(franja);

      for (const t of lista) {
        const nodo = crearTarjeta(t);
        elementoTarjeta.set(t.clave, nodo);
        col.appendChild(nodo);
      }
      const vacia = el('div', { class: 'columna-vacia', text: lista.length ? 'Ninguna tarjeta coincide con los filtros' : 'Sin tarjetas' });
      col.appendChild(vacia);
      elementoColumna.set(c.id, { col, vacia, def: c, lista, titulo, boton, franja });
      rejilla.appendChild(col);
    }
  }

  // ---------------------------------------------------------------------------
  // Aplicación de filtros
  // ---------------------------------------------------------------------------

  const visibles = new Set();

  function columnaVisible(c) {
    return !c.antiguo || filtros.incluirAntiguos;
  }

  /** «#13» busca exactamente el issue 13; cualquier otro texto busca en número, título y asignados. */
  function coincideBusqueda(t, q) {
    const numero = q.match(/^#(\d+)$/);
    return numero ? t.id === Number(numero[1]) : t.busqueda.includes(q);
  }

  function coincideTablero(t, q) {
    const col = columnaPorId.get(t.columna);
    if (col && !columnaVisible(col)) return false;
    if (q && !coincideBusqueda(t, q)) return false;
    if (filtros.categoria && (filtros.categoria === NADIE ? t.categoria !== '' : t.categoria !== filtros.categoria)) return false;
    if (filtros.rol && (filtros.rol === NADIE ? t.rol !== '' : t.rol !== filtros.rol)) return false;
    if (filtros.asignado && (filtros.asignado === NADIE ? t.asignados.length > 0 : !t.asignados.includes(filtros.asignado))) return false;
    if (filtros.estado) {
      if (filtros.estado === ID_FUERA) return false;
      if (filtros.estado === OTROS ? Boolean(ESTADOS[t.estado]) : t.estado !== filtros.estado) return false;
    }
    if (filtros.soloBloqueadas && !t.bloqueada) return false;
    if (filtros.soloListas && !t.lista) return false;
    return true;
  }

  function aplicarFiltros() {
    const q = normalizar(busqueda.trim());
    visibles.clear();
    // 1) Tarjetas del tablero.
    for (const t of tarjetas) if (!t.fuera && coincideTablero(t, q)) visibles.add(t.clave);
    // 2) Nodos fuera del tablero: se ven si alguna sucesora visible depende de ellos,
    //    si coinciden con la búsqueda, o si se filtra por «Fuera del tablero».
    for (const t of tarjetas) {
      if (!t.fuera) continue;
      let ver;
      if (filtros.estado === ID_FUERA) ver = !q || coincideBusqueda(t, q);
      else ver = t.suc.some((s) => visibles.has(s)) || (q !== '' && coincideBusqueda(t, q) && !filtros.soloBloqueadas && !filtros.soloListas && !filtros.estado);
      if (ver) visibles.add(t.clave);
    }
    // Un sprint antiguo desplegado se contrae si se dejan de incluir los sprints anteriores.
    if (desplegado && !columnaVisible(elementoColumna.get(desplegado).def)) {
      quitarDespliegue();
      reflejarDespliegue();
    }

    // Vista normal: lo que no coincide se oculta. Vista desplegada: se atenúa (el grafo no cambia de forma).
    for (const [clave, nodo] of elementoTarjeta) {
      const coincide = visibles.has(clave);
      const enDespliegue = desplegado !== null && porClave.get(clave).columna === desplegado;
      const filtrada = enDespliegue && !coincide;
      nodo.classList.toggle('oculta', !enDespliegue && !coincide);
      nodo.classList.toggle('filtrada', filtrada);
      nodo.setAttribute('tabindex', filtrada ? '-1' : '0');
    }
    for (const m of minisActivas()) m.nodo.classList.toggle('filtrada', m.clave !== null && !visibles.has(m.clave));

    // Columnas: las antiguas se ocultan; la de «Fuera del tablero» solo si queda vacía (salvo si está desplegada).
    for (const [id, info] of elementoColumna) {
      const hay = tarjetas.some((t) => t.columna === id && visibles.has(t.clave));
      const ocultar = !columnaVisible(info.def) || (id === ID_FUERA && !hay && id !== desplegado);
      info.col.hidden = ocultar;
      info.vacia.hidden = hay || desplegado !== null;
    }

    const totalTablero = tarjetas.filter((t) => !t.fuera).length;
    const vistasTablero = tarjetas.filter((t) => !t.fuera && visibles.has(t.clave)).length;
    $('contadorVisibles').textContent = `Mostrando ${vistasTablero} de ${plural(totalTablero, 'tarjeta', 'tarjetas')}`;

    if (seleccion && !estaALaVista(seleccion)) seleccion = null;
    if (hover && !estaALaVista(hover) && !esMiniActiva(hover)) hover = null;
    actualizarResaltado();
  }

  /** ¿La tarjeta se ve en pantalla? En la vista desplegada, las del sprint desplegado (aunque estén atenuadas). */
  function estaALaVista(clave) {
    if (desplegado !== null) return porClave.get(clave).columna === desplegado;
    return visibles.has(clave);
  }

  // ---------------------------------------------------------------------------
  // Resaltado de predecesoras y sucesoras
  // ---------------------------------------------------------------------------

  let resaltadoActual = { objetivo: null, pred: new Set(), suc: new Set() };

  function actualizarResaltado() {
    const objetivo = seleccion || hover;
    const pred = objetivo ? alcanzables(objetivo, 'pred') : new Set();
    const suc = objetivo ? alcanzables(objetivo, 'suc') : new Set();
    resaltadoActual = { objetivo, pred, suc };
    for (const [clave, nodo] of elementoTarjeta) {
      const esObjetivo = clave === objetivo;
      nodo.classList.toggle('res-objetivo', esObjetivo);
      nodo.classList.toggle('res-pred', !esObjetivo && pred.has(clave));
      nodo.classList.toggle('res-suc', !esObjetivo && !pred.has(clave) && suc.has(clave));
      nodo.classList.toggle('atenuada', Boolean(objetivo) && !esObjetivo && !pred.has(clave) && !suc.has(clave));
      nodo.classList.toggle('seleccionada', clave === seleccion);
    }
    // Mini-tarjetas de los carriles «Viene de» y «Habilita».
    for (const m of minisActivas()) {
      const esObjetivo = m.clave !== null && m.clave === objetivo;
      // Una dependencia no disponible es predecesora si la tarjeta que la declara lo es (o es el objetivo).
      const esPred = m.clave !== null
        ? pred.has(m.clave)
        : Boolean(objetivo) && m.dependientes.some((d) => d === objetivo || pred.has(d));
      const esSuc = m.clave !== null && suc.has(m.clave);
      m.nodo.classList.toggle('res-objetivo', esObjetivo);
      m.nodo.classList.toggle('res-pred', !esObjetivo && esPred);
      m.nodo.classList.toggle('res-suc', !esObjetivo && !esPred && esSuc);
      m.nodo.classList.toggle('atenuada', Boolean(objetivo) && !esObjetivo && !esPred && !esSuc);
    }
    programarDibujo();
  }

  // ---------------------------------------------------------------------------
  // Flechas SVG (redibujo agrupado por requestAnimationFrame)
  // ---------------------------------------------------------------------------

  const NS = 'http://www.w3.org/2000/svg';
  let dibujoPendiente = false;

  function programarDibujo() {
    if (dibujoPendiente) return;
    dibujoPendiente = true;
    requestAnimationFrame(() => {
      dibujoPendiente = false;
      dibujarConexiones();
    });
  }

  /** Lector de posiciones relativo al lienzo, con caché por dibujo (lee todo antes de escribir). */
  function lectorCajas() {
    const base = lienzo.getBoundingClientRect();
    const cache = new Map();
    return (nodo) => {
      let r = cache.get(nodo);
      if (!r) {
        const b = nodo.getBoundingClientRect();
        r = { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height };
        cache.set(nodo, r);
      }
      return r;
    };
  }

  /** Bézier horizontal del borde derecho del origen al borde izquierdo del destino. */
  function curvaHorizontal(a, b) {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const ctrl = Math.max(Math.abs(x2 - x1) * 0.45, 40);
    return `M ${x1} ${y1} C ${x1 + ctrl} ${y1}, ${x2 - ctrl} ${y2}, ${x2} ${y2}`;
  }

  function escribirTrazos(trazos) {
    // Se mide la rejilla (no el lienzo): el propio SVG cuenta en el ancho del lienzo y nunca encogería.
    svg.setAttribute('width', String(rejilla.scrollWidth));
    svg.setAttribute('height', String(rejilla.scrollHeight));
    const frag = document.createDocumentFragment();
    // Las líneas tenues van primero para quedar debajo de las demás.
    const peso = (t) => (t.tipo === 'tenue' ? 0 : t.tipo === 'pred' || t.tipo === 'suc' ? 2 : 1);
    trazos.sort((x, y) => peso(x) - peso(y));
    for (const tr of trazos) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', tr.d);
      path.setAttribute('class', `linea linea-${tr.tipo}${tr.inversa ? ' linea-inversa' : ''}${tr.ciclo ? ' linea-ciclo' : ''}`);
      const marca = tr.tipo === 'pred' ? 'flecha-pred' : tr.tipo === 'suc' ? 'flecha-suc' : 'flecha-global';
      if (tr.tipo !== 'tenue') path.setAttribute('marker-end', `url(#${marca})`);
      frag.appendChild(path);
    }
    grupoLineas.textContent = '';
    grupoLineas.appendChild(frag);
  }

  /** Tipo de trazo de una arista origen → destino según el resaltado actual. */
  function tipoArista(origen, destino, base) {
    const { objetivo, pred, suc } = resaltadoActual;
    if (!objetivo) return base;
    const enPred = (c) => c !== null && (c === objetivo || pred.has(c));
    const enSuc = (c) => c !== null && (c === objetivo || suc.has(c));
    // origen null = dependencia no disponible: es predecesora si su tarjeta lo es.
    if (enPred(destino) && (origen === null || enPred(origen))) return 'pred';
    if (enSuc(origen) && enSuc(destino)) return 'suc';
    return 'tenue';
  }

  /** Flechas de la vista desplegada: internas, desde «Viene de» y hacia «Habilita». Siempre visibles. */
  function dibujarDesplegado() {
    const dis = obtenerDisposicion(desplegado);
    const dom = cacheDom.get(desplegado);
    if (!dis || !dom) return;
    const caja = lectorCajas();
    const atenuada = (nodo) => nodo.classList.contains('filtrada');
    const trazos = [];
    const agregar = (nodoA, nodoB, claveA, claveB, base, ciclo) => {
      let tipo = tipoArista(claveA, claveB, base);
      if (!resaltadoActual.objetivo && (atenuada(nodoA) || atenuada(nodoB))) tipo = 'tenue';
      trazos.push({ d: curvaHorizontal(caja(nodoA), caja(nodoB)), tipo, ciclo });
    };
    for (const [p, t, ciclo] of dis.internas) {
      agregar(elementoTarjeta.get(p), elementoTarjeta.get(t), p, t, 'interna', ciclo);
    }
    for (const [clave, t] of dis.entrantes) {
      const m = dom.minis.get(clave);
      if (m) agregar(m.nodo, elementoTarjeta.get(t), m.clave, t, 'contexto', false);
    }
    for (const [t, clave] of dis.salientes) {
      const m = dom.minis.get(clave);
      if (m) agregar(elementoTarjeta.get(t), m.nodo, t, m.clave, 'contexto', false);
    }
    escribirTrazos(trazos);
  }

  function dibujarConexiones() {
    if (desplegado !== null) {
      dibujarDesplegado();
      return;
    }
    const { objetivo, pred, suc } = resaltadoActual;
    // Qué aristas (predecesora → tarjeta) dibujar y con qué estilo.
    const aristas = [];
    for (const clave of visibles) {
      const t = porClave.get(clave);
      for (const p of t.pred) {
        if (!visibles.has(p)) continue;
        let tipo = null;
        if (objetivo) {
          if ((clave === objetivo || pred.has(clave)) && (p === objetivo || pred.has(p))) tipo = 'pred';
          else if ((p === objetivo || suc.has(p)) && (clave === objetivo || suc.has(clave))) tipo = 'suc';
          else if (conexionesGlobales) tipo = 'tenue';
        } else if (conexionesGlobales) {
          tipo = 'global';
        }
        if (tipo) aristas.push([p, clave, tipo]);
      }
    }

    // Primero se leen todas las posiciones (sin escribir en el DOM) para no forzar maquetación repetida.
    const lector = lectorCajas();
    const caja = (clave) => lector(elementoTarjeta.get(clave));
    const trazos = [];
    for (const [origen, destino, tipo] of aristas) {
      const a = caja(origen);
      const b = caja(destino);
      const colA = ordenColumna.get(porClave.get(origen).columna);
      const colB = ordenColumna.get(porClave.get(destino).columna);
      let d;
      if (colA === colB) {
        // Misma columna: curva por la izquierda.
        const x1 = a.x;
        const y1 = a.y + a.h / 2;
        const x2 = b.x;
        const y2 = b.y + b.h / 2;
        const sal = 22 + Math.min(Math.abs(y2 - y1) * 0.08, 30);
        d = `M ${x1} ${y1} C ${x1 - sal} ${y1}, ${x2 - sal} ${y2}, ${x2} ${y2}`;
      } else {
        d = curvaHorizontal(a, b);
      }
      trazos.push({ d, tipo, inversa: colA > colB });
    }

    // Después se escribe.
    escribirTrazos(trazos);
  }

  // ---------------------------------------------------------------------------
  // Vista desplegada por sprint
  // ---------------------------------------------------------------------------

  const cacheDisposicion = new Map(); // id de columna → disposición calculada (una vez)
  const cacheDom = new Map(); // id de columna → { raiz, ranuras, minis }

  /** Nombre de una columna para los carriles de contexto. */
  const tituloColumna = (id) => (elementoColumna.get(id) ? elementoColumna.get(id).def.titulo : id);

  /**
   * Disposición de un sprint (se calcula una vez y se guarda):
   * - niveles: nivel 1 = sin predecesoras internas; nivel N = 1 + máximo de sus predecesoras
   *   internas (camino más largo). Las aristas que cierran un ciclo no cuentan para el nivel.
   * - independientes: sin predecesoras ni sucesoras dentro del sprint.
   * - viene / habilita: predecesoras y sucesoras en otros sprints, agrupadas por sprint.
   */
  function obtenerDisposicion(id) {
    if (cacheDisposicion.has(id)) return cacheDisposicion.get(id);
    const info = elementoColumna.get(id);
    if (!info) return null;
    const miembros = info.lista;
    const enCol = new Set(miembros.map((t) => t.clave));
    const predInt = new Map();
    const sucInt = new Map(miembros.map((t) => [t.clave, []]));
    for (const t of miembros) {
      // Una tarjeta que depende de sí misma no se dibuja como arista (ya lleva la insignia «Ciclo»).
      const ps = t.pred.filter((p) => enCol.has(p) && p !== t.clave);
      predInt.set(t.clave, ps);
      for (const p of ps) sucInt.get(p).push(t.clave);
    }

    // Aristas que cierran un ciclo: aristas de retroceso en un recorrido en profundidad iterativo.
    const cierraCiclo = new Set(); // «p>t»
    const estadoDfs = new Map(); // 1 = en la pila, 2 = terminado
    for (const raiz of miembros) {
      if (estadoDfs.has(raiz.clave)) continue;
      const pila = [[raiz.clave, 0]];
      estadoDfs.set(raiz.clave, 1);
      while (pila.length) {
        const marco = pila[pila.length - 1];
        const sucs = sucInt.get(marco[0]);
        if (marco[1] < sucs.length) {
          const s = sucs[marco[1]++];
          const e = estadoDfs.get(s);
          if (e === 1) cierraCiclo.add(`${marco[0]}>${s}`);
          else if (e === undefined) {
            estadoDfs.set(s, 1);
            pila.push([s, 0]);
          }
        } else {
          estadoDfs.set(marco[0], 2);
          pila.pop();
        }
      }
    }
    const predDag = (c) => predInt.get(c).filter((p) => !cierraCiclo.has(`${p}>${c}`));
    const sucDag = (c) => sucInt.get(c).filter((s) => !cierraCiclo.has(`${c}>${s}`));

    // Niveles por camino más largo (orden topológico de Kahn sobre el grafo sin aristas de ciclo).
    const nivel = new Map();
    const pendientes = new Map(miembros.map((t) => [t.clave, predDag(t.clave).length]));
    const cola = miembros.filter((t) => pendientes.get(t.clave) === 0).map((t) => t.clave);
    for (const c of cola) nivel.set(c, 1);
    for (let i = 0; i < cola.length; i++) {
      const u = cola[i];
      for (const s of sucDag(u)) {
        nivel.set(s, Math.max(nivel.get(s) || 1, nivel.get(u) + 1));
        pendientes.set(s, pendientes.get(s) - 1);
        if (pendientes.get(s) === 0) cola.push(s);
      }
    }

    const conRelacion = (c) => predInt.get(c).length > 0 || sucInt.get(c).length > 0;
    const independientes = miembros.filter((t) => !conRelacion(t.clave)).map((t) => t.clave);
    const niveles = [];
    for (const t of miembros) {
      if (!conRelacion(t.clave)) continue;
      const n = nivel.get(t.clave) || 1;
      while (niveles.length < n) niveles.push([]);
      niveles[n - 1].push(t.clave);
    }

    // Orden dentro de cada nivel por baricentro (3 pasadas de ida y vuelta) para reducir cruces.
    const pos = new Map();
    const fijarPos = () => niveles.forEach((nv) => nv.forEach((c, i) => pos.set(c, i)));
    fijarPos();
    const ordenar = (nv, vecinos) => {
      const bari = new Map(nv.map((c) => {
        const vs = vecinos(c);
        return [c, vs.length ? vs.reduce((s, v) => s + pos.get(v), 0) / vs.length : pos.get(c)];
      }));
      nv.sort((a, b) => bari.get(a) - bari.get(b) || ordenTarjetas(porClave.get(a), porClave.get(b)));
      nv.forEach((c, i) => pos.set(c, i));
    };
    for (let pasada = 0; pasada < 3; pasada++) {
      for (let i = 1; i < niveles.length; i++) ordenar(niveles[i], predDag);
      for (let i = niveles.length - 2; i >= 0; i--) ordenar(niveles[i], sucDag);
    }

    const internas = [];
    for (const t of miembros) {
      for (const p of predInt.get(t.clave)) internas.push([p, t.clave, cierraCiclo.has(`${p}>${t.clave}`)]);
    }

    // Contexto: predecesoras y sucesoras fuera del sprint, sin duplicados, agrupadas por sprint.
    const grupos = (mapa) => [...mapa.entries()]
      .sort((a, b) => (ordenColumna.get(a[0]) ?? 1e9) - (ordenColumna.get(b[0]) ?? 1e9))
      .map(([gid, items]) => ({ id: gid, titulo: gid === '__faltan' ? 'No disponible' : tituloColumna(gid), items: [...items.values()] }));
    const viene = new Map();
    const habilita = new Map();
    const entrantes = [];
    const salientes = [];
    const meter = (mapa, gid, clave, item) => {
      if (!mapa.has(gid)) mapa.set(gid, new Map());
      const g = mapa.get(gid);
      if (!g.has(clave)) g.set(clave, item);
      return g.get(clave);
    };
    for (const t of miembros) {
      for (const p of t.pred) {
        if (enCol.has(p)) continue;
        meter(viene, porClave.get(p).columna, `in:${p}`, { id: `in:${p}`, clave: p });
        entrantes.push([`in:${p}`, t.clave]);
      }
      for (const f of t.faltantes) {
        const k = `in:falta:${claveDe(t.repo, f)}`;
        const item = meter(viene, '__faltan', k, { id: k, clave: null, repo: t.repo, numero: f, dependientes: [] });
        item.dependientes.push(t.clave);
        entrantes.push([k, t.clave]);
      }
      for (const s of t.suc) {
        if (enCol.has(s)) continue;
        meter(habilita, porClave.get(s).columna, `out:${s}`, { id: `out:${s}`, clave: s });
        salientes.push([t.clave, `out:${s}`]);
      }
    }

    const disp = { niveles, independientes, internas, entrantes, salientes, viene: grupos(viene), habilita: grupos(habilita) };
    cacheDisposicion.set(id, disp);
    return disp;
  }

  function crearMini(item, sentido) {
    if (item.clave === null) {
      // Dependencia no disponible: no se puede abrir, pero se muestra con su número.
      const nombre = nombreNumero(item.repo, item.numero);
      return el('div', {
        class: 'mini-tarjeta mini-faltante',
        role: 'note',
        'aria-label': `${nombre}: no disponible (no llegó a los datos o no se pudo consultar)`,
        title: `${nombre}: no disponible`
      }, [
        el('span', { class: 'mini-numero', text: nombre }),
        el('span', { class: 'insignia insignia-no-disponible', text: 'No disponible' })
      ]);
    }
    const t = porClave.get(item.clave);
    const est = infoEstado(t);
    const sprint = nombreColumna(t);
    const nodo = el('button', {
      type: 'button',
      class: `mini-tarjeta${t.fuera ? ' fuera' : ''}`,
      'data-mini': item.clave,
      title: `${numeroDe(t)} · ${t.titulo} · ${sprint}`,
      'aria-label': `${sentido === 'in' ? 'Viene de' : 'Habilita'} ${numeroDe(t)}: ${t.titulo}, ${est.texto}, ${sprint}. Desplegar su sprint.`
    }, [
      el('span', { class: 'mini-numero', text: numeroDe(t) }),
      el('span', { class: `insignia insignia-${est.clase}`, text: est.texto }),
      el('span', { class: 'mini-sprint', text: sprint })
    ]);
    if (t.categoria) nodo.style.borderLeftColor = colorCategoria(t.categoria);
    return nodo;
  }

  /** Construye (una vez) el contenedor de la vista desplegada de una columna. */
  function obtenerDom(id) {
    if (cacheDom.has(id)) return cacheDom.get(id);
    const disp = obtenerDisposicion(id);
    const titulo = tituloColumna(id);
    const minis = new Map();
    const raiz = el('div', { class: `despliegue${disp.niveles.length ? '' : ' sin-niveles'}` });

    const carril = (clase, etiqueta, gruposCarril, sentido, vacio) => {
      const region = el('section', { class: `carril ${clase}`, 'aria-label': etiqueta });
      region.appendChild(el('h3', { class: 'carril-titulo', text: etiqueta }));
      if (!gruposCarril.length) region.appendChild(el('p', { class: 'carril-vacio', text: vacio }));
      for (const g of gruposCarril) {
        const grupo = el('div', { class: 'carril-grupo', role: 'group', 'aria-label': `${etiqueta}: ${g.titulo}` });
        grupo.appendChild(el('div', { class: 'carril-grupo-titulo', text: g.titulo }));
        for (const item of g.items) {
          const nodo = crearMini(item, sentido);
          minis.set(item.id, { nodo, clave: item.clave, dependientes: item.dependientes || [] });
          grupo.appendChild(nodo);
        }
        region.appendChild(grupo);
      }
      return region;
    };

    raiz.appendChild(carril('carril-viene', 'Viene de otros sprints', disp.viene, 'in', 'Ninguna dependencia en otros sprints.'));

    const centro = el('div', { class: 'despliegue-centro' });
    const ranuras = [];
    const total = disp.niveles.length;
    disp.niveles.forEach((nv, i) => {
      const hechas = nv.filter((c) => terminada(porClave.get(c))).length;
      const region = el('section', { class: 'nivel', 'aria-label': `Paso ${i + 1} de ${total}` });
      region.appendChild(el('h3', { class: 'nivel-titulo', text: `Paso ${i + 1} · ${hechas}/${nv.length} terminadas` }));
      const cuerpo = el('div', { class: 'nivel-tarjetas' });
      region.appendChild(cuerpo);
      centro.appendChild(region);
      ranuras.push({ cuerpo, claves: nv });
    });
    if (!total) {
      centro.appendChild(el('p', { class: 'despliegue-nota', text: `${titulo} no tiene dependencias entre sus propias tarjetas: todas son independientes. Las relaciones con otros sprints están en los carriles laterales.` }));
    }

    const indep = el('section', { class: 'carril-independientes', 'aria-label': 'Independientes: sin relaciones dentro del sprint' });
    indep.appendChild(el('h3', { class: 'carril-titulo', text: `Independientes (${disp.independientes.length})` }));
    const cuerpoIndep = el('div', { class: 'indep-tarjetas' });
    indep.appendChild(cuerpoIndep);
    if (!disp.independientes.length) indep.hidden = true;
    ranuras.push({ cuerpo: cuerpoIndep, claves: disp.independientes, independientes: true });
    // Sin niveles, las independientes ocupan el centro (entre «Viene de» y «Habilita»).
    if (total) {
      raiz.appendChild(centro);
    } else {
      centro.appendChild(indep);
      raiz.appendChild(centro);
    }

    raiz.appendChild(carril('carril-habilita', 'Habilita en otros sprints', disp.habilita, 'out', 'Ninguna tarjeta de otros sprints depende de este.'));
    if (total) raiz.appendChild(indep);

    const dom = { raiz, ranuras, minis };
    cacheDom.set(id, dom);
    return dom;
  }

  function minisActivas() {
    return desplegado !== null && cacheDom.has(desplegado) ? cacheDom.get(desplegado).minis.values() : [];
  }

  function esMiniActiva(clave) {
    for (const m of minisActivas()) if (m.clave === clave) return true;
    return false;
  }

  /** Mueve las tarjetas del sprint a sus niveles (los nodos son los mismos; solo cambian de sitio). */
  function ponerDespliegue(id) {
    const info = elementoColumna.get(id);
    const dom = obtenerDom(id);
    for (const r of dom.ranuras) for (const c of r.claves) r.cuerpo.appendChild(elementoTarjeta.get(c));
    info.col.insertBefore(dom.raiz, info.vacia);
    desplegado = id;
  }

  /** Devuelve las tarjetas a la columna en su orden normal. */
  function quitarDespliegue() {
    if (desplegado === null) return;
    const info = elementoColumna.get(desplegado);
    const dom = cacheDom.get(desplegado);
    for (const t of info.lista) info.col.insertBefore(elementoTarjeta.get(t.clave), info.vacia);
    if (dom) dom.raiz.remove();
    desplegado = null;
  }

  /** Refleja el modo en clases, botones, URL y localStorage. */
  function reflejarDespliegue() {
    rejilla.classList.toggle('modo-desplegado', desplegado !== null);
    for (const [id, info] of elementoColumna) {
      const es = id === desplegado;
      info.col.classList.toggle('desplegada', es);
      info.col.classList.toggle('contraida', desplegado !== null && !es);
      info.boton.setAttribute('aria-expanded', String(es));
      info.boton.setAttribute('aria-label', `${es ? 'Contraer' : 'Desplegar'} ${info.def.tipo === 'sprint' ? 'sprint ' : ''}${info.def.titulo}`);
      info.boton.querySelector('.boton-desplegar-texto').textContent = es ? 'Contraer' : 'Desplegar';
      info.boton.querySelector('.icono').textContent = es ? '⤡' : '⤢';
    }
    escribirHash();
    guardarPreferencias();
  }

  function escribirHash() {
    const destino = desplegado !== null ? `#${encodeURIComponent(desplegado)}` : '';
    if (location.hash === destino || (!destino && !location.hash)) return;
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}${destino}`);
    } catch (e) {
      // Algunos navegadores no permiten replaceState con file://: se usa el hash directamente.
      if (destino) location.hash = destino;
    }
  }

  function leerHash() {
    if (!location.hash || location.hash.length < 2) return null;
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      return elementoColumna.has(id) ? id : null;
    } catch (e) {
      return null;
    }
  }

  /** Si la columna es un sprint anterior oculto, activa «Incluir sprints anteriores» y lo anuncia. */
  function asegurarColumnaVisible(id) {
    const info = elementoColumna.get(id);
    if (info && info.def.antiguo && !filtros.incluirAntiguos) {
      filtros.incluirAntiguos = true;
      sincronizarControles();
      anunciar(`Se activó «Incluir sprints anteriores» para mostrar ${info.def.titulo}.`);
    }
  }

  function anunciar(mensaje) {
    const n = $('anuncio');
    if (!n) return;
    n.textContent = '';
    n.textContent = mensaje;
  }

  function desplegar(id, opciones = {}) {
    const { enfocar = true } = opciones;
    if (!elementoColumna.has(id)) return;
    asegurarColumnaVisible(id);
    if (desplegado !== id) {
      quitarDespliegue();
      ponerDespliegue(id);
      if (seleccion && porClave.get(seleccion).columna !== id) seleccion = null;
      hover = null;
    }
    reflejarDespliegue();
    aplicarFiltros();
    const info = elementoColumna.get(id);
    if (enfocar) {
      info.titulo.focus({ preventScroll: true });
      info.col.scrollIntoView({ block: 'nearest', inline: 'start' });
    }
  }

  function contraer() {
    if (desplegado === null) return;
    const id = desplegado;
    quitarDespliegue();
    reflejarDespliegue();
    aplicarFiltros();
    const info = elementoColumna.get(id);
    if (info && !info.col.hidden) info.boton.focus({ preventScroll: true });
  }

  /** Lleva a una tarjeta: despliega su sprint, la fija y la enfoca. */
  function irATarjeta(clave) {
    const t = porClave.get(clave);
    if (!t) return;
    desplegar(t.columna, { enfocar: false });
    seleccion = clave;
    hover = null;
    actualizarResaltado();
    const nodo = elementoTarjeta.get(clave);
    nodo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    nodo.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Modales (detalle y avisos) con foco atrapado
  // ---------------------------------------------------------------------------

  const modalDetalle = $('modalDetalle');
  const modalAvisos = $('modalAvisos');
  let modalAbierto = null;
  let focoAnterior = null;

  const SELECTOR_ENFOCABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function enfocables(contenedor) {
    return [...contenedor.querySelectorAll(SELECTOR_ENFOCABLE)].filter((n) => n.getClientRects().length > 0);
  }

  function abrirModal(modal, inicial) {
    if (modalAbierto && modalAbierto !== modal) cerrarModal(false);
    if (!modalAbierto) focoAnterior = document.activeElement;
    modalAbierto = modal;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    (inicial || enfocables(modal)[0] || modal).focus();
  }

  function cerrarModal(devolverFoco = true) {
    if (!modalAbierto) return;
    modalAbierto.hidden = true;
    modalAbierto = null;
    document.body.style.overflow = '';
    if (devolverFoco && focoAnterior && document.contains(focoAnterior) && focoAnterior.getClientRects().length) {
      focoAnterior.focus();
    }
    focoAnterior = null;
  }

  for (const modal of [modalDetalle, modalAvisos]) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-cerrar]')) cerrarModal();
    });
  }

  // Foco atrapado: Tab y Mayús+Tab circulan dentro del modal.
  // Escape cierra el modal; sin modal abierto, contrae la vista desplegada o suelta la tarjeta fijada.
  document.addEventListener('keydown', (e) => {
    if (!modalAbierto) {
      if (e.key === 'Escape' && desplegado !== null) {
        seleccion = null;
        contraer();
      } else if (e.key === 'Escape' && seleccion) {
        seleccion = null;
        actualizarResaltado();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrarModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const lista = enfocables(modalAbierto);
    if (!lista.length) {
      e.preventDefault();
      return;
    }
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    const dentro = modalAbierto.contains(document.activeElement);
    if (e.shiftKey && (!dentro || document.activeElement === primero || document.activeElement === modalAbierto.querySelector('.modal-titulo'))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (!dentro || document.activeElement === ultimo)) {
      e.preventDefault();
      primero.focus();
    }
  });

  document.addEventListener('focusin', (e) => {
    if (modalAbierto && !modalAbierto.contains(e.target)) {
      const lista = enfocables(modalAbierto);
      (lista[0] || modalAbierto).focus();
    }
  });

  function filaDato(dl, etiqueta, valor) {
    dl.appendChild(el('dt', { text: etiqueta }));
    const dd = el('dd');
    if (valor === null || valor === undefined || valor === '' || (Array.isArray(valor) && valor.length === 0)) {
      dd.appendChild(el('span', { class: 'sin-dato', text: 'Sin dato' }));
    } else if (Array.isArray(valor)) {
      for (const v of valor) dd.appendChild(typeof v === 'string' ? el('span', { class: 'chip', text: v }) : v);
    } else {
      dd.appendChild(typeof valor === 'string' ? document.createTextNode(valor) : valor);
    }
    dl.appendChild(dd);
  }

  function nombreColumna(t) {
    if (t.columna === ID_FUERA) return 'Fuera del tablero';
    if (t.columna === ID_SIN) return t.columnaOriginal ? `Sin sprint (indicaba «${t.columnaOriginal}»)` : 'Sin sprint';
    const c = columnaPorId.get(t.columna);
    return c ? `${c.titulo}${c.actual ? ' (actual)' : ''}${c.antiguo ? ' (anterior)' : ''}` : t.columna;
  }

  function itemRelacion(clave) {
    const t = porClave.get(clave);
    const est = infoEstado(t);
    const boton = el('button', {
      type: 'button',
      class: 'modal-lista-boton',
      'aria-label': `Abrir ${numeroDe(t)}: ${t.titulo}, ${est.texto}${t.bloqueada ? ', bloqueada' : ''}${t.lista ? ', lista' : ''}`
    }, [
      el('span', { class: 'tarjeta-numero', text: numeroDe(t) }),
      el('span', { class: 'texto-item', text: t.titulo, title: t.titulo }),
      el('span', { class: `insignia insignia-${est.clase}`, text: est.texto }),
      t.bloqueada ? el('span', { class: 'insignia insignia-bloqueada', text: 'Bloqueada' }) : null,
      t.lista ? el('span', { class: 'insignia insignia-lista', text: 'Lista' }) : null
    ]);
    boton.addEventListener('click', () => navegarA(clave));
    return el('li', null, boton);
  }

  function abrirDetalle(clave) {
    const t = porClave.get(clave);
    if (!t) return;
    const est = infoEstado(t);
    const cont = $('detalleContenido');
    cont.textContent = '';

    const titulo = el('h2', { id: 'detalleTitulo', class: 'modal-titulo', tabindex: '-1', text: t.titulo });
    cont.appendChild(titulo);

    const meta = el('div', { class: 'modal-meta' });
    meta.appendChild(t.url
      ? el('a', { class: 'modal-enlace', href: t.url, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir en GitHub', text: `${numeroDe(t)} en GitHub ↗` })
      : el('span', { class: 'modal-enlace', text: numeroDe(t) }));
    meta.appendChild(el('span', { class: `insignia insignia-${est.clase}`, text: est.texto }));
    if (t.fuera) meta.appendChild(el('span', { class: 'chip', text: 'Fuera del tablero' }));
    if (t.bloqueada) meta.appendChild(el('span', { class: 'insignia insignia-bloqueada', text: 'Bloqueada' }));
    if (t.lista) meta.appendChild(el('span', { class: 'insignia insignia-lista', text: 'Lista para tomar' }));
    if (t.enCiclo) meta.appendChild(el('span', { class: 'insignia insignia-ciclo', text: 'Ciclo' }));
    cont.appendChild(meta);

    if (t.enCiclo) {
      cont.appendChild(el('p', { class: 'aviso-ciclo', role: 'note', text: 'Esta tarjeta forma parte de un ciclo de dependencias: alguna de sus predecesoras depende, directa o indirectamente, de ella. Revisa la sección «Depende de» de los issues implicados.' }));
    }

    const dl = el('dl', { class: 'modal-datos' });
    filaDato(dl, 'Estado', t.estado ? `${est.texto}${est.texto !== t.estado ? ` (${t.estado})` : ''}` : '');
    filaDato(dl, 'Sprint', nombreColumna(t));
    if (t.categoria) {
      const muestra = el('span', { class: 'leyenda-color', 'aria-hidden': 'true' });
      muestra.style.backgroundColor = colorCategoria(t.categoria);
      filaDato(dl, 'Categoría', el('span', null, [muestra, ' ', nombreCategoria(t.categoria) === t.categoria ? t.categoria : `${t.categoria} · ${nombreCategoria(t.categoria)}`]));
    } else {
      filaDato(dl, 'Categoría', '');
    }
    filaDato(dl, 'Asignados', t.asignados);
    filaDato(dl, 'Etiquetas', t.etiquetas);
    filaDato(dl, 'Rol', t.rol);
    filaDato(dl, 'Tipo', t.tipo);
    filaDato(dl, 'Prioridad', t.prioridad);
    filaDato(dl, 'Estimación', t.estimacionDias !== null ? formatoDias(t.estimacionDias) : '');
    const prs = t.prs.map((p) => {
      const etq = Number.isFinite(p.numero) ? `#${p.numero}` : 'PR';
      return p.url
        ? el('a', { class: 'chip', href: p.url, target: '_blank', rel: 'noopener noreferrer', text: `${etq} ↗` })
        : el('span', { class: 'chip', text: etq });
    });
    filaDato(dl, 'PR enlazados', prs);
    if (variosRepos && t.repo) filaDato(dl, 'Repositorio', t.repo);
    cont.appendChild(dl);

    // Depende de
    const secPred = el('section', { class: 'modal-seccion', 'aria-labelledby': 'detalleDepende' });
    secPred.appendChild(el('h3', { id: 'detalleDepende', text: `Depende de (${t.pred.length + t.faltantes.length})` }));
    const listaPred = el('ul', { class: 'modal-lista' });
    for (const p of t.pred) listaPred.appendChild(itemRelacion(p));
    for (const f of t.faltantes) {
      // Dependencia que no llegó al modelo o no se pudo consultar: se muestra con su número.
      listaPred.appendChild(el('li', {
        class: 'modal-lista-faltante',
        'aria-label': `${nombreNumero(t.repo, f)}: no disponible; se considera sin terminar`
      }, [
        el('span', { class: 'tarjeta-numero', text: nombreNumero(t.repo, f) }),
        el('span', { class: 'texto-item', text: 'No disponible: no llegó a los datos o no se pudo consultar (cuenta como sin terminar)' }),
        el('span', { class: 'insignia insignia-no-disponible', text: 'No disponible' })
      ]));
    }
    if (!t.pred.length && !t.faltantes.length) listaPred.appendChild(el('li', { class: 'modal-lista-vacia', text: 'No declara dependencias.' }));
    secPred.appendChild(listaPred);
    cont.appendChild(secPred);

    // Desbloquea
    const secSuc = el('section', { class: 'modal-seccion', 'aria-labelledby': 'detalleDesbloquea' });
    secSuc.appendChild(el('h3', { id: 'detalleDesbloquea', text: `Desbloquea (${t.suc.length})` }));
    const listaSuc = el('ul', { class: 'modal-lista' });
    for (const s of t.suc.slice().sort((a, b) => ordenTarjetas(porClave.get(a), porClave.get(b)))) listaSuc.appendChild(itemRelacion(s));
    if (!t.suc.length) listaSuc.appendChild(el('li', { class: 'modal-lista-vacia', text: 'Ninguna tarjeta depende de esta.' }));
    secSuc.appendChild(listaSuc);
    cont.appendChild(secSuc);

    if (modalAbierto === modalDetalle) titulo.focus();
    else abrirModal(modalDetalle, titulo);
  }

  /** Desde el modal: abre otra tarjeta, la fija y la trae a la vista si está visible. */
  function navegarA(clave) {
    const nodo = elementoTarjeta.get(clave);
    // En la vista desplegada, una tarjeta de otro sprint despliega ese sprint.
    if (desplegado !== null && porClave.get(clave).columna !== desplegado) {
      desplegar(porClave.get(clave).columna, { enfocar: false });
    }
    if (estaALaVista(clave)) {
      seleccion = clave;
      hover = null;
      actualizarResaltado();
      nodo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      focoAnterior = nodo; // al cerrar, el foco vuelve a esta tarjeta
    }
    abrirDetalle(clave);
  }

  function abrirAvisos() {
    const cont = $('avisosContenido');
    cont.textContent = '';
    if (!avisosDatos.length && !avisosCalculados.length) {
      cont.appendChild(el('p', { class: 'sin-dato', text: 'No hay avisos.' }));
    }
    if (avisosDatos.length) {
      cont.appendChild(el('h3', { class: 'avisos-subtitulo', text: `Del script de extracción (${avisosDatos.length})` }));
      const ul = el('ul', { class: 'lista-avisos' });
      for (const a of avisosDatos) ul.appendChild(el('li', { text: a }));
      cont.appendChild(ul);
    }
    if (avisosCalculados.length) {
      cont.appendChild(el('h3', { class: 'avisos-subtitulo', text: `Detectados por esta página (${avisosCalculados.length})` }));
      const ul = el('ul', { class: 'lista-avisos' });
      for (const a of avisosCalculados) ul.appendChild(el('li', { text: a }));
      cont.appendChild(ul);
    }
    abrirModal(modalAvisos, $('avisosTitulo'));
  }

  // ---------------------------------------------------------------------------
  // Leyenda de categorías (clic = filtrar por esa categoría)
  // ---------------------------------------------------------------------------

  function pintarLeyenda() {
    const cont = $('leyendaCategorias');
    cont.textContent = '';
    const claves = [...selCategoria.options].map((o) => o.value).filter((v) => v && v !== NADIE);
    for (const k of claves) {
      const activo = filtros.categoria === k;
      const boton = el('button', {
        type: 'button',
        class: 'leyenda-item',
        'aria-pressed': String(activo),
        'aria-label': `${activo ? 'Quitar filtro de' : 'Filtrar por'} categoría ${nombreCategoria(k)}`
      });
      const muestra = el('span', { class: 'leyenda-color', 'aria-hidden': 'true' });
      muestra.style.backgroundColor = colorCategoria(k);
      boton.appendChild(muestra);
      boton.appendChild(document.createTextNode(nombreCategoria(k) === k ? k : `${k} · ${nombreCategoria(k)}`));
      boton.addEventListener('click', () => {
        filtros.categoria = activo ? '' : k;
        alCambiarFiltros();
      });
      cont.appendChild(boton);
    }
    if (!claves.length) cont.appendChild(el('span', { class: 'sin-dato', text: 'Sin categorías en los datos' }));
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------

  function alCambiarFiltros() {
    guardarPreferencias();
    sincronizarControles();
    aplicarFiltros();
  }

  let temporizadorBusqueda = 0;
  buscador.addEventListener('input', () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => {
      busqueda = buscador.value;
      buscador.classList.toggle('activo', busqueda !== '');
      aplicarFiltros();
    }, 80);
  });

  selCategoria.addEventListener('change', () => { filtros.categoria = selCategoria.value; alCambiarFiltros(); });
  selRol.addEventListener('change', () => { filtros.rol = selRol.value; alCambiarFiltros(); });
  selAsignado.addEventListener('change', () => { filtros.asignado = selAsignado.value; alCambiarFiltros(); });
  selEstado.addEventListener('change', () => { filtros.estado = selEstado.value; alCambiarFiltros(); });
  // «Solo bloqueadas» y «Solo listas» se excluyen entre sí (ninguna tarjeta es ambas cosas).
  chkBloqueadas.addEventListener('change', () => {
    filtros.soloBloqueadas = chkBloqueadas.checked;
    if (filtros.soloBloqueadas) filtros.soloListas = false;
    alCambiarFiltros();
  });
  chkListas.addEventListener('change', () => {
    filtros.soloListas = chkListas.checked;
    if (filtros.soloListas) filtros.soloBloqueadas = false;
    alCambiarFiltros();
  });
  chkAntiguos.addEventListener('change', () => { filtros.incluirAntiguos = chkAntiguos.checked; alCambiarFiltros(); });

  btnLimpiar.addEventListener('click', () => {
    filtros = filtrosVacios();
    busqueda = '';
    buscador.value = '';
    alCambiarFiltros();
  });

  btnConexiones.addEventListener('click', () => {
    conexionesGlobales = !conexionesGlobales;
    guardarPreferencias();
    sincronizarControles();
    programarDibujo();
  });

  btnAvisos.addEventListener('click', abrirAvisos);

  // Interacción con tarjetas por delegación (un solo juego de oyentes para todas).
  // Las mini-tarjetas de los carriles también resaltan (con la clave de la tarjeta a la que apuntan).
  const claveDeNodo = (objetivo) => {
    const nodo = objetivo instanceof Element ? objetivo.closest('.tarjeta, .mini-tarjeta[data-mini]') : null;
    return nodo ? nodo.getAttribute('data-clave') || nodo.getAttribute('data-mini') : null;
  };
  const esMini = (objetivo) => objetivo instanceof Element && Boolean(objetivo.closest('.mini-tarjeta'));

  rejilla.addEventListener('mouseover', (e) => {
    const clave = claveDeNodo(e.target);
    if (clave && clave !== hover) {
      hover = clave;
      if (!seleccion) actualizarResaltado();
    }
  });

  rejilla.addEventListener('mouseleave', () => {
    if (hover) {
      hover = null;
      if (!seleccion) actualizarResaltado();
    }
  });

  rejilla.addEventListener('mouseout', (e) => {
    // Al pasar de una tarjeta a un hueco entre tarjetas.
    if (!hover) return;
    const destino = claveDeNodo(e.relatedTarget);
    if (!destino) {
      hover = null;
      if (!seleccion) actualizarResaltado();
    }
  });

  rejilla.addEventListener('focusin', (e) => {
    const clave = claveDeNodo(e.target);
    if (clave) {
      hover = clave;
      if (!seleccion) actualizarResaltado();
    }
  });

  rejilla.addEventListener('focusout', (e) => {
    if (!claveDeNodo(e.relatedTarget) && hover && !modalAbierto) {
      hover = null;
      if (!seleccion) actualizarResaltado();
    }
  });

  rejilla.addEventListener('click', (e) => {
    const clave = claveDeNodo(e.target);
    if (!clave) return;
    e.stopPropagation();
    // Mini-tarjeta: despliega el sprint de esa tarjeta y la fija.
    if (esMini(e.target)) {
      irATarjeta(clave);
      return;
    }
    if (seleccion === clave) {
      abrirDetalle(clave);
    } else {
      seleccion = clave;
      actualizarResaltado();
    }
  });

  rejilla.addEventListener('dblclick', (e) => {
    const clave = claveDeNodo(e.target);
    if (clave && !esMini(e.target)) abrirDetalle(clave);
  });

  /** Tarjetas navegables de un contenedor (sin las ocultas ni las atenuadas por filtros). */
  const navegables = (cont) => [...cont.querySelectorAll(':scope > .tarjeta:not(.oculta):not(.filtrada)')];

  /** Flechas en la vista desplegada: ←/→ entre pasos, ↑/↓ dentro del paso; en «Independientes», ←/→ recorren la fila. */
  function destinoDesplegado(nodo, tecla) {
    const dom = cacheDom.get(desplegado);
    if (!dom) return null;
    const conts = dom.ranuras.map((r) => r.cuerpo).filter((c) => navegables(c).length);
    const cont = nodo.parentElement;
    const j = conts.indexOf(cont);
    if (j < 0) return null;
    const items = navegables(cont);
    const i = items.indexOf(nodo);
    const esIndep = cont.classList.contains('indep-tarjetas');
    const niveles = conts.filter((c) => !c.classList.contains('indep-tarjetas'));
    if (esIndep) {
      if (tecla === 'ArrowLeft') return items[i - 1] || null;
      if (tecla === 'ArrowRight') return items[i + 1] || null;
      if (tecla === 'ArrowUp' && niveles.length) return navegables(niveles[niveles.length - 1])[0];
      return null;
    }
    if (tecla === 'ArrowUp') return items[i - 1] || null;
    if (tecla === 'ArrowDown') {
      if (items[i + 1]) return items[i + 1];
      const indep = conts.find((c) => c.classList.contains('indep-tarjetas'));
      return indep ? navegables(indep)[0] : null;
    }
    const k = niveles.indexOf(cont) + (tecla === 'ArrowLeft' ? -1 : 1);
    if (!niveles[k]) return null;
    const otras = navegables(niveles[k]);
    return otras[Math.min(i, otras.length - 1)];
  }

  rejilla.addEventListener('keydown', (e) => {
    const clave = claveDeNodo(e.target);
    if (!clave || esMini(e.target)) return; // las mini-tarjetas son botones: Enter hace clic
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      seleccion = clave;
      actualizarResaltado();
      abrirDetalle(clave);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const nodo = elementoTarjeta.get(clave);
    let destino = null;
    if (desplegado !== null && porClave.get(clave).columna === desplegado) {
      destino = destinoDesplegado(nodo, e.key);
    } else {
      // Vista normal: arriba/abajo en la columna, izquierda/derecha entre columnas.
      const col = nodo.closest('.columna');
      const enCol = [...col.querySelectorAll('.tarjeta:not(.oculta)')];
      const i = enCol.indexOf(nodo);
      if (e.key === 'ArrowUp') destino = enCol[i - 1];
      else if (e.key === 'ArrowDown') destino = enCol[i + 1];
      else {
        const cols = [...rejilla.querySelectorAll('.columna:not([hidden])')].filter((c) => c.querySelector('.tarjeta:not(.oculta)'));
        const j = cols.indexOf(col) + (e.key === 'ArrowLeft' ? -1 : 1);
        if (cols[j]) {
          const otras = [...cols[j].querySelectorAll('.tarjeta:not(.oculta)')];
          destino = otras[Math.min(i, otras.length - 1)];
        }
      }
    }
    if (destino) {
      e.preventDefault();
      destino.focus();
      destino.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });

  // El sprint desplegado sigue al hash de la URL (#S1).
  window.addEventListener('hashchange', () => {
    const id = leerHash();
    if (id && id !== desplegado) desplegar(id);
    else if (!id && desplegado !== null && !location.hash) contraer();
  });

  // Clic fuera de las tarjetas (y fuera de controles y modales): suelta la tarjeta fijada.
  document.addEventListener('click', (e) => {
    if (!seleccion || !(e.target instanceof Element)) return;
    // Un botón del modal que ya se reemplazó al navegar no cuenta como «clic fuera».
    if (!document.contains(e.target) || modalAbierto) return;
    if (e.target.closest('.tarjeta, .mini-tarjeta, .modal-fondo, .cabecera, .pie')) return;
    seleccion = null;
    actualizarResaltado();
  });

  // Redibujo al redimensionar y desplazar (siempre agrupado en un frame).
  window.addEventListener('resize', programarDibujo, { passive: true });
  tablero.addEventListener('scroll', programarDibujo, { passive: true });
  if ('ResizeObserver' in window) {
    new ResizeObserver(programarDibujo).observe(lienzo);
    // La altura del pie fijo reserva espacio al final del tablero.
    const pie = $('pie');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--alto-pie', `${pie.offsetHeight}px`);
    }).observe(pie);
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------

  pintarCabecera();
  pintarBotonAvisos();
  pintarAvance();
  poblarFiltros();
  restaurarPreferencias();
  construirTablero();
  sincronizarControles();
  aplicarFiltros();
  // Vista desplegada inicial: el hash de la URL manda; si no hay, la de localStorage.
  {
    const inicial = leerHash() || (desplegadoGuardado && elementoColumna.has(desplegadoGuardado) ? desplegadoGuardado : null);
    if (inicial) desplegar(inicial, { enfocar: false });
    else if (location.hash) escribirHash(); // hash inválido: se ignora y se limpia
  }
})();
