import 'fake-indexeddb/auto';

// O app nunca deve depender de rede: qualquer fetch durante os testes falha explicitamente.
globalThis.fetch = (() => {
  throw new Error('Acesso à rede durante os testes — o app deve funcionar offline.');
}) as typeof fetch;
