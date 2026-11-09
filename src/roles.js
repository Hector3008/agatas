// Permisos del servicio y plantilla de roles propuesta para `core`
// (core/src/modelos/plantillas.js, clave `agatas`). El admin ya tiene `*`.

export const PERMISOS = Object.freeze({
  configurar: "juego:configurar", // colores, agatas, preguntas, premios, textos
  validar: "juego:validar", // el mesero entrega premios
  leer: "juego:leer", // ver partidas y premios
});

// Ojo: `plantillasPara` del núcleo junta las plantillas con Object.assign por nombre de rol, así que
// un rol `mesero` aquí PISARÍA al `mesero` de tobt (o al revés) en una empresa con los dos servicios.
// Por eso el rol del juego tiene nombre propio.
export const PLANTILLA_ROLES = Object.freeze({
  mesero_juego: ["juego:validar", "juego:leer"],
});
