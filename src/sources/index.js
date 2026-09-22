// Where data comes from is one registry entry. When IT says how KAIROSS
// exposes its data, that becomes one more file here — the rules, the engine and
// the pages do not change.
import createFixtureSource from './fixture.js';
import createFilesSource from './files.js';

const SOURCES = {
  fixture: createFixtureSource,
  files: createFilesSource
};

export const SOURCE_IDS = Object.keys(SOURCES);

export function resolveSource(config) {
  const create = SOURCES[config.sourceId];
  if (!create) {
    throw new Error(
      `unknown SPEND_SOURCE "${config.sourceId}" — known sources: ${SOURCE_IDS.join(', ')}`
    );
  }
  return create(config);
}
