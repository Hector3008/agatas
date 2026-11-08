// Permisos del servicio y plantilla de roles propuesta para `core`
// (core/src/modelos/plantillas.js, clave `agatas`). El admin ya tiene `*`.

export const PERMISOS = Object.freeze({
  configurar: "juego:configurar", // colores, agatas, preguntas, premios, textos
  validar: "juego:validar", // el mesero entrega premios
  leer: "juego:leer", // ver partidas y premios
});

export const PLANTILLA_ROLES = Object.freeze({
  mesero: ["juego:validar", "juego:leer"],
});
