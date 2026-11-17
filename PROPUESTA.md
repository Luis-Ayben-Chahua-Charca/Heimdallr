# Heimdallr — propuesta de desarrollo

Visor de tableros de GitHub Projects con dependencias, pensado como la «malla curricular» de un proyecto: columnas por sprint, tarjetas por issue, flechas de «depende de» y el estado de cada tarjeta.

| Dato | Valor |
| --- | --- |
| Dueña | Leyni (R1 de FARMASIL_APP, GitHub `Luis-Ayben-Chahua-Charca`) |
| Versión de este documento | 1.00 · 17/11/2026 |
| Primer tablero de prueba | Proyecto #3 «Farmasil Scrum for Planning and Deployment» (público), repositorio `Luis-Ayben-Chahua-Charca/Farmasil_App` (público) |
| Referencia visual | `C:\Users\Leyni\Documents\enano frostmourne\a` (malla curricular UNSA: `index.html`, `styles.css`, `script.js`, `data.js`) |
| Idioma | Interfaz, comentarios y documentación en español |

---

## 1. Qué se construye y en qué orden

| Fase | Entrega | Autenticación | Quién lo ve |
| --- | --- | --- | --- |
| **1. Local (propuesta B)** | Script que jala el tablero con `gh` y escribe `data.js`, más la página completa | Ninguna: usa la sesión de `gh` de Leyni | Solo Leyni, abriendo `index.html` |
| **2. Publicación pública (opción 1)** | Sitio en GitHub Pages con los datos de Farmasil, regenerado por un workflow | Ninguna: todo es público | Cualquiera con la URL |
| **3. Inicio de sesión (opción 3)** | «Iniciar sesión con GitHub»; cada persona ve solo lo que su cuenta puede ver, de varios repositorios | GitHub App de solo lectura y una función serverless | Colaboradores de cada repositorio |

Cada fase debe quedar funcionando antes de empezar la siguiente. La fase 1 no se rehace en la 3: cambia solo de dónde salen los datos.

### Fuera de alcance (las tres fases)

- Escribir en GitHub: mover tarjetas, cambiar estados, comentar, crear issues. Heimdallr es **solo lectura**.
- Editar dependencias en la herramienta. Se leen del issue y se cambian en GitHub.
- Notificaciones, métricas de velocidad o burndown. Pueden ser una fase posterior.

---

## 2. De la malla curricular a Heimdallr

La referencia es una página estática sin compilación (HTML, CSS y JS puros): columnas por semestre, tarjetas de cursos por categoría, flechas SVG de prerrequisitos, buscador, filtro por categoría, modal de detalle y barra de avance guardada en `localStorage`. Se conserva la idea y se cambia el dominio:

| Malla curricular | Heimdallr |
| --- | --- |
| Semestre (columna) | Sprint (columna) |
| Curso (tarjeta) | Issue (tarjeta) |
| Prerrequisitos | Sección «Depende de» del issue |
| Categoría (color) | Módulo (USR, INV, ALV…) |
| Aprobado (marcado a mano) | Estado del tablero: Todo, In Progress, Done (leído, no marcado a mano) |
| Créditos | Estimación en días |
| Avance | Issues Done sobre el total (y días Done sobre el total) |

Se reutiliza la estructura del código de la referencia como punto de partida (generación de columnas, SVG de conexiones, modal, filtros), pero **sin copiar sus datos** ni su marca (UNSA, Plan 2017). El sitio de Heimdallr debe ser genérico: el nombre del proyecto sale de los datos.

---

## 3. Hechos verificados sobre la fuente de datos

Comprobados el 17/11/2026 con la sesión de `gh` de Leyni (permisos `project`, `repo`, `read:org`, `workflow`, `gist`).

### 3.1 El tablero

- `gh project list --owner Luis-Ayben-Chahua-Charca` lista siete proyectos. Los relevantes: **#3** (116 tarjetas, público, el vigente de Farmasil), #6 (tablero anterior «FarmasilERP», 38 tarjetas, privado) y #7 («Mars Cat», 70, privado). El #3 tiene 56 Done, 4 In Progress y 56 Todo. Todas las tarjetas son issues (ninguna es PR ni borrador).
- El repositorio tiene 120 issues; el tablero, 116. Una dependencia puede apuntar a un issue que no está en el tablero: hay que resolverlo por separado (ver 3.4).
- Campos del #3: `Status` (Todo, In Progress, Done), `Sprint` (iteración), `Bloque` (Planeación, Implementacion), `Tipo` (Documento, Modulo, Infraestructura, Prueba, Interfaz), `Prioridad` (P1 Nucleo, P2 Cumplimiento, Base Tecnica, P3 Gestion, Seguimiento), `Rol` (R1 a R8), `Modulo` (USR, PRV, INV, LOT, PAG, VEN, RES, ALV, DOC, DEV, REP, REA, COT, Transversal), `Estimacion (dias)`, y los nativos `Assignees`, `Labels`, `Linked pull requests`, `Milestone`, `Repository`, `Parent issue`, `Sub-issues progress`, `Created`, `Updated`, `Closed`.
- Los nombres y las opciones **cambian de un tablero a otro** (el #6 usa Puntos, Horas y otro `Rol`). El mapeo de campos debe vivir en un archivo de configuración, no en el código.

### 3.2 Forma de los datos

`gh project item-list <n> --owner <dueño> --limit 300 --format json` devuelve `{"items":[…]}`. Cada elemento:

```json
{
  "id": "PVTI_…",
  "title": "Add Mockups",
  "status": "Done",
  "assignees": ["FrancoCalcinaFlores"],
  "labels": ["documentation", "UI"],
  "bloque": "Planeación",
  "tipo": "Interfaz",
  "prioridad": "Base Tecnica",
  "sprint": { "title": "Sprint 5", "startDate": "2026-10-15", "duration": 7, "iterationId": "5bc9fa36" },
  "linked pull requests": ["https://github.com/…/pull/60"],
  "milestone": { "title": "sprint", "description": "", "dueOn": "" },
  "repository": "https://github.com/Luis-Ayben-Chahua-Charca/Farmasil_App",
  "content": { "type": "Issue", "number": 59, "title": "Add Mockups", "url": "…/issues/59", "repository": "Luis-Ayben-Chahua-Charca/Farmasil_App", "body": "…" }
}
```

Los campos personalizados llegan con el nombre en minúsculas y sin tilde (`bloque`, `tipo`, `prioridad`, `rol`, `modulo`, `estimacion (dias)`). Un campo vacío **no aparece** en el elemento: hay que tolerar su ausencia. `--format json` acepta `--jq`.

### 3.3 Sprints: dos esquemas mezclados

El campo `Sprint` contiene dos juegos de iteraciones:

| Iteración | Inicio | Tarjetas |
| --- | --- | --- |
| `Sprint 1` a `Sprint 5` | 17/09 a 15/10 | 31 (esquema viejo, 29 Done) |
| `S1` … `S6` | 08/11, 15/11, 22/11, 29/11, 06/12, 13/12 | 32, 12, 13, 10, 9, 9 |

El plan de implementación de Farmasil usa **S1 a S6** (domingo a sábado, 8 nov a 19 dic). La vista por defecto muestra S1 a S6; las iteraciones viejas se ofrecen con un filtro («Incluir sprints anteriores»). Una tarjeta sin sprint va a una columna «Sin sprint».

### 3.4 Las dependencias no están en el tablero

- No existe un campo de dependencias. La relación nativa «blocked by» de GitHub existe (API de dependencias y GraphQL `blockedBy`), pero **el equipo no la usa**: devuelve vacío.
- Lo que sí hay es la sección **`## Depende de`** en el cuerpo del issue. De 120 issues, **72** la tienen y 48 no (los primeros, anteriores al formato). Los cuerpos llegan con finales de línea `\r\n`. Formato, tal como está hoy:

  ```markdown
  ## Depende de

  - #53
  - #71

  ---
  Rol: R7 Alertas y procesos · Sprint: S1 · Estimación: 1 días
  ```

- Reglas de lectura, comprobadas contra los 120 issues: la sección va desde `## Depende de` hasta el siguiente `---` o `## `; cada dependencia es una línea `- #N`; ningún número apunta fuera del repositorio; una línea sin `#` es texto libre y se ignora (hay una: «Corregir el diccionario de datos y el catálogo…»). Se debe poder activar un modo estricto que avise de las líneas con otro formato.
- Una dependencia puede apuntar a un issue que **no está en el tablero** o que está cerrado: se pide con `gh issue view` o con la API, y se dibuja como nodo «fuera del tablero» con su estado de issue (abierto o cerrado).
- Si más adelante el equipo adopta «blocked by» nativo, el lector debe aceptarlo además del texto. Se deja como mejora de la fase 1, desactivada por defecto.

### 3.5 Sobre la fase 3 (autenticación)

- Los proyectos de un usuario **no se pueden leer con el `GITHUB_TOKEN` por defecto** de un workflow. Hace falta una credencial propia.
- El acceso a un proyecto de usuario es independiente del acceso al repositorio: un colaborador solo ve un proyecto privado si se le invita a él.
- Un token clásico con `read:project` lee proyectos, pero para repositorios privados el permiso `repo` también concede escritura. Se debe **comprobar** si un token de grano fino de solo lectura o una GitHub App con permiso de lectura sobre proyectos de usuario cubren el caso. No se ha verificado todavía; es la primera tarea de la fase 3.

---

## 4. Modelo de datos intermedio

El script de extracción produce un único archivo, independiente de GitHub, que es lo que consume la página. Se publica como `data.js` (para abrir `index.html` con doble clic, sin servidor) y, a partir de la fase 2, también como `data.json`.

```json
{
  "esquema": 1,
  "generado": "2026-11-17T16:30:00Z",
  "fuente": { "dueno": "Luis-Ayben-Chahua-Charca", "proyecto": 3, "titulo": "Farmasil Scrum for Planning and Deployment", "url": "https://github.com/users/Luis-Ayben-Chahua-Charca/projects/3" },
  "columnas": [ { "id": "S1", "titulo": "S1", "inicio": "2026-11-08", "fin": "2026-11-14", "actual": true, "antiguo": false } ],
  "categorias": { "ALV": { "nombre": "Alertas de vencimiento", "color": "#a855f7" } },
  "tarjetas": [
    {
      "id": 87, "repo": "Luis-Ayben-Chahua-Charca/Farmasil_App", "titulo": "ALV: consulta de alertas de productos vencidos",
      "url": "https://github.com/…/issues/87", "estado": "In Progress", "columna": "S1", "categoria": "ALV",
      "rol": "R7 Alertas y procesos", "tipo": "Modulo", "prioridad": "P1 Nucleo",
      "asignados": ["JhoerV"], "etiquetas": ["feat", "mod:ALV"], "estimacionDias": 1,
      "prs": [ { "numero": 181, "url": "https://github.com/…/pull/181" } ],
      "dependeDe": [53, 71], "fueraDelTablero": false
    }
  ],
  "avisos": [ "El issue #12 declara una dependencia con formato no reconocido: «…»" ]
}
```

Reglas del modelo:

- `estado` toma exactamente los valores del campo `Status` del tablero; si el tablero tiene otros (por ejemplo `Backlog`), se conservan y la interfaz los agrupa bajo «Otros» salvo que la configuración los mapee.
- Los nodos de dependencias que no están en el tablero llevan `fueraDelTablero: true` y `estado` = `Open` o `Closed`.
- `categoria` y `color` se derivan del campo configurado (por defecto `Modulo`). Los colores salen de una paleta fija indexada por orden, para que no cambien entre ejecuciones.
- El archivo **no contiene el cuerpo completo del issue**: solo lo necesario para la vista (los cuerpos pueden tener datos que el tablero no muestra). El cuerpo se descarta tras extraer las dependencias.

---

## 5. Fase 1 — local

### 5.1 Estructura propuesta

```text
Heimdallr/
├─ PROPUESTA.md            ← este documento
├─ README.md               ← cómo se usa
├─ heimdallr.config.json   ← proyecto, dueño, mapeo de campos, sprints a mostrar
├─ scripts/
│  └─ actualizar.mjs       ← extracción (Node, sin dependencias)
├─ web/
│  ├─ index.html
│  ├─ styles.css
│  ├─ script.js
│  └─ data.js              ← generado, no se edita a mano (ignorado por git)
└─ tests/                  ← pruebas del lector de dependencias y del modelo
```

### 5.2 Extracción

- Un solo comando: `node scripts/actualizar.mjs` (acepta `--owner`, `--project`, `--config`). Node 24 y `gh` 2.102 ya están instalados en el equipo de Leyni. **Sin paquetes de npm**: usa `child_process` para llamar a `gh` y el resto es JavaScript estándar. Si un agente cree que necesita una dependencia, debe proponerlo antes y esperar el visto bueno de Leyni.
- Pasos: (1) `gh project item-list` con límite alto y paginación si hay más de 300; (2) mapeo de campos según el config; (3) lectura de «Depende de» por regla de 3.4; (4) resolución de dependencias fuera del tablero con `gh issue view` (con caché en memoria para no repetir); (5) validaciones: referencias circulares, dependencias a una tarjeta inexistente, tarjetas sin sprint; (6) escritura de `web/data.js` (`window.HEIMDALLR_DATA = {…};`) y `web/data.json`.
- **Solo lectura**: el script nunca ejecuta `gh project item-edit`, `gh issue edit`, `gh api -X POST/PUT/PATCH/DELETE` ni nada que escriba. Una prueba automática debe fallar si el código contiene alguno de esos verbos.
- No imprime ni guarda tokens. Usa la sesión de `gh` ya iniciada y no lee `gh auth token`.
- Tolerancia: si un campo configurado no existe en el tablero, avisa por nombre y sigue; si `gh` no está autenticado o no tiene el permiso `project`, termina con un mensaje que diga el comando exacto para arreglarlo (`gh auth refresh -s project`).
- Tablero de otro dueño u organización: el mismo comando con `--owner`. Los tableros de organización se leen igual.

### 5.3 La página

**Disposición** (heredada de la malla): cabecera con título, buscador, filtros y barra de avance; el área principal con una columna por sprint y las tarjetas dentro; un pie con la leyenda de colores.

**Tarjeta:** número, título (truncado, completo en el modal), categoría por color, avatar o iniciales del asignado, estimación en días, insignia de estado y, si aplica, insignia «Bloqueada» o «Lista».

**Estados visuales** (no pueden depender solo del color; deben llevar también un texto o un icono):

| Estado | Borde | Texto |
| --- | --- | --- |
| Todo | gris | «Por hacer» |
| In Progress | ámbar | «En curso» |
| Done | verde, tarjeta atenuada | «Terminada» |
| Fuera del tablero | punteado | «Abierto» / «Cerrado» |

**Reglas calculadas** (en el navegador, a partir de `dependeDe` y `estado`):

- **Bloqueada:** la tarjeta no está Done y alguna de sus dependencias no está Done (o está abierta fuera del tablero).
- **Lista para tomar:** está en Todo, tiene al menos una dependencia o ninguna, y **todas** están Done. Si no tiene dependencias, también cuenta como lista.
- **Ruta crítica (opcional):** la cadena más larga de dependencias no terminadas. No es obligatoria en la primera entrega.
- **Ciclos:** si se detecta un ciclo, la tarjeta lleva un aviso y el aviso aparece en la lista de `avisos`; no se rompe el dibujo.

**Interacción:**

- Pasar el cursor o hacer clic en una tarjeta resalta sus predecesoras (a la izquierda) y sus sucesoras (a la derecha) y atenúa el resto, como en la malla.
- Botón «Mostrar conexiones globales» (como en la referencia). Las flechas se redibujan al cambiar el tamaño o desplazar.
- Modal de detalle con: título, número y enlace a GitHub, estado, sprint, asignados, etiquetas, rol, tipo, prioridad, estimación, PR enlazados con su enlace, y dos listas «Depende de» y «Desbloquea», con su estado cada una, navegables.
- **Filtros combinables:** categoría (módulo), rol, asignado, estado, «solo bloqueadas», «solo listas», «incluir sprints anteriores». El buscador filtra por número, título y asignado.
- **Barra de avance:** `Done / total` de issues y de días. Muestra también el avance por sprint en el encabezado de cada columna.
- **Persistencia ligera:** los filtros y el estado de las conexiones globales se guardan en `localStorage` (con `try/catch`). **No** se guarda el estado de las tarjetas: viene siempre de los datos.
- Se muestra la fecha de «Datos generados» y un aviso si tienen más de 24 horas, junto a los `avisos` del modelo.
- Accesibilidad: navegable con teclado, `aria-label` en controles, contraste suficiente en tema oscuro (el de la referencia).
- Funciona al abrir `index.html` con doble clic (`file://`), por eso los datos van en `data.js` y no en una petición `fetch`.

### 5.4 Pruebas y criterios de aceptación de la fase 1

- **Lector de dependencias:** pruebas con los casos reales (`- #53`, varias líneas, sección ausente, texto libre, `\r\n`, referencia inexistente, ciclo).
- **Modelo:** una captura del tablero #3 (con los cuerpos recortados) como dato de prueba, y comprobaciones: 116 tarjetas, 56 Done / 4 In Progress / 56 Todo, 72 issues con dependencias.
- **Aceptación:**
  1. `node scripts/actualizar.mjs --owner Luis-Ayben-Chahua-Charca --project 3` genera `data.js` sin errores.
  2. Al abrir `web/index.html` se ven las columnas S1 a S6 con sus tarjetas y los conteos coinciden con el tablero de GitHub.
  3. El #87 (ALV, consulta) se ve «En curso» o «Terminada» según el estado real, con flechas desde el #53 y el #71.
  4. Un issue con una dependencia sin terminar aparece «Bloqueada», y al terminarla en GitHub y volver a ejecutar el script pasa a «Lista».
  5. Ningún token ni cadena de conexión aparece en los archivos generados.
  6. Con 4 filtros activos y 116 tarjetas la interfaz responde sin demora apreciable.

---

## 6. Fase 2 — publicación pública con Farmasil

Condición: Farmasil_App y el proyecto #3 son públicos, así que el sitio no expone nada que no lo esté ya. **Esta fase no se usa con proyectos privados.**

- **Dónde:** repositorio propio de Leyni (por ejemplo `Heimdallr`) con GitHub Pages desplegado por **workflow de Pages** (artefacto), sin commits automáticos a ninguna rama. No se publica desde `main` de Farmasil_App: sus reglas (`main-ci`, `main-revision`) exigen PR y revisión.
- **Workflow:** se ejecuta con programación (cada 30 minutos en horario de trabajo, o cada hora) y a petición (`workflow_dispatch`). Instala nada que no sea Node, ejecuta `actualizar.mjs` y publica `web/`.
- **Credencial:** el `GITHUB_TOKEN` por defecto no lee proyectos de usuario (3.5). Como el proyecto #3 es público, se prueba primero si una credencial mínima basta. Si hace falta un token personal con `read:project`, **lo crea Leyni** y lo guarda como secreto del repositorio; ningún agente lo crea, lo lee ni lo imprime. El workflow no debe escribirlo en el registro y se rotará con una fecha de vencimiento corta.
- **Aceptación:** la URL de Pages muestra el mismo tablero que la fase 1, los datos se actualizan solos y el sitio no contiene secretos. Si el workflow falla, mantiene el último sitio publicado.

---

## 7. Fase 3 — inicio de sesión y varios repositorios

Objetivo: un solo sitio con los proyectos de varios repositorios de Leyni, donde cada persona ve **solo** lo que su cuenta de GitHub ya puede ver. Leyni ve todo lo suyo.

### 7.1 Principio de diseño

- **La autorización la decide GitHub, no Heimdallr.** La página lee los datos con el token del propio visitante; no hay un token maestro ni una lista de usuarios que mantener.
- **Filtrar en el navegador no es seguridad.** Los datos de un proyecto privado no pueden ir dentro de archivos estáticos públicos. En esta fase `data.js` deja de existir como archivo publicado: la página pide los datos a la función serverless con el token del visitante.

### 7.2 Componentes

1. **GitHub App** de Leyni, con permisos de solo lectura: *Issues: read*, *Metadata: read*, *Projects* (cuenta y organización: read), *Pull requests: read*. Se prefiere a una OAuth App porque la OAuth App pide el permiso `repo`, que incluye escritura. Debe quedar instalada en los repositorios que se quiera mostrar.
2. **Función serverless** (Cloudflare Workers o Vercel, plan gratuito): completa el inicio de sesión (el secreto de la aplicación no puede ir en la página), entrega al navegador un token de usuario de corta duración, o actúa como proxy de las consultas, y fija los orígenes permitidos (CORS) y los encabezados de seguridad. No registra tokens.
3. **La página:** la misma de la fase 1, con una pantalla de entrada, selector de proyecto («los tableros a los que tienes acceso») y el mismo código de lectura trasladado a una librería compartida.
4. **Lista de proyectos mostrados:** configuración de Leyni (repositorio y número de proyecto). Para cada visitante, la función solo devuelve los proyectos que GitHub le permite leer con su token.

### 7.3 Puntos que hay que resolver (primeras tareas de la fase)

1. **Verificar los permisos reales** de la GitHub App sobre proyectos de **usuario** con token de usuario (en el punto 3.5 no está comprobado). Si no alcanza, evaluar alternativas: mover el proyecto a una organización, o aceptar que ciertos tableros requieran un token con más permisos y decirlo claramente al visitante.
2. **Invitación al proyecto:** documentar que, para tableros privados, los colaboradores deben estar invitados al proyecto además de al repositorio.
3. **Caducidad y revocación:** tokens de corta duración, cierre de sesión, y qué pasa si GitHub revoca el acceso a un colaborador (la sesión debe dejar de leer en la siguiente petición).
4. **Límites de la API de GraphQL** de GitHub por usuario: caché corta en la función (por proyecto y por usuario, nunca compartida entre usuarios con permisos distintos).
5. **Registro de decisiones** de seguridad en el repositorio de Heimdallr (qué permisos pide la App y por qué).

### 7.4 Aceptación de la fase 3

- Una cuenta sin acceso a un proyecto privado **no recibe** sus datos, ni en la interfaz ni en la red (se comprueba en la pestaña de red).
- Una cuenta con acceso ve exactamente su proyecto; Leyni ve todos los suyos.
- No se pide ningún permiso de escritura al iniciar sesión.
- No hay secretos en el repositorio ni en el código publicado. Los secretos viven en la configuración del proveedor serverless.
- Revisión de seguridad antes del primer despliegue (encabezados, CORS, manejo del token, registro).

---

## 8. Reglas para los agentes que lo desarrollen

- **Solo lectura en GitHub.** No crear, editar ni cerrar issues, PR, tarjetas, ni cambiar configuración de proyectos o repositorios. Solo `gh` de lectura y `gh api` con `GET`.
- **Sin secretos en el repositorio:** nada de tokens, claves ni cadenas de conexión en archivos, registros, capturas ni commits. No se imprime el resultado de `gh auth token`.
- **Sin dependencias nuevas** sin visto bueno de Leyni (fase 1 y 2: ninguna; fase 3: solo las que el proveedor serverless exija, justificadas por escrito).
- **Git:** no hacer `commit`, `push`, `merge` ni abrir PR sin que Leyni lo pida en ese momento. `git add` solo con rutas concretas, nunca `.`, `-A` ni `*`. Los mensajes de commit van en español con el formato `Tipo: título` (tipos: Configuración, Documentación, Funcionalidad, Pruebas, Corrección) y una descripción debajo, y no llevan atribución del agente (ni `Co-Authored-By`, ni coautoría, ni enlaces de sesión). El `push` lo hace Leyni.
- **No inventar datos:** si un campo no existe en el tablero, se avisa; no se rellena con valores supuestos.
- **Probar con el tablero real** (#3) y con una captura guardada, nunca solo con datos inventados.
- **Terminar cada fase** con su lista de aceptación comprobada y un resumen de lo que **no** se pudo verificar.
- Lo que quede sin decidir se anota como decisión pendiente en un `DECISIONES.md` del repositorio, con responsable, en vez de dejarla en un comentario.

---

## 9. Decisiones que confirmar con Leyni antes de empezar

| # | Decisión | Propuesta |
| --- | --- | --- |
| 1 | Lenguaje de la extracción | Node (ya instalado, v24) en las tres fases, para compartir el lector de dependencias con la función serverless |
| 2 | Qué sprints mostrar por defecto | S1 a S6; los anteriores, bajo un filtro |
| 3 | Categoría por defecto | Campo `Modulo` |
| 4 | Frecuencia de actualización en la fase 2 | Cada hora, más botón manual |
| 5 | Proveedor serverless de la fase 3 | Cloudflare Workers (plan gratuito) |
| 6 | Nombre y repositorio de Heimdallr | `Heimdallr`, repositorio propio de Leyni |
| 7 | ¿Se publican los tableros privados de Leyni en la fase 3? | Solo cuando la fase 3 esté revisada |

---

## 10. Riesgos

| Riesgo | Efecto | Mitigación |
| --- | --- | --- |
| El formato de «Depende de» cambia o se olvida en un issue | Flechas faltantes | Modo estricto con avisos; propuesta de usar «blocked by» nativo si el equipo lo adopta |
| Mezcla de sprints viejos y nuevos | Columnas confusas | Filtro y esquema por defecto S1 a S6 |
| Límite de 300 tarjetas en una consulta | Datos incompletos | Paginación y aviso si se alcanza el límite |
| Token personal de la fase 2 con demasiado alcance | Fuga si se filtra | Credencial mínima, vencimiento corto, rotación; y probar primero sin ella |
| Proyectos de usuario no cubiertos por una GitHub App | La fase 3 cambia de diseño | Verificarlo primero (7.3, punto 1) y decidir antes de programar |
| Datos obsoletos | Decisiones con información vieja | Fecha visible de generación y aviso a las 24 h |
