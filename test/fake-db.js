// Base de datos falsa en memoria para probar sin MongoDB.
//
// Imita solo lo que usan agatas y el motor de documentos del núcleo (que aquí se ejecuta de verdad):
// create con validación y valores por defecto del esquema real de Mongoose, índices únicos
// (E11000, con filtro parcial), findOne/find (sort, skip, limit, lean), updateOne y
// findOneAndUpdate con $set, $inc, $push, upsert, el operador posicional `$`, $elemMatch, $or,
// $lt/$gt/$lte/$gte/$in/$ne y las rutas con punto a través de arreglos.
// Cada operación es atómica (como en Mongo para un solo documento) y cede el turno antes de
// ejecutarse, para que las peticiones simultáneas se entrelacen entre una operación y otra.
//
// NO sustituye a MongoDB: no valida la sintaxis de los operadores como lo haría el servidor
// ni reproduce los casts de Mongoose en las consultas. Por eso existe test/mongo.integration.test.js.
import mongoose from "mongoose";
import { empresaActual } from "core";

const esObjectId = (v) => v !== null && typeof v === "object" && typeof v.toHexString === "function";

function norm(v) {
  if (v instanceof Date) return v.getTime();
  if (esObjectId(v)) return v.toHexString();
  return v;
}

export function clon(v) {
  if (Array.isArray(v)) return v.map(clon);
  if (v instanceof Date || esObjectId(v)) return v;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clon(x)]));
  return v;
}

function valores(obj, partes) {
  if (!partes.length) return Array.isArray(obj) ? [obj, ...obj] : [obj];
  if (obj === null || obj === undefined) return [undefined];
  if (Array.isArray(obj)) return obj.flatMap((x) => valores(x, partes));
  return valores(obj[partes[0]], partes.slice(1));
}

const esOperadores = (c) =>
  c && typeof c === "object" && !Array.isArray(c) && !(c instanceof Date) && !esObjectId(c) &&
  Object.keys(c).some((k) => k.startsWith("$"));

function cumpleCond(v, cond) {
  if (!esOperadores(cond)) {
    if (cond === null) return v === null || v === undefined;
    return norm(v) === norm(cond);
  }
  return Object.entries(cond).every(([op, arg]) => {
    const a = norm(arg);
    const x = norm(v);
    switch (op) {
      case "$lt": return x !== undefined && x !== null && x < a;
      case "$lte": return x !== undefined && x !== null && x <= a;
      case "$gt": return x !== undefined && x !== null && x > a;
      case "$gte": return x !== undefined && x !== null && x >= a;
      case "$ne": return x !== a;
      case "$in": return arg.some((y) => norm(y) === x);
      case "$type": return arg === "objectId" ? esObjectId(v) : false;
      default: throw new Error(`fake-db: operador no soportado ${op}`);
    }
  });
}

export function coincide(doc, filtro) {
  return Object.entries(filtro).every(([clave, cond]) => {
    if (clave === "$or") return cond.some((f) => coincide(doc, f));
    if (esOperadores(cond) && "$elemMatch" in cond) {
      const arr = valores(doc, clave.split("."))[0];
      return Array.isArray(arr) && arr.some((el) => coincide(el, cond.$elemMatch));
    }
    return valores(doc, clave.split(".")).some((v) => cumpleCond(v, cond));
  });
}

// Índice del primer elemento de un arreglo que satisface el filtro (lo que Mongo llama `$`).
function indicePosicional(doc, filtro, campo) {
  const arr = doc[campo];
  if (!Array.isArray(arr)) return -1;
  const sub = {};
  let elem = null;
  for (const [k, c] of Object.entries(filtro)) {
    if (k === campo && esOperadores(c) && "$elemMatch" in c) elem = c.$elemMatch;
    else if (k.startsWith(`${campo}.`)) sub[k.slice(campo.length + 1)] = c;
  }
  return arr.findIndex((el) => (elem ? coincide(el, elem) : true) && coincide(el, sub));
}

function ponerRuta(doc, ruta, valor, idx) {
  const partes = ruta.split(".").map((p) => (p === "$" ? String(idx) : p));
  let cur = doc;
  for (let i = 0; i < partes.length - 1; i++) {
    if (cur[partes[i]] === undefined || cur[partes[i]] === null) cur[partes[i]] = {};
    cur = cur[partes[i]];
  }
  cur[partes.at(-1)] = valor;
}

function leerRuta(doc, ruta) {
  return ruta.split(".").reduce((c, p) => (c === undefined || c === null ? undefined : c[p]), doc);
}

function aplicar(doc, update, filtro) {
  const antes = JSON.stringify(doc);
  // El elemento que marca `$` se decide con el documento tal como estaba al hacer la consulta.
  const posiciones = {};
  for (const campos of Object.values(update)) {
    for (const ruta of Object.keys(campos)) {
      if (!ruta.includes(".$") && !ruta.endsWith(".$")) continue;
      const campo = ruta.split(".")[0];
      if (!(campo in posiciones)) {
        posiciones[campo] = indicePosicional(doc, filtro, campo);
        if (posiciones[campo] < 0) throw new Error(`fake-db: el operador posicional $ no tiene elemento para ${ruta}`);
      }
    }
  }
  for (const [op, campos] of Object.entries(update)) {
    for (const [ruta, valor] of Object.entries(campos)) {
      const idx = posiciones[ruta.split(".")[0]] ?? -1;
      if (op === "$set") ponerRuta(doc, ruta, clon(valor), idx);
      else if (op === "$inc") ponerRuta(doc, ruta, (leerRuta(doc, ruta) ?? 0) + valor, idx);
      else if (op === "$push") {
        const arr = leerRuta(doc, ruta) ?? [];
        ponerRuta(doc, ruta, [...arr, clon(valor)], idx);
      } else throw new Error(`fake-db: operador de actualización no soportado ${op}`);
    }
  }
  return JSON.stringify(doc) !== antes;
}

class Consulta {
  constructor(ejecutar, lista) {
    this.ejecutar = ejecutar;
    this.lista = lista;
    this.opc = {};
  }
  lean() { return this; }
  sort(s) { this.opc.sort = s; return this; }
  skip(n) { this.opc.skip = n; return this; }
  limit(n) { this.opc.limit = n; return this; }
  then(ok, ko) { return this.ejecutar(this.opc).then(ok, ko); }
}

export function crearBaseFalsa({ jitter = false } = {}) {
  const conn = mongoose.createConnection();
  const datos = new Map(); // coleccion → docs
  const base = { conn, datos, hook: null }; // `hook(op, coleccion, filtro, update)` puede lanzar para simular caídas

  const turno = () =>
    jitter ? new Promise((r) => setTimeout(r, Math.random() * 2)) : new Promise((r) => setImmediate(r));

  function model(nombre, schema, coleccion) {
    const Real = conn.model(nombre, schema, coleccion);
    if (!datos.has(coleccion)) datos.set(coleccion, []);
    const docs = datos.get(coleccion);
    const unicos = schema.indexes().filter(([, o]) => o?.unique);

    const empresa = () => {
      const id = empresaActual();
      if (!id) throw new Error("Consulta sin empresa activa (use conEmpresa o sinEmpresa)");
      return id;
    };
    const global = schema.options?.global; // no usado: Empresa se llena a mano
    const conTenant = (f) => (schema.path("empresaId") ? { ...f, empresaId: empresa() } : f);

    function chequearUnicos(nuevo, ignorar) {
      for (const [spec, o] of unicos) {
        const campos = Object.keys(spec);
        if (o.partialFilterExpression && !coincide(nuevo, o.partialFilterExpression)) continue;
        const clave = campos.map((c) => norm(leerRuta(nuevo, c)));
        const dup = docs.some((d) => d !== ignorar && campos.every((c, i) => norm(leerRuta(d, c)) === clave[i]));
        if (dup) {
          const e = new Error(`E11000 duplicate key en ${coleccion}: ${campos.join(",")}`);
          e.code = 11000;
          throw e;
        }
      }
    }

    const M = {
      modelName: nombre,
      async init() {},
      async create(entrada) {
        await turno();
        const m = new Real(entrada);
        await m.validate();
        const plano = m.toObject();
        if (schema.options?.timestamps) plano.createdAt = plano.updatedAt = new Date();
        chequearUnicos(plano, null);
        docs.push(plano);
        return { ...clon(plano), toObject: () => clon(plano) };
      },
      findOne(filtro = {}) {
        return new Consulta(async () => {
          await turno();
          const f = conTenant(filtro);
          const d = docs.find((x) => coincide(x, f));
          return d ? clon(d) : null;
        });
      },
      find(filtro = {}) {
        return new Consulta(async (o) => {
          await turno();
          const f = conTenant(filtro);
          let r = docs.map((d, i) => [d, i]).filter(([d]) => coincide(d, f));
          if (o.sort) {
            const [[campo, dir]] = Object.entries(o.sort);
            r.sort((a, b) => {
              const x = norm(a[0][campo]), y = norm(b[0][campo]);
              return (x < y ? -1 : x > y ? 1 : a[1] - b[1]) * dir;
            });
            // desempate estable: a igual valor, lo más nuevo primero cuando dir = -1
            if (dir < 0) r.sort((a, b) => (norm(b[0][campo]) === norm(a[0][campo]) ? b[1] - a[1] : 0));
          }
          r = r.slice(o.skip ?? 0, o.limit ? (o.skip ?? 0) + o.limit : undefined);
          return r.map(([d]) => clon(d));
        });
      },
      async countDocuments(filtro = {}) {
        await turno();
        return docs.filter((x) => coincide(x, conTenant(filtro))).length;
      },
      async updateOne(filtro, update, opc = {}) {
        await turno();
        await base.hook?.("updateOne", coleccion, filtro, update);
        const f = conTenant(filtro);
        const d = docs.find((x) => coincide(x, f));
        if (!d && opc.upsert) {
          const nuevo = {};
          for (const [k, v] of Object.entries(f)) if (!k.startsWith("$") && !esOperadores(v)) ponerRuta(nuevo, k, v, -1);
          const plano = new Real(nuevo).toObject();
          aplicar(plano, update, f);
          if (schema.options?.timestamps) plano.createdAt = plano.updatedAt = new Date();
          chequearUnicos(plano, null);
          docs.push(plano);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        if (!d) return { matchedCount: 0, modifiedCount: 0 };
        const copia = clon(d);
        const cambio = aplicar(copia, update, f);
        chequearUnicos(copia, d);
        Object.keys(d).forEach((k) => delete d[k]);
        Object.assign(d, copia);
        return { matchedCount: 1, modifiedCount: cambio ? 1 : 0 };
      },
      async findOneAndUpdate(filtro, update, opc = {}) {
        await turno();
        const f = conTenant(filtro);
        let d = docs.find((x) => coincide(x, f));
        if (!d && opc.upsert) {
          const base = {};
          for (const [k, v] of Object.entries(f)) if (!k.startsWith("$") && !esOperadores(v)) ponerRuta(base, k, v, -1);
          const m = new Real(base);
          const plano = m.toObject();
          aplicar(plano, update, f);
          chequearUnicos(plano, null);
          docs.push(plano);
          return clon(plano);
        }
        if (!d) return null;
        const antes = clon(d);
        const copia = clon(d);
        aplicar(copia, update, f);
        Object.keys(d).forEach((k) => delete d[k]);
        Object.assign(d, copia);
        return clon(opc.returnDocument === "after" ? d : antes);
      },
    };
    return M;
  }

  base.model = model;
  return base;
}
