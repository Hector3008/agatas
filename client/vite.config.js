import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./": las rutas de los archivos son relativas a la página, así funciona
// con cualquier prefijo con el que el gateway monte el servicio (/agatas/app/).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    // En desarrollo, el API del juego se pide al gateway local.
    proxy: { "/agatas/p": { target: "http://localhost:3000" } },
  },
});
