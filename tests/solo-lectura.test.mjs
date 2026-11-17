// Pruebas del filtro de solo lectura de las llamadas a gh (lista blanca estricta).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { comprobarSoloLectura, LlamadaNoPermitida } from '../scripts/lib/solo-lectura.mjs';

const CONSULTA = 'query($login: String!, $numero: Int!) { repositoryOwner(login: $login) { ... on ProjectV2Owner { projectV2(number: $numero) { title } } } }';
const graphql = (...extra) => ['api', 'graphql', '-f', `query=${CONSULTA}`, '-f', 'login=duena', '-F', 'numero=3', ...extra];

const permitida = (args) => assert.doesNotThrow(() => comprobarSoloLectura(args));
const rechazada = (args) => assert.throws(() => comprobarSoloLectura(args), LlamadaNoPermitida);

test('se permiten exactamente las llamadas que usa actualizar.mjs', () => {
  permitida(['project', 'item-list', '3', '--owner', 'Luis-Ayben-Chahua-Charca', '--limit', '1000', '--format', 'json']);
  permitida(['project', 'field-list', '3', '--owner', 'Luis-Ayben-Chahua-Charca', '--limit', '200', '--format', 'json']);
  permitida(['project', 'view', '3', '--owner', 'duena', '--format', 'json']);
  permitida(['issue', 'view', '53', '--repo', 'Luis-Ayben-Chahua-Charca/Farmasil_App', '--json', 'number,title,state,url']);
  permitida(graphql());
  permitida(graphql('-f', 'cursor=Y3Vyc29yOnYyOpHOAAAAZA=='));
  permitida(['api', 'graphql', '-f', 'query={ viewer { login } }']);
});

test('subcomandos de escritura o no previstos', () => {
  rechazada(['project', 'item-edit', '--id', 'X']);
  rechazada(['issue', 'edit', '53', '--repo', 'a/b']);
  rechazada(['issue', 'close', '53']);
  rechazada(['issue', 'comment', '53', '--body', 'x']);
  rechazada(['api', 'repos/a/b/issues/1']);
  rechazada(['api', '/graphql']);
  rechazada(['auth', 'status']);
  rechazada(['project']);
  rechazada('project item-list');
});

test('evasión: mutation en cualquier parte del documento', () => {
  rechazada(['api', 'graphql', '-f', 'query=query A { viewer { login } } mutation B { x }', '-f', 'operationName=B']);
  rechazada(['api', 'graphql', '-f', 'query=query A { viewer { login } } mutation B { x }']);
  rechazada(['api', 'graphql', '-f', 'query=mutation { x }']);
  rechazada(['api', 'graphql', '-f', 'query=  MUTATION { x }']);
  rechazada(['api', 'graphql', '-f', 'query=subscription { x }']);
  rechazada(['api', 'graphql', '-f', 'query=query A { a } query B { b }']);
});

test('evasión: operationName, --input, cambio de método y otros flags', () => {
  rechazada(graphql('-f', 'operationName=B'));
  rechazada(graphql('--input', 'archivo.json'));
  rechazada(['api', 'graphql', '--input', 'archivo.json']);
  rechazada(graphql('--method=DELETE'));
  rechazada(graphql('--method', 'DELETE'));
  rechazada(graphql('--method', 'GET'));
  rechazada(graphql('-XDELETE'));
  rechazada(graphql('-X', 'POST'));
  rechazada(graphql('--hostname', 'evil.example'));
  rechazada(graphql('-H', 'Accept: x'));
  rechazada(graphql('--paginate'));
  rechazada(graphql('--raw-field', 'query=x'));
  rechazada(['project', 'item-list', '3', '--owner', 'duena', '--format=json']);
  rechazada(['issue', 'view', '53', '--repo', 'a/b', '--web']);
});

test('evasión: textos que empiezan por «query» sin serlo y claves no previstas', () => {
  rechazada(['api', 'graphql', '-f', 'query_x={ viewer { login } }']);
  rechazada(['api', 'graphql', '-f', 'queryX=query { a }']);
  rechazada(['api', 'graphql', '-f', 'query=queryX { a }']);
  rechazada(['api', 'graphql', '-f', 'login=duena']); // sin consulta
  rechazada(graphql('-f', 'query=query { a }')); // consulta repetida
  rechazada(graphql('-F', 'login=@archivo')); // -F con clave de cadena
  rechazada(['api', 'graphql', '-f', `query=${CONSULTA}`, '-F', 'numero=@archivo']);
  rechazada(['api', 'graphql', '-f', `query=${CONSULTA}`, '-F', 'numero=true']);
  rechazada(['api', 'graphql', '-f', `query=${CONSULTA}`, '-f']);
});

test('valores con formato no válido', () => {
  rechazada(['project', 'item-list', '3; rm', '--owner', 'duena', '--format', 'json']);
  rechazada(['project', 'item-list', '3', '--owner', '--limit', '--format', 'json']);
  rechazada(['project', 'item-list', '3', '--owner', 'duena', '--format', 'csv']);
  rechazada(['issue', 'view', '53', '--repo', 'https://evil/x', '--json', 'number']);
  rechazada(['issue', 'view', '53', '54', '--repo', 'a/b', '--json', 'number']);
  rechazada(['issue', 'view', '--repo', 'a/b', '--json', 'number']);
});
