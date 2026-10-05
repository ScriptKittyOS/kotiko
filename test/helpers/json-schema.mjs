// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// A small JSON Schema (2020-12) checker for the spec/ data files and fixtures: the
// keywords those schemas use (type, enum, const, required, properties,
// additionalProperties, items, min/maxItems, min/maxLength, pattern, minimum, maximum,
// anyOf, $ref to #/$defs or to a registered file). Returns a list of "path: problem" strings, empty when valid.
const typeOf = (v) =>
  v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;

const schemas = new Map();
// Makes a schema file reachable from a `$ref` by its name ("word.schema.json").
export function register(name, schema) {
  schemas.set(name, schema);
}

export function validate(schema, value, root = schema, where = "$") {
  if (schema === true) return [];
  if (schema === false) return [`${where}: not allowed`];
  if (schema.$ref) {
    // Another schema file (export.schema.json's words are word.schema.json), registered
    // with `register`.
    if (!schema.$ref.startsWith("#")) {
      const other = schemas.get(schema.$ref);
      if (!other) return [`${where}: unknown schema ${schema.$ref}`];
      return validate(other, value, other, where);
    }
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    return validate(root.$defs[name], value, root, where);
  }
  const errors = [];
  const t = typeOf(value);
  if (schema.type) {
    const types = [schema.type].flat();
    const ok = types.includes(t) || (t === "integer" && types.includes("number"));
    if (!ok) return [`${where}: ${t}, not ${types.join("|")}`];
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${where}: not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${where}: ${JSON.stringify(value)} not in enum`);
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, value, root, where).length === 0)) errors.push(`${where}: matches none of anyOf`);
  if (t === "string") {
    const n = [...value].length;
    if (schema.minLength !== undefined && n < schema.minLength) errors.push(`${where}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && n > schema.maxLength) errors.push(`${where}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${where}: doesn't match ${schema.pattern}`);
  }
  if (t === "integer" || t === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${where}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${where}: above ${schema.maximum}`);
  }
  if (t === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${where}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${where}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, root, `${where}[${i}]`)));
  }
  if (t === "object") {
    for (const k of schema.required ?? []) if (!Object.hasOwn(value, k)) errors.push(`${where}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, k)) errors.push(...validate(schema.properties[k], v, root, `${where}.${k}`));
      else if (schema.additionalProperties !== undefined) errors.push(...validate(schema.additionalProperties, v, root, `${where}.${k}`));
    }
  }
  return errors;
}
