# agatas

Juego de intercambio de «agatas» de colores para Gecko Café, como servicio de la plataforma Ilnapo.
Paquete ES module que exporta `createRouter({ core })`; el gateway lo monta en `/agatas`.

**Estado: pieza 5.80 (juego).** Configuración (5.79) más la partida del jugador, su mano, los
intercambios atómicos y los premios con código de un solo uso. Los fronts son 5.81 (jugador) y
5.82 (administración y mesero).

## Cómo se juega

1. El jugador escanea el QR **general** del local, escribe un apodo y el servidor le asigna un **color al azar**
   y una mano de agatas de ese color (por defecto 6). Se le entrega una cookie `ag_<slug>` con un token opaco
   (en la base solo está su hash). Con `requiereCuenta` se usa la sesión de cliente del núcleo en vez del apodo.
2. Para intercambiar, **A** ofrece una agata y recibe una invitación (código de 8 caracteres, para QR o dictado).
   **B** la abre, ve solo el color que se ofrece, y se une con una de sus agatas.
3. Al unirse, el servidor entrega **a los dos** la pregunta de cada agata. Responden en persona y cada uno
   **confirma**. Cuando confirmaron los dos, las agatas cambian de mano.
4. Con 3, 5 o 6 colores distintos en la mano (según la configuración) el jugador reclama el premio y recibe un
   **código de canje**. El mesero lo valida y el premio se entrega **una sola vez**.

## Garantías (sin transacciones de MongoDB)

- Una agata solo se reserva con una actualización condicionada («no está reservada»): no entra en dos intercambios.
- El documento `IA` es el punto de serialización: cada paso lo mueve con `{ code, version, estado }`.
- El cambio reemplaza cada agata **en su sitio**: el tamaño de la mano nunca cambia. Es idempotente, así que si el
  servidor cae a mitad se termina solo la próxima vez que alguien mira (nadie queda con más ni con menos).
- El premio tiene índice único `(partida, premio)` y el código de canje es único por empresa.

## Rutas (`/agatas`)

Jugador (`/p/:slug`, sin sesión de personal; las que escriben exigen `x-requested-with`):

| Ruta | Qué hace |
|---|---|
| `GET /p/:slug/info` | Parte pública de la configuración (sin preguntas) |
| `POST /p/:slug/partida` `{ apodo }` | Crea la partida (201) y pone la cookie; con cuenta, vuelve a entrar (200) y renueva el token |
| `GET /p/:slug/partida` | Mano, colores distintos, premios, intercambios abiertos y cupo por hora |
| `POST /p/:slug/intercambios` `{ aid }` | Ofrece una agata; devuelve la `invitacion` |
| `GET /p/:slug/intercambios/:invitacion` | Si eres parte: estado y preguntas; si no: solo el color ofrecido (mientras esté en oferta) |
| `POST /p/:slug/intercambios/unirse` `{ invitacion, aid }` | Acepta una oferta con una agata propia |
| `POST /p/:slug/intercambios/:invitacion/confirmar` | Confirma que respondió |
| `POST /p/:slug/intercambios/:invitacion/cancelar` | Cancela (mientras no hayan confirmado los dos) |
| `POST /p/:slug/premios` `{ premioId }` | Reclama un premio y recibe el código de canje |

Personal (`/staff`, con sesión del núcleo):

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /staff/premios?estado=` | `juego:leer` | Premios `pendiente` (por defecto), `entregado` o `anulado` |
| `GET /staff/premios/:codigo` | `juego:validar` | Consulta un código de canje |
| `POST /staff/premios/:codigo/entregar` | `juego:validar` | Entrega (una sola vez) |
| `POST /staff/premios/:codigo/anular` `{ motivo }` | `juego:validar` | Anula (`error`, `fraude`, `otro`) |
| `GET /staff/partidas` | `juego:leer` | Partidas vigentes (sin las retiradas ni las reiniciadas) |
| `POST /staff/partidas/:id/retirar` | `juego:validar` | Retira una partida: cancela sus intercambios y anula sus premios pendientes (los entregados no se tocan) |
| `GET /staff/empresa` | sesión | `{ slug }` de la empresa, para el título de la pantalla del mesero |

Configuración (como en 5.79): `GET /estado`, `GET /config` y `PUT /config` (`juego:configurar`).

## Qué se configura (por empresa)

- Nombre del personaje (singular y plural), colores (2 a 12), agatas por color, tamaño de la mano.
- Pregunta de cada agata (código `<colorId>-<n>`), premios (umbral de colores distintos), textos.
- `requiereCuenta`: `false` = basta un apodo; `true` = hace falta cuenta de cliente.
- `reglas` (5.80): `partidasPorIpHora` (30), `intercambiosPorHora` por jugador (12), `ofertaVenceSeg` (180),
  `reservaVenceSeg` (900), `cookieDias` (30).
- `reinicio` (5.83): `modo` (`nunca` por defecto, `diario`, `semanal`), `hora` (`HH:MM`), `diaSemana` (0 = domingo … 6) y `zona` (IANA, `America/Lima`). Una partida solo vale si se creó después del último límite; se calcula al pedir, sin tareas programadas. Cambiar el horario puede reiniciar de inmediato a quien ya jugaba. La pantalla pública lo muestra al pie.
- `GET/PUT /config` devuelve además `advertencias` (p. ej. un premio que pide más colores que la mano).

## Documentos y colecciones

- `intercambio` (`IA`): `propuesto → aceptado → completado`; `cancelado` y `vencido` finales. El servicio lo mueve con `sistema: true`.
- `premio` (`PR`): `pendiente → entregado | anulado` (permiso `juego:validar`).
- Colecciones: `agatas_config`, `agatas_partidas`, `agatas_intercambios` (invitación → documento IA), `agatas_premios`.

## Front del jugador (5.81)

Una SPA React + Vite que se sirve en **`/agatas/app/?e=<slug>`** (el QR general del local apunta a esa URL; `&i=<CÓDIGO>` abre un intercambio).
Pantallas: entrada (apodo), mano con colores, ofrecer (QR + código de 8 letras), unirse (por enlace/QR o escribiendo el código), preguntas de ambos + confirmar con cuenta regresiva, y premios con código de canje.

- `client/dist` **está commiteado** (como cuenta/restaurante): el servidor no necesita compilar. Si cambias `client/src`, ejecuta `npm run build:client` y commitea `client/dist`.
- Desarrollo: `cd client && npm install && npm run dev` (proxy de `/agatas/p` a `localhost:3000`).
- La API se resuelve relativa a la página (`../p/<slug>/`), así funciona detrás de cualquier prefijo del gateway.
- Seguridad: CSP estricta (solo `'self'`), sin HTML inyectado (el QR es SVG dibujado con React), `index.html` sin caché y assets inmutables.
- Sondeo cada 2,5–4 s solo mientras la pestaña está visible (sin websockets).
- Límites: `requiereCuenta=true` muestra solo un aviso (no hay login en este front); no hay lector de QR propio (se usa la cámara del celular); si se pierde la cookie, la partida anónima no se recupera.
- Prueba en navegador real con dos jugadores: `npm i -D playwright` y `npm run e2e` (no forma parte de `npm test`).

## Pantalla del mesero (5.82)

`/agatas/app/?m=mesero` (mismo build del front). Usa la sesión de `cuenta` (cookie `sid`, mismo dominio): sin sesión muestra «Entra a tu cuenta» con un enlace a `../../cuenta/`. Pestañas: **Canjear** (escribir el código de canje, ver premio y jugador, «Entregar premio» o «Anular código» con motivo: error, fraude u otro), **Premios** (pendientes, entregados y anulados; se actualiza cada 10 s) y **Jugadores** (botón «Retirar» con confirmación: el jugador vuelve a la entrada con un aviso y puede empezar otra partida; sus premios pendientes se anulan). El título muestra el slug de la empresa. Pide `juego:validar` y `juego:leer` (rol `mesero_juego`). Sin lector de QR: el código se escribe (ignora guion, espacios y minúsculas).

## Pruebas

```
npm test
```

La mayoría usa una base de datos **falsa** en memoria (`test/fake-db.js`) junto con el motor de documentos real del
núcleo. Para correr contra MongoDB de verdad:

```
MONGO_URL="mongodb://localhost:27017" node --test test/mongo.integration.test.js
```

(usa una base temporal y la borra al terminar; sin `MONGO_URL` se omite).

## Límites conocidos

- El reinicio es «perezoso»: no hay proceso programado; los premios pendientes de antes de un reinicio se pueden canjear con el mesero (que los busca por código o apodo), pero el jugador ya no ve su pantalla.
- No hay «salir» para el jugador: solo el personal retira partidas.
- Entre reclamar un premio y retirar a la persona hay una carrera diminuta que podría dejar un premio pendiente; el personal lo anula a mano.
- Los topes por IP, los intentos con invitaciones inexistentes y los códigos inválidos del mesero viven en la memoria del
  proceso (se reinician con el servidor y no se comparten entre instancias). La IP es `req.ip`: el gateway debe
  tener `trust proxy` bien configurado.
- Sin cuenta, si el jugador borra la cookie pierde su partida.
- Las reservas huérfanas (caída entre reservar y crear el intercambio) se liberan al mirar la mano, no en segundo plano.
