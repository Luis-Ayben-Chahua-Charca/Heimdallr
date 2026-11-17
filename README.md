# Heimdallr

Visor de tableros de GitHub Projects con dependencias entre tarjetas, inspirado en una malla curricular: columnas por sprint, tarjetas por issue, flechas de «depende de» y el estado de cada una.

La especificación completa está en [PROPUESTA.md](PROPUESTA.md) y las decisiones tomadas o pendientes en [DECISIONES.md](DECISIONES.md).

| Fase | Resultado | Estado |
| --- | --- | --- |
| 1 | Script `node scripts/actualizar.mjs` y página `web/index.html` que se abre con doble clic | Hecha |
| 2 | Sitio público en GitHub Pages con el tablero de Farmasil | Pendiente |
| 3 | Inicio de sesión con GitHub, varios repositorios, cada persona ve solo lo suyo | Pendiente |

## Uso (fase 1)

Requisitos: Node 24 y `gh` con sesión iniciada y el permiso `project` (`gh auth refresh -s project` si falta). No hay paquetes de npm.

```bash
node scripts/actualizar.mjs
```

Lee el tablero configurado en `heimdallr.config.json` y escribe `web/data.js` y `web/data.json` (ambos ignorados por git). Después se abre `web/index.html` con doble clic.

Opciones:

| Opción | Uso |
| --- | --- |
| `--owner <dueño>` | Dueño del tablero (usuario u organización) |
| `--project <n>` | Número del proyecto |
| `--config <ruta>` | Otro archivo de configuración |
| `--estricto` | Avisa de toda línea de «Depende de» con formato no reconocido |
| `--ayuda` | Muestra la ayuda |

El script es **solo lectura**: nunca modifica issues, tarjetas ni proyectos, y no lee ni guarda tokens. Toda llamada a `gh` pasa antes por una lista blanca (`scripts/lib/solo-lectura.mjs`) que rechaza cualquier subcomando, opción o consulta GraphQL que pueda escribir.

## Vista desplegada por sprint

El botón «Desplegar» de la cabecera de cada sprint abre ese sprint a lo ancho y contrae los demás a franjas (pestañas en pantallas estrechas):

- **Pasos:** las tarjetas se ordenan de izquierda a derecha según sus dependencias dentro del sprint (paso 1 = no depende de nada del sprint; paso N = después de la más tardía de sus predecesoras). Una arista que cierra un ciclo se dibuja discontinua y no cuenta para los pasos.
- **Independientes:** las tarjetas sin relaciones dentro del sprint van en un carril aparte abajo.
- **Viene de / Habilita:** a la izquierda, las predecesoras que están en otros sprints o fuera del tablero; a la derecha, las sucesoras en otros sprints. Al pulsar una se despliega su sprint con esa tarjeta fijada.
- Los filtros atenúan en lugar de ocultar, para que el grafo no cambie de forma.
- El sprint desplegado queda en la URL (`index.html#S1`). Escape o «Contraer» vuelven a la vista normal.

## Configuración

`heimdallr.config.json` define el dueño, el proyecto, el mapeo de los campos del tablero a los del modelo (`campos`), el patrón de las columnas que se muestran por defecto (`columnas.patronPorDefecto`, hoy `^S\d+$`), estados extra (`estadosExtra`), nombres opcionales de categorías (`nombresCategorias`) y la zona horaria con la que se calcula el sprint actual (`zonaHoraria`, por defecto `America/Lima`). El script valida la configuración antes de llamar a `gh`. Los nombres de campos cambian entre tableros: se ajustan aquí, no en el código.

## Dependencias

Se leen de la sección `## Depende de` del cuerpo de cada issue, una por línea con el formato `- #N`. La sección termina en el siguiente `---` o `## `. Las líneas de texto libre se ignoran (con `--estricto`, se avisan). El cuerpo del issue no se guarda en los datos generados.

## Estructura

```text
heimdallr.config.json   configuración del tablero
scripts/actualizar.mjs  extracción (llama a gh)
scripts/lib/            lógica pura reutilizable: dependencias, ciclos, columnas, colores, modelo
web/                    página estática (index.html, styles.css, script.js) y datos generados
tests/                  pruebas con node:test y captura del tablero #3
```

## Pruebas

```bash
node --test tests/
```

Incluyen el lector de dependencias, el modelo construido desde la captura real del tablero #3 (`tests/fixtures/tablero-3.json`, con los cuerpos recortados a la sección «Depende de»), una prueba que falla si el código contiene comandos de escritura en GitHub y otra que busca tokens en los datos generados.

## Diferencias del modelo con la sección 4 de la propuesta

- `estados` (raíz): opciones del campo `Status` en su orden.
- `enCiclo` (tarjeta): la tarjeta forma parte de un ciclo de dependencias. La página recalcula los ciclos por su cuenta.
- La columna «Sin sprint» tiene id `sin-sprint` y solo aparece si alguna tarjeta no tiene sprint.
- Una dependencia a un issue que no existe se descarta y queda en `avisos`.
