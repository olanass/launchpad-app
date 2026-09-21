'use strict';
const vm = require('node:vm');
const Ajv = require('ajv');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

// Creator-supplied schemas are untrusted. No external reference fetching, data
// mutation, or async validation; bound synchronous compilation and regex work.
function validateInput(service, method, path, body) {
  const doc = service.openapiDocument;
  if (!doc?.paths) return;
  const resolve = (value, depth = 0) => {
    if (!value?.$ref) return value;
    if (depth > 8 || !value.$ref.startsWith('#/')) throw Object.assign(new Error('Service schema references must be local and non-circular'), { status: 400 });
    let found = doc;
    for (const segment of value.$ref.slice(2).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
      if (!found || !Object.prototype.hasOwnProperty.call(found, segment)) throw Object.assign(new Error('Service schema reference could not be resolved'), { status: 400 });
      found = found[segment];
    }
    return resolve(found, depth + 1);
  };
  const pathname = (path || '/').split('?')[0] || '/';
  const match = Object.entries(doc.paths).find(([template]) => {
    const expected = template.split('/'), actual = pathname.split('/');
    return expected.length === actual.length && expected.every((segment, i) => /^\{[^}]+\}$/.test(segment) ? Boolean(actual[i]) : segment === actual[i]);
  });
  const operation = match?.[1]?.[method.toLowerCase()];
  if (!operation) throw Object.assign(new Error('This method and path are not declared in the service OpenAPI document'), { status: 400 });
  const request = resolve(operation.requestBody);
  if (request?.required && body === null) throw Object.assign(new Error('This service requires a request body'), { status: 400 });
  const query = new URLSearchParams((path || '').split('?').slice(1).join('?'));
  for (const raw of [...(match[1].parameters || []), ...(operation.parameters || [])]) {
    const parameter = resolve(raw);
    if (parameter.in === 'query' && parameter.required && !query.has(parameter.name)) throw Object.assign(new Error('Required query parameter: ' + parameter.name), { status: 400 });
  }
  const schema = request?.content?.['application/json']?.schema;
  if (schema === undefined || body === null && !request?.required) return;
  let valid, message;
  try {
    vm.runInNewContext('check()', { check() {
      const ajv = new (doc.openapi.startsWith('3.1') ? Ajv2020 : Ajv)({ strict: false, allErrors: false, validateFormats: true, ownProperties: true });
      addFormats(ajv);
      const validate = ajv.compile(typeof schema === 'boolean' ? schema : { ...schema, components: doc.components || {} });
      if (validate.$async) throw new Error('Asynchronous schemas are not supported');
      valid = validate(body);
      message = ajv.errorsText(validate.errors, { dataVar: 'request' });
    } }, { timeout: 250 });
  } catch (_) { throw Object.assign(new Error('The service input schema cannot be validated safely. Ask its creator to update it.'), { status: 400 }); }
  if (!valid) throw Object.assign(new Error('Invalid service input: ' + message), { status: 400 });
}
module.exports = { validateInput };
